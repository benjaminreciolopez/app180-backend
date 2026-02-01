"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { 
  ArrowLeft, 
  Save, 
  User, 
  Calendar as CalendarIcon, 
  Plus, 
  Trash2,
  Calculator,
  Search,
  Check,
  Loader2
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

// --- TYPES ---
interface Linea {
  id: number // temporal ID for React keys
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

export default function CrearFacturaPage() {
  const router = useRouter()
  
  // Data State
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loadingClientes, setLoadingClientes] = useState(false)
  const [ivas, setIvas] = useState<any[]>([])
  
  // Form State
  const [clienteId, setClienteId] = useState<number | null>(null)
  const [fecha, setFecha] = useState<string>(new Date().toISOString().split("T")[0])
  const [lineas, setLineas] = useState<Linea[]>([
    { id: Date.now(), descripcion: "", cantidad: 1, precio_unitario: 0, iva: 21 }
  ])
  const [saving, setSaving] = useState(false)
  
  // UI State
  const [clienteOpen, setClienteOpen] = useState(false)
  const [conceptos, setConceptos] = useState<Concepto[]>([])
  const [loadingConceptos, setLoadingConceptos] = useState(false)

  // Cargar clientes al inicio
  useEffect(() => {
    const fetchClientes = async () => {
      setLoadingClientes(true)
      try {
        // Asumiendo endpoint existente. Si no, ajustar a /admin/clientes o similar
        const res = await api.get('/admin/clientes?') 
        // Manejar tanto formato estándar {success, data} como array plano legacy
        setClientes(res.data.data || (Array.isArray(res.data) ? res.data : []))
      } catch (err) {
        toast.error("Error cargando clientes")
      } finally {
        setLoadingClientes(false)
      }
    }
    fetchClientes()
    loadIvas()
  }, [])

  const loadIvas = async () => {
    try {
      const res = await api.get('/admin/facturacion/iva')
      setIvas(res.data)
    } catch (err) {
      console.error("Error loading IVAs", err)
      // Fallback
      setIvas([
        { porcentaje: 21 }, { porcentaje: 10 }, { porcentaje: 4 }, { porcentaje: 0 }
      ])
    }
  }

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
  }, [clienteId])

  // --- LOGIC ---

  const handleAddLine = () => {
    setLineas([
      ...lineas, 
      { id: Date.now(), descripcion: "", cantidad: 1, precio_unitario: 0, iva: 21 }
    ])
  }

  const handleRemoveLine = (id: number) => {
    if (lineas.length === 1) return // Keep at least one
    setLineas(lineas.filter(l => l.id !== id))
  }

  const updateLine = (id: number, field: keyof Linea, value: any) => {
    setLineas(lineas.map(l => 
      l.id === id ? { ...l, [field]: value } : l
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
    // Si es un concepto enlazado y ha cambiado
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
        // Actualizamos el original_desc localmente para no repetir el aviso
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

  // Cálculos totales
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
        lineas: lineas.map(({ id, ...rest }) => rest) // Remove temp ID
      }

      const res = await api.post('/admin/facturacion/facturas', payload) // Guardar borrador
      
      toast.success("Borrador creado correctamente")
      
      // Opcional: Redirigir a listado o a vista detalle
      router.push(`/admin/facturacion/listado`)
      
    } catch (error: any) {
      console.error(error)
      toast.error(error.response?.data?.error || "Error al guardar factura")
    } finally {
      setSaving(false)
    }
  }

  if (loadingClientes) {
    return (
        <div className="flex items-center justify-center min-h-screen pb-20 pt-10">
             <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
        </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
      
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Nueva Factura</h1>
          <p className="text-slate-500 text-sm">Crear un nuevo borrador de factura</p>
        </div>
      </div>

      <div className="space-y-6">
        
        {/* PARTE SUPERIOR: Datos Cabecera */}
        <div className="space-y-6">
          
          {/* Card: Cliente y Fecha */}
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Selector Cliente */}
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
                        ? clientes.find((c) => c.id === clienteId)?.nombre
                        : <span className="text-slate-400">Seleccionar cliente...</span>}
                      <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[400px] p-0">
                    <Command>
                      <CommandInput placeholder="Buscar cliente..." />
                      <CommandEmpty>No encontrado.</CommandEmpty>
                      <CommandGroup className="max-h-[300px] overflow-auto">
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

              {/* Selector Fecha */}
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
                <table className="w-full text-sm text-left table-fixed">
                    <thead className="bg-white text-slate-500 font-medium">
                        <tr className="border-b border-slate-100">
                            <th className="p-4 text-left">Descripción / Servicio</th>
                            <th className="p-4 w-28 text-center">Cant.</th>
                            <th className="p-4 w-44 text-center">Precio Unit.</th>
                            <th className="p-4 w-32 text-center">IVA %</th>
                            <th className="p-4 w-36 text-right">Subtotal</th>
                            <th className="p-4 w-12"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {lineas.map((linea, index) => (
                            <motion.tr 
                                key={linea.id}
                                initial={{ opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
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
                                        <SelectTrigger className="h-10">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {ivas.map((iva) => (
                                                <SelectItem key={iva.id || iva.porcentaje} value={iva.porcentaje.toString()}>
                                                    {iva.porcentaje}%
                                                </SelectItem>
                                            ))}
                                            {ivas.length === 0 && (
                                                <>
                                                    <SelectItem value="21">21%</SelectItem>
                                                    <SelectItem value="10">10%</SelectItem>
                                                    <SelectItem value="4">4%</SelectItem>
                                                    <SelectItem value="0">0%</SelectItem>
                                                </>
                                            )}
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

            {/* SECCIÓN DE TOTALES DEBAJO DE LA TABLA */}
            <div className="border-t bg-slate-50/50 p-6 flex flex-col md:flex-row justify-between items-start gap-8 mt-2">
                <div className="w-full md:w-1/2">
                    <div className="bg-white border rounded-lg p-3 text-xs text-slate-500 italic max-w-sm">
                        Consejo: Puedes guardar conceptos frecuentes con el icono <Save className="w-3 h-3 inline mx-1" /> para agilizar la creación de futuras facturas.
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
                                    <Save className="w-5 h-5" /> GUARDAR BORRADOR
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
