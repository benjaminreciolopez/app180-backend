"use client"

import { useState, useEffect, useMemo } from "react"
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
  List,
  Loader2,
  ArrowLeft,
  FolderOpen,
  CheckSquare,
  Package,
  Eye
} from "lucide-react"
import { api } from "@/services/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "sonner"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { cn } from "@/lib/utils"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import JSZip from "jszip"
import { saveAs } from "file-saver"

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

// Tipo unificado para mostrar en el grid
type GridItem = 
  | { type: 'folder', name: string, fullPath: string }
  | { type: 'file', data: FileInfo }

export default function AlmacenamientoPage() {
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [loadingFolders, setLoadingFolders] = useState(true)
  
  // Estado real de los datos
  const [allDefinedPaths, setAllDefinedPaths] = useState<string[]>([])
  const [currentFiles, setCurrentFiles] = useState<FileInfo[]>([])
  const [stats, setStats] = useState<StorageStats | null>(null)
  
  // Estado de navegación
  const [currentPath, setCurrentPath] = useState<string>("") // "" es Root
  const [searchTerm, setSearchTerm] = useState("")
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [uploading, setUploading] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [isDeletingBulk, setIsDeletingBulk] = useState(false)

  // Selección
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())

  // 1. Cargar la estructura de carpetas
  const fetchStructure = async () => {
      try {
          setLoadingFolders(true)
          const res = await api.get('/admin/storage/folders')
          if (res.data.success) {
              const paths = res.data.data || []
              if (paths.length === 0) {
                 setAllDefinedPaths(["Facturas emitidas"])
              } else {
                 setAllDefinedPaths(paths)
              }
          }
      } catch (err) {
          console.error("Error fetching folders", err)
          setAllDefinedPaths(["Facturas emitidas"])
      } finally {
          setLoadingFolders(false)
      }
  }

  // 2. Cargar archivos de la carpeta actual
  const fetchFiles = async () => {
    try {
      setLoadingFiles(true)
      const res = await api.get(`/admin/storage/files?folder=${currentPath}`)
      if (res.data.success) {
        setCurrentFiles(res.data.data)
        setStats(res.data.stats)
      }
    } catch (err) {
      console.error("Error fetching files", err)
      toast.error("Error al cargar archivos")
    } finally {
      setLoadingFiles(false)
    }
  }

  useEffect(() => {
    fetchStructure()
  }, [])

  useEffect(() => {
    // Al cambiar de carpeta, limpiamos selecciones y recargamos
    setSelectedItems(new Set())
    fetchFiles()
  }, [currentPath])

  // 3. Calcular subcarpetas
  const subFolders = useMemo(() => {
    if (loadingFolders) return []
    const subs = new Set<string>()
    const prefix = currentPath ? `${currentPath}/` : ""
    
    allDefinedPaths.forEach(path => {
      if (path.startsWith(prefix)) {
        const remainder = path.slice(prefix.length)
        if (remainder) {
          const firstSegment = remainder.split('/')[0]
          if (firstSegment) subs.add(firstSegment)
        }
      }
    })
    return Array.from(subs).sort()
  }, [allDefinedPaths, currentPath, loadingFolders])

  // 4. Items combinados para el Grid
  const gridItems: GridItem[] = useMemo(() => {
    let items: GridItem[] = []
    
    // Agregar carpetas
    items = items.concat(subFolders.map(name => ({
      type: 'folder',
      name,
      fullPath: currentPath ? `${currentPath}/${name}` : name
    })))
    
    // Agregar archivos
    items = items.concat(currentFiles.map(file => ({
      type: 'file',
      data: file
    })))

    // Filtrar por búsqueda
    if (searchTerm) {
      const lower = searchTerm.toLowerCase()
      items = items.filter(item => {
        if (item.type === 'folder') return item.name.toLowerCase().includes(lower)
        return item.data.nombre.toLowerCase().includes(lower)
      })
    }
    
    return items
  }, [subFolders, currentFiles, searchTerm, currentPath])

  // Acciones
  const handleNavigate = (path: string) => {
    if (isDownloading) return // Bloqueo si hay descarga
    setSearchTerm("") 
    setCurrentPath(path)
  }

  const handleNavigateUp = () => {
    if (isDownloading) return 
    if (!currentPath) return
    const parts = currentPath.split('/')
    parts.pop()
    handleNavigate(parts.join('/'))
  }

  const handleDelete = async (id: string) => {
    if (isDownloading || deletingId) return
    if (!confirm("¿Seguro que quieres eliminar este archivo?")) return
    setDeletingId(id)
    try {
      await api.delete(`/admin/storage/files/${id}`)
      toast.success("Archivo eliminado")
      fetchFiles()
      fetchStructure() 
    } catch (err) {
      toast.error("Error al eliminar")
    } finally {
      setDeletingId(null)
    }
  }

  const handleDeleteBulk = async () => {
    if (isDownloading || isDeletingBulk) return
    if (!confirm(`¿Seguro que quieres eliminar ${selectedItems.size} archivos?`)) return
    
    setIsDeletingBulk(true)
    try {
        const promises = Array.from(selectedItems).map(id => api.delete(`/admin/storage/files/${id}`))
        await Promise.all(promises)
        toast.success(`${selectedItems.size} archivos eliminados`)
        setSelectedItems(new Set())
        fetchFiles()
        fetchStructure()
    } catch(err) {
        toast.error("Error eliminando algunos archivos")
    } finally {
        setIsDeletingBulk(false)
    }
  }

  const handleDownload = async (id: string, nombre: string) => {
    if (isDownloading) return
    try {
      setIsDownloading(true)
      const response = await api.get(`/admin/storage/files/${id}/download`, {
        responseType: 'blob',
      })
      
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', nombre)
      document.body.appendChild(link)
      link.click()
      
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      toast.error("Error al descargar el archivo")
    } finally {
      setIsDownloading(false)
    }
  }

  const handleBulkDownload = async () => {
      if (selectedItems.size === 0) return
      if (isDownloading) return

      try {
          setIsDownloading(true)
          toast.info("Iniciando descarga y compresión...")

          const zip = new JSZip()
          
          // Filtrar items seleccionados que sean archivos (no soportamos bajar carpetas en bulk aun)
          const filesToDownload = currentFiles.filter(f => selectedItems.has(f.id))
          
          let processed = 0
          
          const promises = filesToDownload.map(async (file) => {
              try {
                  const res = await api.get(`/admin/storage/files/${file.id}/download`, {
                      responseType: 'blob'
                  })
                  zip.file(file.nombre, res.data)
                  processed++
              } catch (err) {
                  console.error(`Error bajando ${file.nombre}`, err)
              }
          })

          await Promise.all(promises)

          if (processed === 0) {
              toast.error("Error al procesar archivos")
              return
          }

          toast.info("Generando ZIP...")
          const content = await zip.generateAsync({ type: "blob" })
          
          const zipName = `archivos_${currentPath.replace(/\//g, '_') || 'root'}_${format(new Date(), 'yyyyMMdd')}.zip`
          saveAs(content, zipName)

          toast.success("Descarga completada")
          setSelectedItems(new Set()) // Opcional: limpiar selección

      } catch (err) {
          console.error("Error bulk download", err)
          toast.error("Error al generar el archivo ZIP")
      } finally {
          setIsDownloading(false)
      }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isDownloading) return
    const file = e.target.files?.[0]
    if (!file) return

    const targetFolder = currentPath || "Facturas emitidas" // Default inteligente

    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('folder', targetFolder)

    try {
      await api.post('/admin/storage/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      toast.success("Archivo subido correctamente")
      fetchFiles()
      fetchStructure()
    } catch (err) {
      toast.error("Error al subir archivo")
    } finally {
        e.target.value = "" 
        setUploading(false)
    }
  }

  const toggleSelection = (id: string) => {
      if (isDownloading) return
      const newSet = new Set(selectedItems)
      if (newSet.has(id)) newSet.delete(id)
      else newSet.add(id)
      setSelectedItems(newSet)
  }

  const toggleSelectAll = () => {
      if (isDownloading) return
      if (selectedItems.size === currentFiles.length && currentFiles.length > 0) {
          setSelectedItems(new Set())
      } else {
          // Solo seleccionamos archivos, no carpetas de momento para simplificar
          const allIds = new Set(currentFiles.map(f => f.id))
          setSelectedItems(allIds)
      }
  }

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const breadcrumbSegments = useMemo(() => {
    return currentPath ? currentPath.split('/') : []
  }, [currentPath])

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-[1600px] mx-auto h-[calc(100vh-80px)] flex flex-col relative">
      
      {/* Overlay de Bloqueo / Descarga / Borrado */}
      <AnimatePresence>
          {(isDownloading || uploading || isDeletingBulk) && (
              <motion.div 
                 initial={{ opacity: 0 }}
                 animate={{ opacity: 1 }}
                 exit={{ opacity: 0 }}
                 className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-50 flex flex-col items-center justify-center rounded-xl"
              >
                  <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
                  <h3 className="text-xl font-semibold text-slate-800">
                      {isDownloading ? "Descargando archivos..." : uploading ? "Subiendo archivo..." : "Eliminando archivos..."}
                  </h3>
                  <p className="text-slate-500">Por favor espere, no cierre la ventana.</p>
              </motion.div>
          )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 flex-shrink-0">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
            <HardDrive className="w-8 h-8 text-blue-600" />
            Almacenamiento
          </h1>
          <p className="text-slate-500">Explorador de archivos corporativos.</p>
        </div>
        
        <div className="flex items-center gap-3">
             <div className="text-right hidden md:block">
                 <div className="text-sm font-medium text-slate-700">Espacio Usado</div>
                 <div className="text-xs text-slate-500">
                     {formatSize(stats?.used_bytes || 0)} / {formatSize(stats?.total_limit_bytes || 0)}
                 </div>
             </div>
             
             <div className="h-8 w-[1px] bg-slate-200 mx-2 hidden md:block"></div>

           <label className="cursor-pointer">
              <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading || isDownloading} />
              <Button className="bg-blue-600 hover:bg-blue-700 shadow-sm" disabled={uploading || isDownloading}>
                <Plus className="w-4 h-4 mr-2" />
                Subir Archivo
              </Button>
           </label>
        </div>
      </div>

      {/* Toolbar & Breadcrumbs */}
      <div className="bg-white p-3 border rounded-xl shadow-sm flex flex-col gap-3 flex-shrink-0">
         <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-hide">
            <Button 
                variant="ghost" 
                size="icon" 
                onClick={handleNavigateUp}
                disabled={!currentPath || isDownloading}
                className="mr-2 text-slate-500 hover:text-slate-900"
            >
                <ArrowLeft className="w-4 h-4" />
            </Button>

            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink 
                    onClick={() => handleNavigate("")}
                    className={cn("cursor-pointer flex items-center gap-1", !currentPath ? "font-semibold text-slate-900" : "text-slate-500")}
                  >
                    <HardDrive className="w-4 h-4" />
                    Inicio
                  </BreadcrumbLink>
                </BreadcrumbItem>
                
                {breadcrumbSegments.map((segment, index) => {
                    const path = breadcrumbSegments.slice(0, index + 1).join('/')
                    const isLast = index === breadcrumbSegments.length - 1
                    
                    return (
                        <div key={path} className="flex items-center">
                            <BreadcrumbSeparator />
                            <BreadcrumbItem>
                                {isLast ? (
                                    <BreadcrumbPage className="font-semibold text-slate-900">{segment}</BreadcrumbPage>
                                ) : (
                                    <BreadcrumbLink 
                                        onClick={() => handleNavigate(path)}
                                        className="cursor-pointer text-slate-500 hover:text-slate-900"
                                    >
                                        {segment}
                                    </BreadcrumbLink>
                                )}
                            </BreadcrumbItem>
                        </div>
                    )
                })}
              </BreadcrumbList>
            </Breadcrumb>
         </div>

         <div className="flex justify-between items-center gap-3 flex-wrap">
             {/* Acciones de Selección */}
             <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border border-slate-100">
                <div className="flex items-center gap-2 px-2">
                    <Checkbox 
                        id="select-all" 
                        checked={currentFiles.length > 0 && selectedItems.size === currentFiles.length}
                        onCheckedChange={toggleSelectAll}
                        disabled={currentFiles.length === 0 || isDownloading}
                    />
                    <label htmlFor="select-all" className="text-sm font-medium text-slate-600 cursor-pointer select-none">
                        Todos
                    </label>
                </div>
                
                {selectedItems.size > 0 && (
                    <>
                        <div className="h-4 w-[1px] bg-slate-300 mx-1"></div>
                        
                        {selectedItems.size === 1 ? (
                            <>
                                <Button 
                                    size="sm" 
                                    variant="secondary" 
                                    className="h-7 text-xs bg-white border border-slate-200 shadow-sm hover:bg-slate-50"
                                    onClick={async () => {
                                        const id = Array.from(selectedItems)[0]
                                        const file = currentFiles.find(f => f.id === id)
                                        if (!file) return
                                        
                                        try {
                                            const res = await api.get(`/admin/storage/files/${id}/download`, { responseType: 'blob' })
                                            const url = window.URL.createObjectURL(new Blob([res.data], { type: file.mime_type || 'application/pdf' }))
                                            window.open(url, '_blank')
                                        } catch (e) {
                                            toast.error("Error al abrir archivo")
                                        }
                                    }}
                                    disabled={isDownloading}
                                >
                                    <Eye className="w-3.5 h-3.5 mr-1.5 text-slate-600" />
                                    Visualizar
                                </Button>
                                <Button 
                                    size="sm" 
                                    variant="secondary" 
                                    className="h-7 text-xs bg-white border border-slate-200 shadow-sm hover:bg-slate-50"
                                    onClick={() => {
                                        const id = Array.from(selectedItems)[0]
                                        const file = currentFiles.find(f => f.id === id)
                                        if (file) handleDownload(file.id, file.nombre)
                                    }}
                                    disabled={isDownloading}
                                >
                                    <Download className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
                                    Descargar
                                </Button>
                            </>
                        ) : (
                            <Button 
                                size="sm" 
                                variant="secondary" 
                                className="h-7 text-xs bg-white border border-slate-200 shadow-sm hover:bg-slate-50"
                                onClick={handleBulkDownload}
                                disabled={isDownloading}
                            >
                                <Package className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
                                Descargar ZIP ({selectedItems.size})
                            </Button>
                        )}

                        <Button 
                            size="sm" 
                            variant="ghost" 
                            className="h-7 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={handleDeleteBulk}
                            disabled={isDownloading || isDeletingBulk}
                        >
                            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                            Eliminar ({selectedItems.size})
                        </Button>
                    </>
                )}
             </div>

             <div className="flex gap-3 ml-auto">
                 <div className="relative w-48 md:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input 
                    placeholder="Buscar..." 
                    className="pl-10 h-9 border-slate-200 bg-slate-50 focus:bg-white transition-colors"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    disabled={isDownloading}
                  />
                </div>
                
                <div className="flex border rounded-lg overflow-hidden bg-slate-50 p-1 shrink-0">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className={cn("h-7 w-7", viewMode === 'grid' && "bg-white shadow-sm text-blue-600")}
                        onClick={() => setViewMode('grid')}
                        disabled={isDownloading}
                      >
                        <LayoutGrid className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className={cn("h-7 w-7", viewMode === 'list' && "bg-white shadow-sm text-blue-600")}
                        onClick={() => setViewMode('list')}
                        disabled={isDownloading}
                      >
                        <List className="w-4 h-4" />
                      </Button>
                </div>
             </div>
         </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 bg-white border rounded-xl overflow-hidden shadow-sm relative min-h-[400px]">
          {loadingFiles || loadingFolders ? (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
                  <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
              </div>
          ) : null}

          {gridItems.length === 0 && !loadingFiles && !loadingFolders ? (
             <div className="h-full flex flex-col items-center justify-center text-slate-400">
                <FolderOpen className="w-16 h-16 mb-4 text-slate-200" />
                <p className="text-lg font-medium text-slate-600">Carpeta vacía</p>
                <p className="text-sm">No hay elementos en esta ubicación.</p>
                <Button variant="link" onClick={() => document.querySelector<HTMLInputElement>('input[type="file"]')?.click()} className="mt-2 text-blue-600">
                    Subir un archivo aquí
                </Button>
             </div>
          ) : (
            <div className="h-full overflow-y-auto p-4">
                 {viewMode === 'grid' ? (
                     <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                         {gridItems.map((item, idx) => (
                             <motion.div
                                key={item.type === 'folder' ? item.fullPath : item.data.id}
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: idx * 0.03 }}
                                className={cn(
                                    "group relative flex flex-col items-center p-4 rounded-xl border border-transparent hover:bg-blue-50/50 hover:border-blue-100 transition-all cursor-pointer",
                                    "active:scale-95 duration-100",
                                    item.type === 'file' && selectedItems.has(item.data.id) && "bg-blue-50 border-blue-200 ring-1 ring-blue-300"
                                )}
                                onClick={() => {
                                    if (item.type === 'folder') handleNavigate(item.fullPath)
                                    else if (item.type === 'file') toggleSelection(item.data.id)
                                }}
                             >
                                 {/* Checkbox Overlay para selección */}
                                 {item.type === 'file' && (
                                     <div className="absolute top-2 left-2 z-20" onClick={(e) => e.stopPropagation()}>
                                         <Checkbox 
                                            checked={selectedItems.has(item.data.id)}
                                            onCheckedChange={() => toggleSelection(item.data.id)}
                                            className={cn("bg-white/80 border-slate-300", 
                                                selectedItems.has(item.data.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                            )}
                                         />
                                     </div>
                                 )}

                                 <div className="w-16 h-16 mb-3 flex items-center justify-center transition-transform group-hover:-translate-y-1">
                                     {item.type === 'folder' ? (
                                         <Folder className="w-14 h-14 text-yellow-400 drop-shadow-sm fill-yellow-400/20" />
                                     ) : (
                                         <FileText className={cn("w-12 h-12 drop-shadow-sm transition-colors", 
                                            selectedItems.has(item.data.id) ? "text-blue-600" : "text-blue-500"
                                         )} />
                                     )}
                                 </div>
                                 <span className="text-sm font-medium text-slate-700 text-center line-clamp-2 w-full break-words select-none">
                                     {item.type === 'folder' ? item.name : item.data.nombre}
                                 </span>
                                 
                                 {item.type === 'file' && (
                                     <span className="text-[10px] text-slate-400 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                         {formatSize(item.data.size_bytes)}
                                     </span>
                                 )}
                             </motion.div>
                         ))}
                     </div>
                 ) : (
                   <div className="min-w-full inline-block align-middle">
                        <table className="min-w-full divide-y divide-slate-100">
                             <thead>
                                 <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50/50">
                                     <th className="px-4 py-3 w-10">
                                         {/* Header Checkbox */}
                                     </th>
                                     <th className="px-4 py-3">Nombre</th>
                                     <th className="px-4 py-3">Tipo</th>
                                     <th className="px-4 py-3">Tamaño</th>
                                     <th className="px-4 py-3">Fecha</th>
                                     <th className="px-4 py-3 text-right">Acciones</th>
                                 </tr>
                             </thead>
                             <tbody className="divide-y divide-slate-100 bg-white">
                                 {gridItems.map((item) => (
                                     <tr 
                                        key={item.type === 'folder' ? item.fullPath : item.data.id}
                                        className={cn(
                                            "hover:bg-slate-50 transition-colors cursor-pointer group select-none",
                                            item.type === 'file' && selectedItems.has(item.data.id) && "bg-blue-50/60 hover:bg-blue-50"
                                        )}
                                        onClick={() => {
                                            if (item.type === 'folder') handleNavigate(item.fullPath)
                                            else if (item.type === 'file') toggleSelection(item.data.id)
                                        }}
                                     >
                                         <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                             {item.type === 'file' && (
                                                 <Checkbox 
                                                    checked={selectedItems.has(item.data.id)}
                                                    onCheckedChange={() => toggleSelection(item.data.id)}
                                                 />
                                             )}
                                         </td>
                                         <td className="px-4 py-3 whitespace-nowrap">
                                             <div className="flex items-center gap-3">
                                                 {item.type === 'folder' ? (
                                                     <Folder className="w-5 h-5 text-yellow-400 fill-yellow-400/20" />
                                                 ) : (
                                                     <FileText className="w-5 h-5 text-blue-500" />
                                                 )}
                                                 <span className="font-medium text-slate-700">
                                                     {item.type === 'folder' ? item.name : item.data.nombre}
                                                 </span>
                                             </div>
                                         </td>
                                         <td className="px-4 py-3 text-sm text-slate-500">
                                             {item.type === 'folder' ? 'Carpeta' : item.data.mime_type.split('/')[1] || 'Archivo'}
                                         </td>
                                         <td className="px-4 py-3 text-sm text-slate-500">
                                             {item.type === 'folder' ? '-' : formatSize(item.data.size_bytes)}
                                         </td>
                                         <td className="px-4 py-3 text-sm text-slate-500">
                                             {item.type === 'folder' ? '-' : format(new Date(item.data.created_at), "dd/MM/yyyy", { locale: es })}
                                         </td>
                                         <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                                             {item.type === 'file' && (
                                                  <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                      <Button size="icon" variant="ghost" className="h-8 w-8 text-blue-600" onClick={() => handleDownload(item.data.id, item.data.nombre)}>
                                                         <Download className="w-4 h-4" />
                                                      </Button>
                                                      <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" onClick={() => handleDelete(item.data.id)}>
                                                         <Trash2 className="w-4 h-4" />
                                                      </Button>
                                                  </div>
                                             )}
                                         </td>
                                     </tr>
                                 ))}
                             </tbody>
                        </table>
                   </div>
                 )}
            </div>
          )}
      </div>
    </div>
  )
}
