"use client"

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Search,
  Filter,
  MoreVertical,
  AlertCircle,
  FileCheck,
  FileX,
  RefreshCcw,
  Download,
  Mail,
  Eye,
  Plus,
  Trash2,
  Calendar as CalendarIcon,
  ChevronsUpDown,
  FileText,
  Loader2
} from "lucide-react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { UniversalExportButton } from "@/components/shared/UniversalExportButton"

import { api } from "@/services/api"
import { formatCurrency } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// --- COMPONENTS ---

export default function FacturasListadoPage() {
  const router = useRouter()
  
  // Estados de control
  const [loading, setLoading] = useState(true)
  const [facturas, setFacturas] = useState<any[]>([])
  const [filteredFacturas, setFilteredFacturas] = useState<any[]>([])
  
  // Filtros
  const [searchTerm, setSearchTerm] = useState("")
  const [estadoFilter, setEstadoFilter] = useState("TODOS")
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear().toString())

  // Acciones
  const [procesandoId, setProcesandoId] = useState<number | null>(null)
  const [downloadingId, setDownloadingId] = useState<number | null>(null)
  const [facturaToDelete, setFacturaToDelete] = useState<any>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [facturaToAnular, setFacturaToAnular] = useState<any>(null)

  // Cargar datos
  const loadFacturas = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get(`/admin/facturacion/facturas?year=${yearFilter}`)
      if (res.data && res.data.data) {
        setFacturas(res.data.data)
        setFilteredFacturas(res.data.data)
      }
    } catch (error) {
      console.error(error)
      toast.error("Error al cargar las facturas")
    } finally {
      setLoading(false)
    }
  }, [yearFilter])

  useEffect(() => {
    loadFacturas()
  }, [loadFacturas])

  // Filtrado local (búsqueda y estado)
  useEffect(() => {
    let result = facturas

    if (estadoFilter !== "TODOS") {
      result = result.filter(f => f.estado === estadoFilter)
    }

    if (searchTerm) {
      const lowerIds = searchTerm.toLowerCase()
      result = result.filter(f => 
        f.numero?.toLowerCase().includes(lowerIds) ||
        f.cliente_nombre?.toLowerCase().includes(lowerIds) ||
        f.total.toString().includes(lowerIds)
      )
    }

    setFilteredFacturas(result)
  }, [facturas, estadoFilter, searchTerm])


  // --- ACCIONES ---

  const handleValidar = async (id: number) => {
    if (procesandoId) return
    setProcesandoId(id)
    try {
      await api.post(`/admin/facturacion/facturas/${id}/validar`, {
        fecha: new Date().toISOString().split('T')[0]
      })
      toast.success("Factura validada correctamente")
      loadFacturas()
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Error al validar la factura")
    } finally {
      setProcesandoId(null)
    }
  }

  const handleGenerarPDF = async (id: number) => {
    if (downloadingId) return
    setDownloadingId(id)
    
    try {
        await api.get(`/admin/facturacion/facturas/${id}/pdf?action=save`)
        toast.success("PDF Generado y guardado correctamente")
        loadFacturas() // Recargar para actualizar estado y mostrar botón de descargar
    } catch (error) {
        console.error(error)
        toast.error("Error al generar PDF")
    } finally {
        setDownloadingId(null)
    }
  }

  const handleOpenPreview = async (id: number) => {
      try {
          setProcesandoId(id)
          const res = await api.get(`/admin/facturacion/facturas/${id}/pdf`, { responseType: 'blob' })
          const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
          setPreviewUrl(url)
          setIsPreviewOpen(true)
          toast.success("Vista previa generada")
      } catch (e) {
          toast.error("No se pudo cargar la vista previa")
      } finally {
          setProcesandoId(null)
      }
  }

  const handleOpenPDF = (id: number) => {
      // Usamos el token para descargar a través del API para que sea seguro
      api.get(`/admin/facturacion/facturas/${id}/pdf`, { responseType: 'blob' })
         .then(res => {
             const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
             window.open(url, '_blank')
             toast.success("Descarga iniciada")
         })
         .catch(() => toast.error("Error al descargar PDF"))
  }

  const handleAnular = async () => {
    if (!facturaToAnular) return
    const id = facturaToAnular.id

    if (procesandoId) return
    setProcesandoId(id)
    try {
      await api.post(`/admin/facturacion/facturas/${id}/anular`, { motivo: "Anulación solicitada desde listado" })
      toast.success("Factura anulada y rectificativa generada")
      setFacturaToAnular(null)
      loadFacturas()
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Error al anular")
    } finally {
      setProcesandoId(null)
    }
  }

  const handleDelete = async () => {
    if (!facturaToDelete) return
    setProcesandoId(facturaToDelete.id)
    try {
      await api.delete(`/admin/facturacion/facturas/${facturaToDelete.id}`)
      toast.success("Borrador eliminado")
      loadFacturas()
      setFacturaToDelete(null)
    } catch (error: any) {
      toast.error("No se pudo eliminar")
    } finally {
      setProcesandoId(null)
    }
  }

  return (
    <div className="space-y-6">
      
      {/* --- HEADER Y FILTROS --- */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input 
            placeholder="Buscar por cliente, número..." 
            className="pl-10 bg-white"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="flex items-center gap-2 w-full md:w-auto">
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger className="w-[100px] bg-white cursor-pointer">
              <SelectValue placeholder="Año" />
            </SelectTrigger>
            <SelectContent>
                {Array.from({length: 5}, (_, i) => new Date().getFullYear() - i).map(year => (
                    <SelectItem key={year} value={year.toString()} className="cursor-pointer">{year}</SelectItem>
                ))}
            </SelectContent>
          </Select>

          <Select value={estadoFilter} onValueChange={setEstadoFilter}>
            <SelectTrigger className="w-[140px] bg-white cursor-pointer">
              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5" />
                <SelectValue placeholder="Estado" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TODOS" className="cursor-pointer">Todos</SelectItem>
              <SelectItem value="VALIDADA" className="cursor-pointer">Validadas</SelectItem>
              <SelectItem value="BORRADOR" className="cursor-pointer">Borradores</SelectItem>
              <SelectItem value="ANULADA" className="cursor-pointer">Anuladas</SelectItem>
            </SelectContent>
          </Select>

          <UniversalExportButton 
            module="facturas"
            queryParams={{
                year: yearFilter,
                estado: estadoFilter
            }}
            label="Exportar Listado"
          />
        </div>
      </div>

      {/* --- TABLA DE FACTURAS --- */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Header Tabla */}
        <div className="grid grid-cols-12 gap-4 p-4 border-b bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <div className="col-span-2 md:col-span-1">Estado</div>
            <div className="col-span-3 md:col-span-2">Número / Fecha</div>
            <div className="col-span-4 md:col-span-3">Cliente</div>
            <div className="col-span-3 md:col-span-1 text-center hidden md:block">Pago</div>
            <div className="col-span-3 md:col-span-2 text-right">Importe</div>
            <div className="col-span-12 md:col-span-3 text-right hidden md:block">Acciones</div>
        </div>

        {loading ? (
           <div className="flex items-center justify-center py-20">
             <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
           </div>
        ) : filteredFacturas.length === 0 ? (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center">
                <FileX className="w-10 h-10 mb-2 opacity-20" />
                <p>No se encontraron facturas</p>
                {estadoFilter !== 'TODOS' && (
                    <Button variant="link" onClick={() => setEstadoFilter('TODOS')}>Limpiar filtros</Button>
                )}
            </div>
        ) : (
            <div className="divide-y divide-slate-100">
                <AnimatePresence>
                    {filteredFacturas.map((factura) => (
                        <FacturaRow 
                            key={factura.id} 
                            factura={factura} 
                            onValidar={() => handleValidar(factura.id)}
                            onAnular={() => setFacturaToAnular(factura)}
                            onDelete={() => setFacturaToDelete(factura)}
                            onEdit={() => router.push(`/admin/facturacion/editar/${factura.id}`)}
                            isProcessing={procesandoId === factura.id}
                            isDownloading={downloadingId === factura.id}
                            isGlobalBusy={!!procesandoId || !!downloadingId}
                            onGenerar={() => handleGenerarPDF(factura.id)}
                            onOpen={() => handleOpenPDF(factura.id)}
                            onPreview={() => handleOpenPreview(factura.id)}
                        />
                    ))}
                </AnimatePresence>
            </div>
        )}
      </div>

      {/* Diálogo Confirmar Borrado */}
      <AlertDialog open={!!facturaToDelete} onOpenChange={() => setFacturaToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar borrador?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. La factura en borrador será eliminada permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
                onClick={handleDelete} 
                className="bg-red-600 hover:bg-red-700"
                disabled={!!procesandoId}
            >
              {procesandoId ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diálogo Confirmar Anulación */}
      <AlertDialog open={!!facturaToAnular} onOpenChange={() => setFacturaToAnular(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
               <FileX className="w-5 h-5" />
               ¿Anular Factura?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se emitirá una factura rectificativa para anular la factura <strong>{facturaToAnular?.numero}</strong>. Esta acción es irreversible y cumplirá con la normativa Veri*Factu.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
                onClick={handleAnular} 
                className="bg-red-600 hover:bg-red-700"
                disabled={!!procesandoId}
            >
              {procesandoId ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Confirmar Anulación
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Visor de PDF Rápido */}
      <Dialog open={isPreviewOpen} onOpenChange={(open) => {
          if(!open) {
              if(previewUrl) window.URL.revokeObjectURL(previewUrl)
              setPreviewUrl(null)
          }
          setIsPreviewOpen(open)
      }}>
          <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 overflow-hidden border-none shadow-2xl">
              <DialogHeader className="p-4 border-b bg-slate-50 flex-shrink-0">
                  <DialogTitle className="flex items-center gap-2">
                       <FileText className="w-5 h-5 text-blue-600" />
                       Vista Previa de Factura
                  </DialogTitle>
              </DialogHeader>
              <div className="flex-1 bg-slate-100 flex items-center justify-center p-4">
                  {previewUrl ? (
                      <iframe src={previewUrl} className="w-full h-full rounded shadow-sm bg-white" />
                  ) : (
                      <Loader2 className="w-10 h-10 animate-spin text-blue-400" />
                  )}
              </div>
          </DialogContent>
      </Dialog>
    </div>
  )
}

function FacturaRow({ factura, onValidar, onGenerar, onOpen, onPreview, onAnular, onDelete, onEdit, isProcessing, isDownloading, isGlobalBusy }: any) {
    const isBorrador = factura.estado === "BORRADOR"
    const isValidada = factura.estado === "VALIDADA"
    const isAnulada = factura.estado === "ANULADA"

    // Determinar estado de pago
    const pagado = Number(factura.pagado || 0)
    const total = Number(factura.total || 0)
    const estadoPago = factura.estado_pago || (pagado >= total - 0.01 ? 'pagado' : pagado > 0 ? 'parcial' : 'pendiente')

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-slate-50 transition-colors group"
        >
            {/* Estado */}
            <div className="col-span-2 md:col-span-1">
                {isBorrador && <Badge variant="secondary" className="bg-slate-100 text-slate-600">Borrador</Badge>}
                {isValidada && <Badge className="bg-green-100 text-green-700 hover:bg-green-100 shadow-none border-0">Validada</Badge>}
                {isAnulada && <Badge variant="destructive" className="bg-red-100 text-red-700 hover:bg-red-100 shadow-none border-0">Anulada</Badge>}
            </div>

            {/* Número y Fecha */}
            <div className="col-span-3 md:col-span-2 flex flex-col">
                <span className="font-semibold text-slate-900 text-sm">
                    {factura.numero || "—"}
                </span>
                <span className="text-xs text-slate-500 flex items-center gap-1">
                    <CalendarIcon className="w-3 h-3" />
                    {format(new Date(factura.fecha), "d MMM yyyy", { locale: es })}
                </span>
            </div>

            {/* Cliente */}
            <div className="col-span-4 md:col-span-3">
                <div className="font-medium text-slate-800 text-sm truncate">
                    {factura.cliente_nombre || <span className="text-slate-400 italic">Cliente sin asignar</span>}
                </div>
                <div className="text-xs text-slate-500 truncate hidden sm:block">
                    {factura.cliente?.nif || ""}
                </div>
            </div>

            {/* Estado de Pago */}
            <div className="col-span-3 md:col-span-1 hidden md:flex justify-center">
                {isValidada && (
                    <>
                        {estadoPago === 'pagado' && (
                            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 shadow-none border-0 text-xs">
                                Pagada
                            </Badge>
                        )}
                        {estadoPago === 'parcial' && (
                            <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 shadow-none border-0 text-xs">
                                Parcial
                            </Badge>
                        )}
                        {estadoPago === 'pendiente' && (
                            <Badge className="bg-red-100 text-red-700 hover:bg-red-100 shadow-none border-0 text-xs">
                                Pendiente
                            </Badge>
                        )}
                    </>
                )}
                {(isBorrador || isAnulada) && (
                    <span className="text-xs text-slate-400">—</span>
                )}
            </div>

            {/* Importe */}
            <div className="col-span-3 md:col-span-2 text-right">
                <div className="font-bold text-slate-900">
                    {formatCurrency(factura.total)}
                </div>
                <div className="text-xs text-slate-500">
                    + {formatCurrency(factura.iva_total)} IVA
                </div>
            </div>

            {/* Acciones */}
            <div className="col-span-12 md:col-span-3 flex justify-end gap-2 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                
                {/* BORRADOR: Editar / Validar / Borrar */}
                {isBorrador && (
                    <>
                         <Button size="sm" variant="ghost" onClick={onEdit} disabled={isGlobalBusy} title="Editar borrador" className="flex items-center gap-2">
                            <Eye className="w-4 h-4 text-slate-500" />
                            <span className="text-xs">Editar</span>
                        </Button>
                        <Button 
                            size="sm" 
                            className="bg-green-600 hover:bg-green-700 text-white h-8"
                            onClick={onValidar}
                            disabled={isGlobalBusy}
                        >
                            {isProcessing ? <RefreshCcw className="w-3 h-3 animate-spin" /> : "Validar"}
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={onDelete} disabled={isGlobalBusy}>
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    </>
                )}

                {/* VALIDADA: PDF / Email / Anular */}
                {isValidada && (
                    <>
                        {factura.storage_record_id ? (
                            <div className="flex gap-1">
                                <Button 
                                    size="sm" 
                                    variant="outline" 
                                    className="h-8 hover:bg-blue-50 text-blue-600 border-blue-200 shadow-sm transition-all active:scale-95" 
                                    onClick={onPreview}
                                    title="Vista Previa Rápida"
                                    disabled={isGlobalBusy}
                                >
                                    {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4 mr-1" />}
                                    VER 
                                </Button>
                                <Button 
                                    size="sm" 
                                    variant="ghost" 
                                    className="h-8 w-8 p-0 text-slate-500" 
                                    onClick={onOpen}
                                    title="Descargar PDF"
                                    disabled={isGlobalBusy}
                                >
                                    <Download className="w-4 h-4" />
                                </Button>
                            </div>
                        ) : (
                            <Button 
                                size="sm" 
                                variant="outline" 
                                className="h-8 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white border-blue-200 shadow-sm transition-all active:scale-95" 
                                onClick={onGenerar}
                                disabled={isGlobalBusy}
                            >
                                {isDownloading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
                                {isDownloading ? "CREANDO..." : "CREAR PDF"}
                            </Button>
                        )}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" disabled={isGlobalBusy}>
                                    <MoreVertical className="w-4 h-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48 shadow-xl">
                                <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                                <DropdownMenuItem onClick={() => {}} disabled className="cursor-not-allowed opacity-50">
                                    <Mail className="w-4 h-4 mr-2" /> Enviar por Email
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50 cursor-pointer" onClick={onAnular}>
                                    <FileX className="w-4 h-4 mr-2" /> Anular Factura
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </>
                )}

                {/* ANULADA: Solo ver */}
                {isAnulada && (
                    <Button size="sm" variant="ghost" disabled>
                        <AlertCircle className="w-4 h-4 mr-2" /> Anulada
                    </Button>
                )}
            </div>
        </motion.div>
    )
}
