"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Pencil, X } from "lucide-react";
import { showSuccess, showError } from "@/lib/toast";
import { motion, AnimatePresence } from "framer-motion";

/* =====================================================
   Types
===================================================== */

type Trabajo = {
  id: string;
  nombre: string;
  descripcion?: string | null;
  activo: boolean;
  created_at: string;
};

/* =====================================================
   API helper
===================================================== */

async function api(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem("token");

  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${url}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Error API");
  }

  return res.json();
}

/* =====================================================
   Page
===================================================== */

export default function AdminTrabajosPage() {
  const [trabajos, setTrabajos] = useState<Trabajo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Trabajo | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  /* =========================
     Load
  ========================= */

  async function load() {
    try {
      setLoading(true);
      const data = await api("/work-items");
      setTrabajos(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  /* =========================
     Actions
  ========================= */

  function openCreate() {
    setEditing({
      id: "",
      nombre: "",
      descripcion: "",
      activo: true,
      created_at: "",
    });
    setDrawerOpen(true);
  }

  function openEdit(t: Trabajo) {
    setEditing({ ...t });
    setDrawerOpen(true);
  }

  async function save() {
    if (!editing) return;

    try {
      setLoading(true);

      if (editing.id) {
        await api(`/work-items/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(editing),
        });
      } else {
        await api("/work-items", {
          method: "POST",
          body: JSON.stringify(editing),
        });
      }

      setDrawerOpen(false);
      setEditing(null);
      await load();
      showSuccess("Trabajo guardado correctamente");
    } catch (e: any) {
      showError(e.message || "Error al guardar");
    } finally {
      setLoading(false);
    }
  }

  async function toggleActivo(t: Trabajo) {
    try {
      await api(`/work-items/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ activo: !t.activo }),
      });
      await load();
      showSuccess("Estado actualizado");
    } catch (e: any) {
      showError(e.message || "Error al actualizar estado");
    }
  }

  /* ===================================================== */

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Trabajos / Servicios</h1>

        <Button onClick={openCreate} className="gap-2">
          <Plus size={18} /> Nuevo trabajo
        </Button>
      </div>

      {error && <div className="text-red-600">{error}</div>}

      {/* Table */}
      <Card className="rounded-2xl shadow-sm">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr className="text-left">
                <th className="p-3">Nombre</th>
                <th className="p-3">Descripción</th>
                <th className="p-3">Activo</th>
                <th className="p-3 text-right">Acciones</th>
              </tr>
            </thead>

            <tbody>
              {trabajos.map((t) => (
                <tr
                  key={t.id}
                  className="border-b last:border-0 hover:bg-slate-50"
                >
                  <td className="p-3 font-medium">{t.nombre}</td>
                  <td className="p-3 text-slate-600">{t.descripcion || "—"}</td>
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={t.activo}
                      onChange={() => toggleActivo(t)}
                    />
                  </td>

                  <td className="p-3 text-right space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEdit(t)}
                    >
                      <Pencil size={14} />
                    </Button>
                  </td>
                </tr>
              ))}

              {!trabajos.length && !loading && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-slate-500">
                    Sin trabajos
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Drawer */}
      <AnimatePresence>
        {drawerOpen && editing && (
          <motion.div
            className="fixed inset-0 bg-black/40 z-50 flex justify-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-white w-full max-w-md h-full p-6 overflow-y-auto"
              initial={{ x: 400 }}
              animate={{ x: 0 }}
              exit={{ x: 400 }}
              transition={{ type: "spring", damping: 25 }}
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold">
                  {editing.id ? "Editar trabajo" : "Nuevo trabajo"}
                </h2>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDrawerOpen(false)}
                >
                  <X size={18} />
                </Button>
              </div>

              <div className="space-y-5">
                {/* Nombre */}
                <div>
                  <label className="text-sm">Nombre</label>
                  <Input
                    value={editing.nombre}
                    onChange={(e) =>
                      setEditing({ ...editing, nombre: e.target.value })
                    }
                  />
                </div>

                {/* Descripción */}
                <div>
                  <label className="text-sm">Descripción</label>
                  <textarea
                    className="w-full border rounded-md p-2 text-sm min-h-[80px]"
                    value={editing.descripcion || ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        descripcion: e.target.value,
                      })
                    }
                  />
                </div>

                {/* Activo */}
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={editing.activo}
                    onChange={(e) =>
                      setEditing({ ...editing, activo: e.target.checked })
                    }
                  />
                  <span className="text-sm">Activo</span>
                </div>

                {/* Save */}
                <div className="pt-4">
                  <Button className="w-full" disabled={loading} onClick={save}>
                    Guardar
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
