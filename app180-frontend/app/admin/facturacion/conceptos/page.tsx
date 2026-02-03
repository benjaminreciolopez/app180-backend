"use client"

import { useState, useEffect, useMemo } from "react"
import { 
  Plus, 
  Search, 
  Trash2, 
  Edit, 
  BookOpen, 
  Tag, 
  User, 
  Settings2,
  AlertCircle,
  Loader2,
  Filter
} from "lucide-react"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"

import { api } from "@/services/api"
import { formatCurrency, cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command"

interface Cliente {
  id: number
  nombre: string
}

interface Concepto {
  id: number
  nombre: string
  descripcion: string
  precio_unitario: number
  iva_default: number
  cliente_id?: number | null
  categoria?: string | null
}

export default function ConceptosPage() {
  const [conceptos, setConceptos] = useState<Concepto[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("TODOS")

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formData, setFormData] = useState({
    nombre: "",
    descripcion: "",
    precio_unitario: 0,
    iva_default: 21,
    cliente_id: "null",
    categoria: ""
  })

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [resConceptos, resClientes] = await Promise.all([
        api.get('/admin/facturacion/conceptos'),
        api.get('/admin/clientes?limit=1000')
      ])
      // Ajuste para el formato de respuesta del backend
      setConceptos(resConceptos.data.data || resConceptos.data || [])
      setClientes(Array.isArray(resClientes.data) ? resClientes.data : (resClientes.data.data || []))
    } catch (err) {
      console.error("Error loading data", err)
      toast.error("Error cargando datos")
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (c: Concepto) => {
    setEditingId(c.id)
    setFormData({
      nombre: c.nombre,
      descripcion: c.descripcion || "",
      precio_unitario: Number(c.precio_unitario),
      iva_default: Number(c.iva_default || 21),
      cliente_id: c.cliente_id ? String(c.cliente_id) : "null",
      categoria: c.categoria || ""
    })
    setIsModalOpen(true)
  }

  const handleOpenNew = () => {
    setEditingId(null)
    setFormData({
      nombre: "",
      descripcion: "",
      precio_unitario: 0,
      iva_default: 21,
      cliente_id: "null",
      categoria: ""
    })
    setIsModalOpen(true)
  }

  const handleSubmit = async () => {
    if (!formData.nombre) return toast.error("El nombre es obligatorio")
    
    const payload = {
      ...formData,
      cliente_id: formData.cliente_id === "null" ? null : formData.cliente_id,
      // Aunque no los mostramos en UI, los mandamos con valores base para no romper el backend
      precio_unitario: formData.precio_unitario || 0,
      iva_default: formData.iva_default || 21
    }

    setSaving(true)
    try {
      if (editingId) {
        await api.put(`/admin/facturacion/conceptos/${editingId}`, payload)
        toast.success("Concepto actualizado")
      } else {
        await api.post('/admin/facturacion/conceptos', payload)
        toast.success("Concepto creado")
      }
      setIsModalOpen(false)
      fetchData()
    } catch (err) {
      toast.error("Error al guardar")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm("¿Seguro que quieres eliminar este concepto?")) return
    setDeletingId(id)
    try {
      await api.delete(`/admin/facturacion/conceptos/${id}`)
      toast.success("Concepto eliminado")
      fetchData()
    } catch (err) {
      toast.error("Error al eliminar")
    } finally {
      setDeletingId(null)
    }
  }

  const filteredItems = useMemo(() => {
    return conceptos.filter(c => {
      const matchesSearch = c.nombre.toLowerCase().includes(search.toLowerCase()) || 
                           (c.descripcion || "").toLowerCase().includes(search.toLowerCase()) ||
                           (c.categoria || "").toLowerCase().includes(search.toLowerCase())
      
      const matchesCategory = categoryFilter === "TODOS" || c.categoria === categoryFilter
      
      return matchesSearch && matchesCategory
    })
  }, [conceptos, search, categoryFilter])

  const categories = useMemo(() => {
    const cats = new Set(conceptos.map(c => c.categoria).filter(Boolean))
    return Array.from(cats) as string[]
  }, [conceptos])

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Catálogo de Conceptos</h2>
          <p className="text-slate-500 text-sm">Gestiona tus servicios y productos recurrentes</p>
        </div>
        <Button onClick={handleOpenNew} className="bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/10">
          <Plus className="w-4 h-4 mr-2" />
          Añadir Concepto
        </Button>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input 
            placeholder="Buscar por nombre, descripción o categoría..." 
            className="pl-10 h-10 bg-white"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full md:w-[200px] h-10 bg-white">
                <Filter className="w-4 h-4 mr-2 text-slate-400" />
                <SelectValue placeholder="Categoría" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="TODOS">Todas las categorías</SelectItem>
                {categories.map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
            </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
           <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : filteredItems.length === 0 ? (
        <Card className="border-dashed border-2 py-12 text-center">
            <CardContent className="space-y-4">
                <div className="mx-auto w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                    <BookOpen className="w-8 h-8 text-slate-300" />
                </div>
                <div>
                    <p className="text-slate-900 font-medium">No se encontraron conceptos</p>
                    <p className="text-slate-500 text-sm">Prueba con otra búsqueda o añade uno nuevo.</p>
                </div>
            </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <AnimatePresence>
            {filteredItems.map((c) => (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
              >
                <Card className="group border-slate-200 hover:border-blue-400 hover:shadow-xl hover:shadow-blue-500/5 transition-all overflow-hidden h-full flex flex-col">
                  <div className="p-5 flex-1 space-y-4">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                           <h3 className="font-bold text-slate-900 leading-tight">{c.nombre}</h3>
                           {c.categoria && (
                             <Badge variant="secondary" className="bg-slate-100 text-slate-600 font-normal text-[10px] h-5">
                               {c.categoria}
                             </Badge>
                           )}
                        </div>
                        {c.cliente_id && (
                          <div className="flex items-center gap-1 text-[11px] text-blue-600 font-medium">
                            <User className="w-3 h-3" />
                            {clientes.find(cl => cl.id === c.cliente_id)?.nombre || "Cliente asociado"}
                          </div>
                        )}
                      </div>
                    </div>

                    <p className="text-sm text-slate-600 whitespace-pre-wrap">
                      {c.descripcion || <span className="text-slate-300 italic">Sin descripción</span>}
                    </p>
                  </div>

                  <div className="bg-slate-50/50 p-3 border-t flex justify-end gap-2 group-hover:bg-blue-50/30 transition-colors">
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="text-slate-500 hover:text-blue-600 hover:bg-blue-100/50"
                      onClick={() => handleEdit(c)}
                    >
                      <Edit className="w-4 h-4 mr-2" /> Editar
                    </Button>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="text-slate-500 hover:text-red-600 hover:bg-red-100/50"
                      onClick={() => handleDelete(c.id)}
                      disabled={deletingId === c.id}
                    >
                      {deletingId === c.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                      Eliminar
                    </Button>
                  </div>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Modal Crear/Editar */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingId ? <Edit className="w-5 h-5 text-blue-600" /> : <Plus className="w-5 h-5 text-blue-600" />}
              {editingId ? "Editar Concepto" : "Nuevo Concepto"}
            </DialogTitle>
          </DialogHeader>
          
          <div className="grid gap-6 py-4">
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Nombre / Referencia corto</Label>
                    <Input 
                        placeholder="Ej: Servicio Mensual"
                        value={formData.nombre}
                        onChange={(e) => setFormData({...formData, nombre: e.target.value})}
                    />
                </div>
                <div className="space-y-2">
                    <Label>Categoría</Label>
                    <Input 
                        placeholder="Ej: Limpieza, Consultoría..."
                        value={formData.categoria}
                        onChange={(e) => setFormData({...formData, categoria: e.target.value})}
                    />
                </div>
            </div>

            <div className="space-y-2">
              <Label>Descripción detallada</Label>
              <Textarea 
                placeholder="Esta descripción aparecerá por defecto en las facturas..."
                rows={3}
                value={formData.descripcion}
                onChange={(e) => setFormData({...formData, descripcion: e.target.value})}
              />
            </div>

            <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-lg border border-slate-100">
                <div className="flex-1">
                    <Label className="text-slate-900 font-bold">Tipo de Concepto</Label>
                    <p className="text-xs text-slate-500">¿Es para todos o específico de un cliente?</p>
                </div>
                <div className="flex bg-white border rounded-md p-1">
                    <button 
                        className={cn("px-3 py-1 text-xs rounded-sm transition-all cursor-pointer", formData.cliente_id === "null" ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50")}
                        onClick={() => setFormData({...formData, cliente_id: "null"})}
                    >
                        Genérico
                    </button>
                    <button 
                        className={cn("px-3 py-1 text-xs rounded-sm transition-all cursor-pointer", formData.cliente_id !== "null" ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50")}
                        onClick={() => {
                            if (formData.cliente_id === "null" && clientes.length > 0) {
                                setFormData({...formData, cliente_id: String(clientes[0].id)})
                            }
                        }}
                    >
                        Específico
                    </button>
                </div>
            </div>

            {formData.cliente_id !== "null" && (
                <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                        <User className="w-4 h-4 text-blue-500" />
                        Seleccionar Cliente
                    </Label>
                    <Select 
                        value={formData.cliente_id} 
                        onValueChange={(val) => setFormData({...formData, cliente_id: val})}
                    >
                        <SelectTrigger className="bg-white border-slate-200 cursor-pointer">
                        <SelectValue placeholder="Busca un cliente..." />
                        </SelectTrigger>
                        <SelectContent>
                        {clientes.map(c => (
                            <SelectItem key={c.id} value={String(c.id)} className="cursor-pointer">{c.nombre}</SelectItem>
                        ))}
                        </SelectContent>
                    </Select>
                </div>
            )}


          </div>

          <DialogFooter className="gap-2 sm:gap-0">
             <Button variant="outline" onClick={() => setIsModalOpen(false)} disabled={saving}>Cancelar</Button>
             <Button onClick={handleSubmit} className="bg-blue-600 hover:bg-blue-700" disabled={saving}>
               {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
               {editingId ? "Actualizar" : "Crear Concepto"}
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}


