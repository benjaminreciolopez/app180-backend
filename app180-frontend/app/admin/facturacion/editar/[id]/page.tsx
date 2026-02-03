"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { motion } from "framer-motion"
import { 
  ArrowLeft, 
  Save, 
  Calendar as CalendarIcon, 
  Plus, 
  Trash2,
  Calculator,
  Search,
  Check,
  AlertTriangle,
  Loader2,
  FileText,
  Badge
} from "lucide-react"
import { toast } from "sonner"
import { format } from "date-fns"

import { api } from "@/services/api"
import { formatCurrency } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

// --- TYPES ---
interface Linea {
  id: number
  descripcion: string
  cantidad: number
  precio_unitario: number
  iva: number
  concepto_id?: number | null
  original_desc?: string
}

interface Cliente {
  id: number
  nombre: string
  nif: string
}

interface Concepto {
  id: number
  nombre: string
  descripcion: string
  precio_unitario: number
  iva_default: number
  categoria?: string
}

export default function EditarFacturaPage() {
  const router = useRouter()
  const params = useParams()
  const id = params?.id as string
  
  // Data State
  const [loading, setLoading] = useState(true)
  const [clientes, setClientes] = useState<Cliente[]>([])
  
  // Form State
  const [numero, setNumero] = useState<string>("")
  const [clienteId, setClienteId] = useState<number | null>(null)
  const [fecha, setFecha] = useState<string>("")
  const [lineas, setLineas] = useState<Linea[]>([])
  const [estado, setEstado] = useState<string>("")
  
  const [saving, setSaving] = useState(false)
  const [clienteOpen, setClienteOpen] = useState(false)
  const [conceptos, setConceptos] = useState<Concepto[]>([])
  const [loadingConceptos, setLoadingConceptos] = useState(false)
  const [trabajosPendientes, setTrabajosPendientes] = useState<any[]>([])
  const [loadingTrabajos, setLoadingTrabajos] = useState(false)
  const [selectedTrabajos, setSelectedTrabajos] = useState<string[]>([])

  // Cargar datos factura y clientes
  useEffect(() => {
    const init = async () => {
      if (!id || id === 'undefined') return;
      try {
        setLoading(true)
        
        // 1. Cargar Clientes
        const resClientes = await api.get('/admin/clientes?limit=1000')
        // Manejar tanto formato estándar {success, data} como array plano legacy
        setClientes(resClientes.data.data || (Array.isArray(resClientes.data) ? resClientes.data : []))

        // 2. Cargar Factura
        const resFactura = await api.get(`/admin/facturacion/facturas/${id}`)
        const f = resFactura.data.data || resFactura.data // Manejar fallbacks

        if (!f) {
           toast.error("Factura no encontrada")
           router.push("/admin/facturacion/listado")
           return
        }

        if (f.estado !== 'BORRADOR') {
            toast.warning("Solo se pueden editar facturas en estado BORRADOR")
            router.push("/admin/facturacion/listado")
            return
        }

        setNumero(f.numero || "BORRADOR")
        setClienteId(f.cliente_id)
        setFecha(f.fecha ? new Date(f.fecha).toISOString().split('T')[0] : "")
        setEstado(f.estado)

        // Mapear líneas
        let processedLines: Linea[] = []
        if (f.lineas && f.lineas.length > 0) {
            processedLines = f.lineas.map((l: any) => ({
                id: l.id || Date.now() + Math.random(),
                descripcion: l.descripcion,
                cantidad: parseFloat(l.cantidad) || 0,
                precio_unitario: parseFloat(l.precio_unitario) || 0,
                iva: parseFloat(l.iva_percent || l.iva || 0),
                concepto_id: l.concepto_id,
                original_desc: l.descripcion
            }))
        } else {
            processedLines = [{ id: Date.now(), descripcion: "", cantidad: 1, precio_unitario: 0, iva: 21 }]
        }

        console.info("Factura loaded:", f)
        console.info("Processed lines for state:", processedLines)
        setSelectedTrabajos(f.work_log_ids || [])
        setLineas(processedLines)

      } catch (err) {
        console.error("Error init edit page:", err)
        toast.error("Error cargando factura")
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [id, router])

  const fetchConceptos = async (cId: number | null) => {
    setLoadingConceptos(true)
    try {
      const res = await api.get(`/admin/facturacion/conceptos?cliente_id=${cId || ''}`)
      setConceptos(res.data.data || [])
    } catch (err) {
      console.error("Error cargando conceptos", err)
    } finally {
      setLoadingConceptos(false)
    }
  }

  useEffect(() => {
    fetchConceptos(clienteId)
    if (clienteId) {
        fetchTrabajosPendientes(clienteId)
    }
  }, [clienteId])

  const fetchTrabajosPendientes = async (cId: number | string) => {
    setLoadingTrabajos(true)
    try {
        const res = await api.get(`/admin/clientes/${cId}/trabajos-pendientes`)
        const data = Array.isArray(res.data) ? res.data : []
        
        // Incluir los trabajos que YA están seleccionados para esta factura
        // pero que no aparecen en pendientes porque ya tienen factura_id
        setTrabajosPendientes(data.filter((d: any) => d.tipo === 'trabajo'))
    } catch (err) {
        console.error("Error cargando trabajos", err)
    } finally {
        setLoadingTrabajos(false)
    }
  }

  const handleImportTrabajos = () => {
    const selectedData = trabajosPendientes.filter(t => selectedTrabajos.includes(t.id))
    
    const nuevasLineas: Linea[] = selectedData.map(t => ({
        id: Date.now() + Math.random(),
        descripcion: t.descripcion || `Trabajo realizado el ${format(new Date(t.fecha), 'dd/MM/yyyy')}`,
        cantidad: 1,
        precio_unitario: Number(t.valor),
        iva: 21
    }))

    if (lineas.length === 1 && !lineas[0].descripcion && lineas[0].precio_unitario === 0) {
        setLineas(nuevasLineas)
    } else {
        setLineas([...lineas, ...nuevasLineas])
    }
    
    toast.success(`${nuevasLineas.length} trabajos importados`)
  }

  // --- LOGIC ---

  const handleAddLine = () => {
    setLineas([
      ...lineas, 
      { id: Date.now(), descripcion: "", cantidad: 1, precio_unitario: 0, iva: 21 }
    ])
  }

  const handleRemoveLine = (lineaId: number) => {
    if (lineas.length === 1) return
    setLineas(lineas.filter(l => l.id !== lineaId))
  }

  const updateLine = (lineaId: number, field: keyof Linea, value: any) => {
    setLineas(lineas.map(l => 
      l.id === lineaId ? { ...l, [field]: value } : l
    ))
  }

  const handleSelectConcepto = (lineaId: number, concepto: Concepto) => {
    setLineas(lineas.map(l => 
      l.id === lineaId ? { 
        ...l, 
        descripcion: concepto.descripcion || concepto.nombre,
        precio_unitario: Number(concepto.precio_unitario || 0),
        iva: Number(concepto.iva_default || 21),
        concepto_id: concepto.id,
        original_desc: concepto.descripcion || concepto.nombre
      } : l
    ))
  }

  const handleBlurDescription = (linea: Linea) => {
    if (linea.concepto_id && linea.descripcion !== linea.original_desc) {
        toast("Concepto modificado", {
            description: "¿Deseas actualizar el concepto original o guardarlo como uno nuevo?",
            action: {
                label: "Actualizar",
                onClick: () => updateConceptRecord(linea)
            },
            cancel: {
                label: "Guardar Nuevo",
                onClick: () => handleSaveAsConcept(linea)
            }
        })
    } 
  }

  const updateConceptRecord = async (linea: Linea) => {
    try {
        await api.put(`/admin/facturacion/conceptos/${linea.concepto_id}`, {
            nombre: linea.descripcion.substring(0, 50),
            descripcion: linea.descripcion,
            precio_unitario: linea.precio_unitario,
            iva_default: linea.iva,
            cliente_id: clienteId
        })
        toast.success("Concepto original actualizado")
        setLineas(lineas.map(l => l.id === linea.id ? {...l, original_desc: l.descripcion} : l))
    } catch (err) {
        toast.error("Error al actualizar concepto")
    }
  }

  const handleSaveAsConcept = async (linea: Linea) => {
    if (!linea.descripcion) {
        toast.error("Añade una descripción primero")
        return
    }
    try {
        await api.post('/admin/facturacion/conceptos', {
            nombre: linea.descripcion.substring(0, 50),
            descripcion: linea.descripcion,
            precio_unitario: linea.precio_unitario,
            iva_default: linea.iva,
            cliente_id: clienteId
        })
        toast.success("Concepto guardado para futuros usos")
        fetchConceptos(clienteId)
    } catch (err) {
        toast.error("Error al guardar concepto")
    }
  }

  const subtotal = lineas.reduce((acc, l) => acc + (l.cantidad * l.precio_unitario), 0)
  
  // Agrupar por tipo de IVA
  const ivaBreakdown = lineas.reduce((acc, l) => {
    const base = l.cantidad * l.precio_unitario;
    const cuota = base * (l.iva / 100);
    if (!acc[l.iva]) {
      acc[l.iva] = { base: 0, cuota: 0 };
    }
    acc[l.iva].base += base;
    acc[l.iva].cuota += cuota;
    return acc;
  }, {} as Record<number, { base: number, cuota: number }>);

  const ivaTotal = Object.values(ivaBreakdown).reduce((acc, b) => acc + b.cuota, 0);
  const total = subtotal + ivaTotal;

  const handleSubmit = async () => {
    if (!clienteId) {
      toast.error("Debes seleccionar un cliente")
      return
    }
    if (lineas.some(l => !l.descripcion)) {
      toast.error("Todas las líneas deben tener descripción")
      return
    }

    setSaving(true)
    try {
      const payload = {
        cliente_id: clienteId,
        fecha: fecha,
        lineas: lineas.map(({ id, ...rest }) => rest),
        work_log_ids: selectedTrabajos
      }

      await api.put(`/admin/facturacion/facturas/${id}`, payload)
      toast.success("Factura actualizada correctamente")
      router.push("/admin/facturacion/listado")
    } catch (error: any) {
      console.error(error)
      toast.error(error.response?.data?.error || "Error al actualizar factura")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen pb-20 pt-10">
         <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
    </div>
  )

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
      
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            Editar Factura
            <span className="text-slate-400 font-normal text-lg">#{numero}</span>
          </h1>
          <p className="text-slate-500 text-sm">Modificar borrador existente</p>
        </div>
      </div>

      <div className="space-y-6">
        
        {/* PARTE SUPERIOR: Cabecera */}
        <div className="space-y-6">
          
          {/* Card: Cliente y Fecha */}
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              
              <div className="space-y-2">
                <Label>Cliente</Label>
                <Popover open={clienteOpen} onOpenChange={setClienteOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={clienteOpen}
                      className="w-full justify-between bg-white h-12"
                    >
                      {clienteId
                        ? clientes.find((c) => c.id === clienteId)?.nombre || "Cliente desconocido"
                        : <span className="text-slate-400">Seleccionar cliente...</span>}
                      <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[400px] p-0">
                    <Command>
                        <CommandInput placeholder="Buscar cliente..." />
                        <CommandEmpty>No encontrado.</CommandEmpty>
                        <CommandGroup className="max-h-[300px] overflow-auto p-2">
                            {clientes.map((cliente) => (
                                <CommandItem
                                    key={cliente.id}
                                    value={cliente.nombre}
                                    onSelect={() => {
                                        setClienteId(cliente.id)
                                        setClienteOpen(false)
                                    }}
                                >
                                    <Check
                                        className={cn(
                                            "mr-2 h-4 w-4",
                                            clienteId === cliente.id ? "opacity-100" : "opacity-0"
                                        )}
                                    />
                                    <div className="flex flex-col">
                                        <span className="font-medium text-slate-900">{cliente.nombre}</span>
                                        <span className="text-xs text-slate-500">{cliente.nif}</span>
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Fecha de Emisión</Label>
                <div className="relative">
                  <Input 
                    type="date" 
                    value={fecha} 
                    onChange={(e) => setFecha(e.target.value)}
                    className="bg-white h-12"
                  />
                  <CalendarIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>

            </CardContent>
          </Card>

          {/* Selector de Trabajos Pendientes (God Level) */}
          {clienteId && trabajosPendientes.length > 0 && (
            <Card className="border-blue-200 bg-blue-50/30 overflow-hidden">
                <div className="py-4 px-6 bg-blue-50/50 flex items-center justify-between">
                    <div className="text-sm font-bold flex items-center gap-2 text-blue-900">
                        <FileText className="w-4 h-4" />
                        Trabajos Pendientes de Facturar
                    </div>
                </div>
                <CardContent className="p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {trabajosPendientes.map(t => {
                            const isSel = selectedTrabajos.includes(t.id)
                            return (
                                <div 
                                    key={t.id}
                                    onClick={() => {
                                        if (isSel) setSelectedTrabajos(prev => prev.filter(id => id !== t.id))
                                        else setSelectedTrabajos(prev => [...prev, t.id])
                                    }}
                                    className={`
                                        p-3 rounded-lg border text-xs cursor-pointer transition-all flex items-start gap-3
                                        ${isSel ? "bg-white border-blue-500 shadow-sm ring-1 ring-blue-500/20" : "bg-white/50 border-slate-200 hover:border-blue-300"}
                                    `}
                                >
                                    <div className={`w-4 h-4 rounded mt-0.5 border flex items-center justify-center ${isSel ? "bg-blue-600 border-blue-600" : "border-slate-300"}`}>
                                        {isSel && <Check className="w-3 h-3 text-white" />}
                                    </div>
                                    <div className="flex-1 space-y-1">
                                        <div className="font-semibold text-slate-800 line-clamp-1">{t.descripcion}</div>
                                        <div className="flex items-center justify-between text-[10px] text-slate-500 font-medium">
                                            <span>{format(new Date(t.fecha), 'd MMM')}</span>
                                            <span className="text-blue-700 font-bold">{formatCurrency(t.valor)}</span>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                    {/* Botón de importación solo si hay nuevos seleccionados que NO están en lineas */}
                    <div className="mt-4 flex justify-end">
                        <Button size="sm" onClick={handleImportTrabajos} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6">
                            <Plus className="w-4 h-4 mr-2" /> 
                            IMPORTAR SELECCIONADOS
                        </Button>
                    </div>
                </CardContent>
            </Card>
          )}

          {/* Card: Líneas */}
          <Card className="border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-50 border-b border-slate-100 p-4 flex justify-between items-center">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                    <Calculator className="w-4 h-4 text-blue-600" />
                    Conceptos / Líneas
                </h3>
                <Button size="sm" variant="outline" onClick={handleAddLine} className="bg-white border-blue-200 text-blue-700 hover:bg-blue-50 h-9 px-4">
                    <Plus className="w-4 h-4 mr-2" /> Añadir Línea
                </Button>
            </div>
            
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="bg-white text-slate-500 font-medium">
                        <tr className="border-b border-slate-100">
                            <th className="p-4 text-left">Descripción / Servicio</th>
                            <th className="p-4 w-36 text-center">Cant.</th>
                            <th className="p-4 w-56 text-center">Precio Unit.</th>
                            <th className="p-4 min-w-[120px] text-center">IVA %</th>
                            <th className="p-4 w-44 text-right">Subtotal</th>
                            <th className="p-4 w-12"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {lineas.map((linea) => (
                            <motion.tr 
                                key={linea.id}
                                layout
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="bg-white hover:bg-slate-50/50 group"
                            >
                                <td className="p-4 align-top">
                                    <div className="relative group/desc w-full">
                                        <Textarea 
                                            rows={2}
                                            className="min-h-[100px] w-full border-slate-200 focus-visible:ring-blue-500 p-3 bg-white text-sm resize-none"
                                            placeholder="Escribe la descripción o busca un concepto..."
                                            value={linea.descripcion}
                                            onChange={(e) => updateLine(linea.id, 'descripcion', e.target.value)}
                                            onBlur={() => handleBlurDescription(linea)}
                                        />
                                        
                                        <div className="absolute right-2 bottom-2 flex gap-1 opacity-0 group-hover/desc:opacity-100 transition-opacity">
                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-blue-600 hover:bg-blue-50 rounded-full border border-blue-100 bg-white shadow-sm">
                                                        <Search className="w-4 h-4" />
                                                    </Button>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-[500px] p-0" align="start">
                                                    <Command>
                                                        <CommandInput placeholder="Buscar concepto guardado..." />
                                                        <CommandEmpty>No hay conceptos guardados.</CommandEmpty>
                                                        <CommandGroup className="max-h-[300px] overflow-auto p-2">
                                                            {conceptos.map((c) => (
                                                                <CommandItem
                                                                    key={c.id}
                                                                    className="rounded-lg p-3 cursor-pointer mb-1 border border-transparent hover:border-blue-100"
                                                                    onSelect={() => handleSelectConcepto(linea.id, c)}
                                                                >
                                                                    <div className="flex flex-col w-full gap-1">
                                                                        <div className="flex justify-between font-semibold text-slate-900">
                                                                            <span>{c.nombre}</span>
                                                                            <span className="text-blue-600">{formatCurrency(c.precio_unitario)}</span>
                                                                        </div>
                                                                        <span className="text-xs text-slate-500 italic line-clamp-2">{c.descripcion}</span>
                                                                    </div>
                                                                </CommandItem>
                                                            ))}
                                                        </CommandGroup>
                                                    </Command>
                                                </PopoverContent>
                                            </Popover>

                                            <Button 
                                                size="icon" 
                                                variant="ghost" 
                                                className="h-8 w-8 text-emerald-600 hover:bg-emerald-50 rounded-full border border-emerald-100 bg-white shadow-sm"
                                                onClick={() => handleSaveAsConcept(linea)}
                                                title="Guardar como concepto para reutilizar"
                                            >
                                                <Save className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </td>
                                <td className="p-4 align-top">
                                    <Input 
                                        type="number" 
                                        min="0"
                                        step="0.01"
                                        className="h-10 w-full text-center border-slate-200"
                                        value={linea.cantidad || ""}
                                        onChange={(e) => updateLine(linea.id, 'cantidad', parseFloat(e.target.value) || 0)}
                                    />
                                </td>
                                <td className="p-4 align-top">
                                    <div className="relative">
                                        <Input 
                                            type="number" 
                                            step="0.01"
                                            className="h-10 w-full px-2 pr-6 text-right border-slate-200 font-medium"
                                            value={linea.precio_unitario || ""}
                                            onChange={(e) => updateLine(linea.id, 'precio_unitario', parseFloat(e.target.value) || 0)}
                                        />
                                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-normal">€</span>
                                    </div>
                                </td>
                                <td className="p-4 align-top">
                                    <Select 
                                        value={linea.iva.toString()} 
                                        onValueChange={(val) => updateLine(linea.id, 'iva', parseInt(val))}
                                    >
                                        <SelectTrigger className="h-10 w-[140px] mx-auto bg-white border-slate-200 text-slate-900 shadow-sm flex justify-between">
                                            <span className="font-medium">{linea.iva}%</span>
                                            <div className="hidden"><SelectValue /></div>
                                        </SelectTrigger>
                                        <SelectContent className="w-[140px] min-w-[140px]" align="center">
                                            <SelectItem value="21" className="cursor-pointer justify-center text-center">21%</SelectItem>
                                            <SelectItem value="10" className="cursor-pointer justify-center text-center">10%</SelectItem>
                                            <SelectItem value="4" className="cursor-pointer justify-center text-center">4%</SelectItem>
                                            <SelectItem value="0" className="cursor-pointer justify-center text-center">0%</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </td>
                                <td className="p-4 text-right font-bold text-slate-900 align-top pt-6">
                                    {formatCurrency(linea.cantidad * linea.precio_unitario)}
                                </td>
                                <td className="p-4 align-top pt-6 text-center">
                                    {lineas.length > 1 && (
                                        <button 
                                            onClick={() => handleRemoveLine(linea.id)}
                                            className="text-slate-300 hover:text-red-500 transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    )}
                                </td>
                            </motion.tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* SECCIÓN DE TOTALES */}
            <div className="border-t bg-slate-50/50 p-6 flex flex-col md:flex-row justify-between items-start gap-8 mt-2">
                <div className="w-full md:w-1/2">
                    <div className="bg-white border rounded-lg p-3 text-xs text-slate-500 italic max-w-sm">
                        Estás editando el borrador #{numero}. Los cambios no afectarán a Veri*Factu hasta que valides la factura.
                    </div>
                </div>

                <div className="w-full md:w-[400px] space-y-4">
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between text-slate-600 px-2">
                            <span>Base Imponible</span>
                            <span className="font-medium">{formatCurrency(subtotal)}</span>
                        </div>
                        
                        {Object.entries(ivaBreakdown).map(([pct, data]) => (
                            <div key={pct} className="flex justify-between text-slate-500 pl-4">
                                <span>I.V.A. {pct}%</span>
                                <span>{formatCurrency(data.cuota)}</span>
                            </div>
                        ))}

                        <div className="flex justify-between font-medium text-slate-900 py-2 border-t border-slate-200 mt-2 px-2">
                            <span>CUOTA IVA TOTAL</span>
                            <span>{formatCurrency(ivaTotal)}</span>
                        </div>
                        
                        <div className="bg-blue-600 text-white rounded-xl p-4 flex justify-between items-center shadow-lg shadow-blue-200">
                            <span className="font-bold text-lg">TOTAL FACTURA</span>
                            <span className="font-black text-2xl">{formatCurrency(total)}</span>
                        </div>
                    </div>

                    <div className="pt-4 flex gap-3">
                        <Button 
                            className="flex-1 bg-blue-700 hover:bg-blue-800 text-white h-12 text-lg shadow-lg"
                            onClick={handleSubmit}
                            disabled={saving}
                        >
                            {saving ? (
                                <span className="flex items-center gap-2">
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Guardando...
                                </span>
                            ) : (
                                <span className="flex items-center gap-2 font-bold">
                                    <Save className="w-5 h-5" /> GUARDAR CAMBIOS
                                </span>
                            )}
                        </Button>
                        <Button 
                            variant="ghost" 
                            className="text-slate-500 hover:bg-slate-100 px-6"
                            onClick={() => router.back()}
                            disabled={saving}
                        >
                            Cancelar
                        </Button>
                    </div>
                </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function EditSkeleton() {
    return (
        <div className="max-w-5xl mx-auto space-y-6 pb-20">
            <div className="h-10 w-48 bg-slate-200 rounded animate-pulse" />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <Skeleton className="h-48 w-full" />
                    <Skeleton className="h-96 w-full" />
                </div>
                <div className="lg:col-span-1">
                    <Skeleton className="h-64 w-full" />
                </div>
            </div>
        </div>
    )
}
