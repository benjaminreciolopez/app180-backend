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
  Loader2,
  CreditCard,
  MessageSquare,
  FileText
} from "lucide-react"
import { toast } from "sonner"
import { format } from "date-fns"

import { api } from "@/services/api"
import { formatCurrency } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

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

const LEGAL_IVA_TEXTS: Record<number, string> = {
  0: "FACTURA EXENTA DE IVA POR INVERSIÓN DEL SUJETO PASIVO (ART. 84 UNO 2º F LEY IVA 37/1992).",
  10: "IVA reducido según normativa vigente",
  4: "IVA superreducido según normativa vigente",
  21: ""
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
  const [mensajeIva, setMensajeIva] = useState("")
  const [metodoPago, setMetodoPago] = useState<"TRANSFERENCIA" | "CONTADO">("TRANSFERENCIA")
  const [emisorIban, setEmisorIban] = useState("")
  const [isIbanModalOpen, setIsIbanModalOpen] = useState(false)
  const [newIban, setNewIban] = useState("")
  const [ivaGlobal, setIvaGlobal] = useState(21)
  const [saving, setSaving] = useState(false)
  
  // UI State
  const [clienteOpen, setClienteOpen] = useState(false)
  const [conceptos, setConceptos] = useState<Concepto[]>([])
  const [loadingConceptos, setLoadingConceptos] = useState(false)
  const [trabajosPendientes, setTrabajosPendientes] = useState<any[]>([])
  const [loadingTrabajos, setLoadingTrabajos] = useState(false)
  const [selectedTrabajos, setSelectedTrabajos] = useState<string[]>([])

  // Column Resizing State
  const [colWidths, setColWidths] = useState<Record<string, number>>({
    cant: 130,
    precio: 200,
    iva: 180,
    subtotal: 160
  })

  // Cargar anchos de columna guardados
  useEffect(() => {
    const saved = localStorage.getItem('factura_col_widths')
    if (saved) {
      try {
        setColWidths(JSON.parse(saved))
      } catch (e) {
        console.error("Error parsing col widths", e)
      }
    }
  }, [])

  const saveWidths = (newWidths: Record<string, number>) => {
    setColWidths(newWidths)
    localStorage.setItem('factura_col_widths', JSON.stringify(newWidths))
  }

  const handleResize = (id: string, startX: number, startWidth: number) => {
    const onMove = (clientX: number) => {
      const delta = clientX - startX
      const newWidth = Math.max(80, startWidth + delta)
      saveWidths({ ...colWidths, [id]: newWidth })
    }

    const onMouseMove = (e: MouseEvent) => onMove(e.clientX)
    const onTouchMove = (e: TouchEvent) => onMove(e.touches[0].clientX)

    const onEnd = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onEnd)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onEnd)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onEnd)
    document.addEventListener('touchmove', onTouchMove)
    document.addEventListener('touchend', onEnd)
  }

  useEffect(() => {
    const fetchClientes = async () => {
      setLoadingClientes(true)
      try {
        const res = await api.get('/admin/clientes') 
        const data = res.data.data || (Array.isArray(res.data) ? res.data : [])
        setClientes(data)
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
      const configRes = await api.get('/admin/facturacion/configuracion/emisor')
      if (configRes.data.success) {
        setIvaGlobal(configRes.data.data.iva_global || 0)
        setEmisorIban(configRes.data.data.iban || "")
      }
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
    } else {
        setTrabajosPendientes([])
        setSelectedTrabajos([])
    }
  }, [clienteId])

  const fetchTrabajosPendientes = async (cId: number | string) => {
    setLoadingTrabajos(true)
    try {
        // Usamos el listado que unifica deudas pero filtrando solo trabajos
        const res = await api.get(`/admin/clientes/${cId}/trabajos-pendientes`)
        const data = Array.isArray(res.data) ? res.data : []
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
        iva: ivaGlobal || 21,
        work_log_id: t.id // Para tracking interno opcional
    }))

    // Si la única línea está vacía, la reemplazamos
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

  const handleRemoveLine = (id: number) => {
    if (lineas.length === 1) return // Keep at least one
    setLineas(lineas.filter(l => l.id !== id))
  }

  const updateLine = (id: number, field: keyof Linea, value: any) => {
    setLineas(lineas.map(l => {
      if (l.id === id) {
        // Si el campo es IVA y el nuevo valor tiene una descripción en la lista de IVAs,
        // y el mensaje_iva actual está vacío, lo sugerimos/ponemos.
        if (field === 'iva') {
            const selectedIva = ivas.find(i => i.porcentaje === value);
            // Si el IVA configurado tiene descripción, prevalece
            if (selectedIva?.descripcion && (!mensajeIva || mensajeIva.trim() === "")) {
                setMensajeIva(selectedIva.descripcion);
            } 
            // Si no tiene descripción pero hay un texto legal estándar, lo sugerimos
            else if (LEGAL_IVA_TEXTS[value as number] && (!mensajeIva || mensajeIva.trim() === "")) {
                setMensajeIva(LEGAL_IVA_TEXTS[value as number]);
            }
        }
        return { ...l, [field]: value };
      }
      return l;
    }));
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
        iva_global: ivaGlobal,
        mensaje_iva: mensajeIva,
        metodo_pago: metodoPago,
        lineas: lineas.map(({ id, ...rest }) => rest), // Remove temp ID
        work_log_ids: selectedTrabajos 
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
                      className="w-full justify-between bg-white h-12 cursor-pointer"
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
                            {clientes.map((cliente: any) => (
                              <CommandItem
                                key={cliente.id}
                                value={cliente.nombre}
                                onSelect={() => {
                                  setClienteId(cliente.id)
                                  setClienteOpen(false)
                                  // Si el cliente tiene IVA defecto o exención, sugerir mensaje
                                  if (cliente.exento_iva && cliente.texto_exento) {
                                    setMensajeIva(cliente.texto_exento)
                                  } else if (cliente.iva_defecto) {
                                      // Buscar si el IVA tiene descripción
                                      const ivaObj = ivas.find(i => i.porcentaje === cliente.iva_defecto)
                                      if (ivaObj?.descripcion) setMensajeIva(ivaObj.descripcion)
                                  }
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

          {/* Selector de Trabajos Pendientes (God Level) */}
          {clienteId && trabajosPendientes.length > 0 && (
            <Card className="border-blue-200 bg-blue-50/30 overflow-hidden">
                <CardHeader className="py-4 bg-blue-50/50">
                    <CardTitle className="text-sm font-bold flex items-center justify-between text-blue-900">
                        <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4" />
                            Trabajos Pendientes de Facturar
                        </div>
                        <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                            {trabajosPendientes.length} encontrados
                        </Badge>
                    </CardTitle>
                </CardHeader>
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
                    {selectedTrabajos.length > 0 && (
                        <div className="mt-4 flex justify-end">
                            <Button size="sm" onClick={handleImportTrabajos} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6">
                                <Plus className="w-4 h-4 mr-2" /> 
                                IMPORTAR {selectedTrabajos.length} SELECCIONADOS
                            </Button>
                        </div>
                    )}
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
                            
                            <th className="p-4 text-center relative" style={{ width: colWidths.cant }}>
                                Cant.
                                <div 
                                    className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-300 transition-colors z-10"
                                    onMouseDown={(e) => handleResize('cant', e.clientX, colWidths.cant)}
                                    onTouchStart={(e) => handleResize('cant', e.touches[0].clientX, colWidths.cant)}
                                />
                            </th>
                            
                            <th className="p-4 text-center relative" style={{ width: colWidths.precio }}>
                                Precio Unit.
                                <div 
                                    className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-300 transition-colors z-10"
                                    onMouseDown={(e) => handleResize('precio', e.clientX, colWidths.precio)}
                                    onTouchStart={(e) => handleResize('precio', e.touches[0].clientX, colWidths.precio)}
                                />
                            </th>
                            
                            <th className="p-4 text-center relative" style={{ minWidth: colWidths.iva }}>
                                IVA %
                                <div 
                                    className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-300 transition-colors z-10"
                                    onMouseDown={(e) => handleResize('iva', e.clientX, colWidths.iva)}
                                    onTouchStart={(e) => handleResize('iva', e.touches[0].clientX, colWidths.iva)}
                                />
                            </th>
                            
                            <th className="p-4 text-right relative" style={{ width: colWidths.subtotal }}>
                                Subtotal
                                <div 
                                    className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-300 transition-colors z-10"
                                    onMouseDown={(e) => handleResize('subtotal', e.clientX, colWidths.subtotal)}
                                    onTouchStart={(e) => handleResize('subtotal', e.touches[0].clientX, colWidths.subtotal)}
                                />
                            </th>

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
                                        <SelectTrigger className="h-10 w-[140px] mx-auto bg-white border-slate-200 text-slate-900 shadow-sm flex justify-between">
                                            <span className="font-medium">{linea.iva}%</span>
                                            <div className="hidden"><SelectValue /></div>
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
                                            className="text-slate-300 hover:text-red-500 transition-colors cursor-pointer"
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

                        <div className="space-y-3">
                            <Label className="text-slate-700 font-semibold flex items-center gap-2">
                                <CreditCard className="w-4 h-4 text-emerald-600" />
                                Método de Pago
                            </Label>
                            <Select 
                                value={metodoPago} 
                                onValueChange={(val: any) => {
                                    setMetodoPago(val)
                                    if (val === 'TRANSFERENCIA' && !emisorIban) {
                                        setIsIbanModalOpen(true)
                                    }
                                }}
                            >
                                <SelectTrigger className="w-full bg-white border-slate-200">
                                    <SelectValue placeholder="Seleccionar método" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="TRANSFERENCIA" className="cursor-pointer">Transferencia Bancaria</SelectItem>
                                    <SelectItem value="CONTADO" className="cursor-pointer">Al Contado / Efectivo</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-3">
                            <Label htmlFor="mensaje_iva" className="text-slate-700 font-semibold flex items-center gap-2">
                                <MessageSquare className="w-4 h-4 text-blue-600" />
                                Observaciones de IVA / Textos Legales
                            </Label>
                            <div className="flex flex-wrap gap-1 mb-2">
                                {Object.entries(LEGAL_IVA_TEXTS).map(([pct, text]) => (
                                    text && (
                                        <button
                                            key={pct}
                                            type="button"
                                            onClick={() => setMensajeIva(text)}
                                            className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-0.5 rounded transition-colors"
                                            title={text}
                                        >
                                            Legal {pct}%
                                        </button>
                                    )
                                ))}
                                <button
                                    type="button"
                                    onClick={() => setMensajeIva("Operación exenta según Art. 20 de la Ley 37/1992.")}
                                    className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-0.5 rounded transition-colors"
                                >
                                    Exento Art. 20
                                </button>
                            </div>

                            <Textarea 
                                id="mensaje_iva"
                                placeholder="Ej: Operación exenta de IVA según Art. 20..."
                                value={mensajeIva}
                                onChange={(e) => setMensajeIva(e.target.value)}
                                className="resize-none h-24 border-slate-200 focus:ring-blue-500 text-xs"
                            />
                            <p className="text-[10px] text-slate-400 italic">
                                * Este texto aparecerá en el PDF de la factura.
                            </p>
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
