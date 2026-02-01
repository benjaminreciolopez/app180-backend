"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { 
  HardDrive, 
  Folder, 
  FileText, 
  Download, 
  Trash2, 
  Upload, 
  Search,
  ChevronRight,
  MoreVertical,
  Plus,
  FileIcon,
  Clock,
  LayoutGrid,
  List
} from "lucide-react"
import { api } from "@/services/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { cn } from "@/lib/utils"

interface FileInfo {
  id: string
  nombre: string
  folder: string
  mime_type: string
  size_bytes: number
  created_at: string
}

interface StorageStats {
  used_bytes: number
  total_limit_bytes: number
}

const DEFAULT_FOLDERS = ["facturas", "logos", "general"]

export default function AlmacenamientoPage() {
  const [loading, setLoading] = useState(true)
  const [files, setFiles] = useState<FileInfo[]>([])
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [currentFolder, setCurrentFolder] = useState("facturas")
  const [searchTerm, setSearchTerm] = useState("")
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [uploading, setUploading] = useState(false)

  const fetchFiles = async () => {
    try {
      setLoading(true)
      const res = await api.get(`/admin/storage/files?folder=${currentFolder}`)
      if (res.data.success) {
        setFiles(res.data.data)
        setStats(res.data.stats)
      }
    } catch (err) {
      toast.error("Error al cargar archivos")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchFiles()
  }, [currentFolder])

  const handleDelete = async (id: string) => {
    if (!confirm("¿Seguro que quieres eliminar este archivo?")) return
    try {
      await api.delete(`/admin/storage/files/${id}`)
      toast.success("Archivo eliminado")
      fetchFiles()
    } catch (err) {
      toast.error("Error al eliminar")
    }
  }

  const handleDownload = (id: string) => {
    // Redirigir directamente al endpoint de descarga
    window.open(`${process.env.NEXT_PUBLIC_API_URL}/admin/storage/files/${id}/download`, '_blank')
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('folder', currentFolder)

    try {
      await api.post('/admin/storage/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      toast.success("Archivo subido correctamente")
      fetchFiles()
    } catch (err) {
      toast.error("Error al subir archivo")
    } finally {
      setUploading(false)
    }
  }

  const filteredFiles = files.filter(f => 
    f.nombre.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const usedPercentage = stats ? (stats.used_bytes / stats.total_limit_bytes) * 100 : 0
  const progressColor = usedPercentage > 85 ? "bg-red-500" : usedPercentage > 60 ? "bg-amber-500" : "bg-emerald-500"

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div className="p-4 md:p-8 space-y-8 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
            <HardDrive className="w-8 h-8 text-blue-600" />
            Almacenamiento
          </h1>
          <p className="text-slate-500">Gestiona tus facturas, logos y otros documentos importantes.</p>
        </div>
        
        <div className="flex items-center gap-2">
           <label className="cursor-pointer">
              <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading} />
              <Button className="bg-blue-600 hover:bg-blue-700" disabled={uploading}>
                {uploading ? <Clock className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                {uploading ? "Subiendo..." : "Añadir Archivo"}
              </Button>
           </label>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar / Stats */}
        <div className="space-y-6">
          <Card className="border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500 uppercase tracking-wider">Estado de Almacenamiento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-end">
                <span className="text-2xl font-bold text-slate-900">{formatSize(stats?.used_bytes || 0)}</span>
                <span className="text-sm text-slate-500">de {formatSize(stats?.total_limit_bytes || 536870912)}</span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${usedPercentage}%` }}
                  className={cn("h-full transition-all duration-500", progressColor)}
                />
              </div>
              <p className="text-xs text-slate-500">
                Has utilizado el {usedPercentage.toFixed(1)}% de tu espacio total.
              </p>
            </CardContent>
          </Card>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900 px-2">Carpetas</h3>
            <div className="space-y-1">
              {DEFAULT_FOLDERS.map(folder => (
                <button
                  key={folder}
                  onClick={() => setCurrentFolder(folder)}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    currentFolder === folder 
                      ? "bg-blue-50 text-blue-700" 
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Folder className={cn("w-4 h-4", currentFolder === folder ? "text-blue-600" : "text-slate-400")} />
                    <span className="capitalize">{folder}</span>
                  </div>
                  {currentFolder === folder && <ChevronRight className="w-4 h-4" />}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Browser Area */}
        <div className="lg:col-span-3 space-y-4">
          <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-white p-3 border rounded-xl shadow-sm">
            <div className="relative w-full md:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input 
                placeholder="Buscar archivos..." 
                className="pl-10 h-10 border-slate-200"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <div className="flex items-center gap-2">
               <div className="flex border rounded-lg overflow-hidden bg-slate-50 p-1">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className={cn("h-8 w-8", viewMode === 'grid' && "bg-white shadow-sm text-blue-600")}
                    onClick={() => setViewMode('grid')}
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className={cn("h-8 w-8", viewMode === 'list' && "bg-white shadow-sm text-blue-600")}
                    onClick={() => setViewMode('list')}
                  >
                    <List className="w-4 h-4" />
                  </Button>
               </div>
            </div>
          </div>

          <div className="min-h-[500px]">
            {loading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                  <div key={i} className="h-40 bg-slate-50 animate-pulse rounded-xl border border-slate-100" />
                ))}
              </div>
            ) : filteredFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                 <FileIcon className="w-16 h-16 text-slate-200 mb-4" />
                 <h3 className="text-lg font-medium text-slate-600">No hay archivos en esta carpeta</h3>
                 <p className="text-sm text-slate-400">Sube tu primer archivo o factura validada.</p>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                <AnimatePresence>
                  {filteredFiles.map((file) => (
                    <motion.div
                      key={file.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="group relative bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-400 hover:shadow-lg transition-all"
                    >
                      <div className="absolute right-2 top-2">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleDelete(file.id)}
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      </div>
                      
                      <div className="aspect-square flex items-center justify-center bg-slate-50 rounded-lg mb-3">
                         <FileText className="w-12 h-12 text-blue-500 opacity-80" />
                      </div>
                      
                      <div className="space-y-1">
                        <p className="font-medium text-sm text-slate-900 truncate" title={file.nombre}>{file.nombre}</p>
                        <div className="flex items-center justify-between">
                           <span className="text-[10px] text-slate-500 uppercase">{formatSize(file.size_bytes)}</span>
                           <Button 
                              variant="link" 
                              className="h-auto p-0 text-blue-600 text-xs font-semibold"
                              onClick={() => handleDownload(file.id)}
                            >
                             <Download className="w-3.5 h-3.5 mr-1" /> Descargar
                           </Button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            ) : (
              <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
                 <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500 font-medium">
                      <tr>
                        <th className="p-4">Nombre</th>
                        <th className="p-4">Tamaño</th>
                        <th className="p-4">Fecha</th>
                        <th className="p-4 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredFiles.map(file => (
                        <tr key={file.id} className="hover:bg-slate-50 transition-colors">
                          <td className="p-4 flex items-center gap-3">
                             <FileText className="w-4 h-4 text-blue-500" />
                             <span className="font-medium text-slate-900">{file.nombre}</span>
                          </td>
                          <td className="p-4 text-slate-500">{formatSize(file.size_bytes)}</td>
                          <td className="p-4 text-slate-500">{format(new Date(file.created_at), "dd/MM/yyyy HH:mm", { locale: es })}</td>
                          <td className="p-4 text-right space-x-2">
                             <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleDownload(file.id)}>
                               <Download className="w-4 h-4 text-blue-600" />
                             </Button>
                             <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleDelete(file.id)}>
                               <Trash2 className="w-4 h-4 text-red-500" />
                             </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                 </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
