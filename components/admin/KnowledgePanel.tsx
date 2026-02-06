"use client"

import { useEffect, useState } from "react"
import { api } from "@/services/api"
import { showSuccess, showError } from "@/lib/toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, Trash2, Pencil, X, Check, Brain } from "lucide-react"

interface Knowledge {
  id: string
  token: string
  respuesta: string
  categoria: string | null
  prioridad: number
  activo: boolean
}

export default function KnowledgePanel() {
  const [items, setItems] = useState<Knowledge[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ token: "", respuesta: "", categoria: "", prioridad: 0 })

  async function load() {
    try {
      const r = await api.get("/admin/conocimiento")
      setItems(r.data)
    } catch {
      showError("Error cargando conocimiento")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function resetForm() {
    setForm({ token: "", respuesta: "", categoria: "", prioridad: 0 })
    setShowForm(false)
    setEditingId(null)
  }

  async function handleSave() {
    if (!form.token.trim() || !form.respuesta.trim()) {
      showError("Token y respuesta son requeridos")
      return
    }

    try {
      if (editingId) {
        await api.patch(`/admin/conocimiento/${editingId}`, form)
        showSuccess("Actualizado correctamente")
      } else {
        await api.post("/admin/conocimiento", form)
        showSuccess("Conocimiento creado")
      }
      resetForm()
      load()
    } catch (err: any) {
      showError(err.response?.data?.error || "Error al guardar")
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar este conocimiento?")) return
    try {
      await api.delete(`/admin/conocimiento/${id}`)
      showSuccess("Eliminado")
      load()
    } catch {
      showError("Error al eliminar")
    }
  }

  async function handleToggleActive(item: Knowledge) {
    try {
      await api.patch(`/admin/conocimiento/${item.id}`, { activo: !item.activo })
      load()
    } catch {
      showError("Error al cambiar estado")
    }
  }

  function startEdit(item: Knowledge) {
    setEditingId(item.id)
    setForm({
      token: item.token,
      respuesta: item.respuesta,
      categoria: item.categoria || "",
      prioridad: item.prioridad
    })
    setShowForm(true)
  }

  if (loading) return <p className="text-sm text-muted-foreground">Cargando...</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-purple-600" />
          <h3 className="font-semibold">Base de Conocimiento de CONTENDO</h3>
        </div>
        {!showForm && (
          <Button size="sm" onClick={() => { resetForm(); setShowForm(true) }}>
            <Plus className="h-4 w-4 mr-1" /> Nuevo
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Define tokens (palabras clave) y respuestas que CONTENDO usara cuando le pregunten. Tambien sirve como fallback si la IA no esta disponible.
      </p>

      {/* Formulario */}
      {showForm && (
        <div className="card border rounded-lg p-4 space-y-3 bg-slate-50">
          <div>
            <label className="text-sm font-medium">Token (palabra clave)</label>
            <Input
              value={form.token}
              onChange={e => setForm(f => ({ ...f, token: e.target.value }))}
              placeholder="ej: horario, precio, contacto, hola..."
            />
            <p className="text-xs text-muted-foreground mt-1">
              Si el usuario menciona esta palabra, CONTENDO usara la respuesta asociada
            </p>
          </div>

          <div>
            <label className="text-sm font-medium">Respuesta</label>
            <textarea
              value={form.respuesta}
              onChange={e => setForm(f => ({ ...f, respuesta: e.target.value }))}
              placeholder="La respuesta que dara CONTENDO cuando detecte este token..."
              className="w-full border rounded-md p-2 text-sm min-h-[80px] resize-y"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-sm font-medium">Categoria (opcional)</label>
              <Input
                value={form.categoria}
                onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                placeholder="ej: horarios, politicas..."
              />
            </div>
            <div className="w-24">
              <label className="text-sm font-medium">Prioridad</label>
              <Input
                type="number"
                value={form.prioridad}
                onChange={e => setForm(f => ({ ...f, prioridad: parseInt(e.target.value) || 0 }))}
              />
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={resetForm}>
              <X className="h-4 w-4 mr-1" /> Cancelar
            </Button>
            <Button size="sm" onClick={handleSave}>
              <Check className="h-4 w-4 mr-1" /> {editingId ? "Actualizar" : "Crear"}
            </Button>
          </div>
        </div>
      )}

      {/* Lista */}
      {items.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No hay conocimiento definido. Crea tokens para que CONTENDO pueda responder preguntas personalizadas.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div
              key={item.id}
              className={`border rounded-lg p-3 flex items-start justify-between gap-3 ${!item.activo ? "opacity-50 bg-slate-100" : "bg-white"}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-semibold bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                    {item.token}
                  </span>
                  {item.categoria && (
                    <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded">
                      {item.categoria}
                    </span>
                  )}
                  {item.prioridad > 0 && (
                    <span className="text-xs text-muted-foreground">P:{item.prioridad}</span>
                  )}
                </div>
                <p className="text-sm text-slate-600 mt-1 line-clamp-2">{item.respuesta}</p>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <Button variant="ghost" size="sm" onClick={() => handleToggleActive(item)} title={item.activo ? "Desactivar" : "Activar"}>
                  <span className={`w-2 h-2 rounded-full ${item.activo ? "bg-green-500" : "bg-red-500"}`} />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => startEdit(item)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(item.id)}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
