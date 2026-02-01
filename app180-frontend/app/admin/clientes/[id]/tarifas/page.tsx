"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { ArrowLeft, Plus, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

/* =====================================================
   Types
===================================================== */

type Tarifa = {
  id: string;
  tipo: "hora" | "dia" | "mes" | "trabajo";
  precio: number;
  fecha_inicio: string;
  fecha_fin?: string | null;
  activa: boolean;
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

export default function TarifasPage() {
  const params = useParams();
  const router = useRouter();

  const clienteId = params?.id as string;

  const [tarifas, setTarifas] = useState<Tarifa[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);

  const [editing, setEditing] = useState<{
    tipo: string;
    precio: number | string;
    fecha_inicio: string;
  }>({
    tipo: "hora",
    precio: "",
    fecha_inicio: "",
  });

  /* =========================
     Load
  ========================= */

  async function load() {
    try {
      setLoading(true);

      const data = await api(`/admin/clientes/${clienteId}/tarifas`);

      setTarifas(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (clienteId) load();
  }, [clienteId]);

  /* =========================
     Actions
  ========================= */

  function openCreate() {
    setEditing({
      tipo: "hora",
      precio: "",
      fecha_inicio: new Date().toISOString().slice(0, 10),
    });

    setDrawerOpen(true);
  }

  async function save() {
    if (!editing.precio || !editing.fecha_inicio) {
      alert("Completa todos los campos");
      return;
    }

    try {
      setLoading(true);

      await api(`/admin/clientes/${clienteId}/tarifas`, {
        method: "POST",
        body: JSON.stringify({
          tipo: editing.tipo,
          precio: Number(editing.precio),
          fecha_inicio: editing.fecha_inicio,
        }),
      });

      setDrawerOpen(false);

      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function cerrarTarifa(id: string) {
    if (!confirm("¿Cerrar esta tarifa?")) return;

    try {
      await api(`/admin/clientes/tarifas/${id}`, {
        method: "DELETE",
      });

      await load();
    } catch (e: any) {
      alert(e.message);
    }
  }

  /* ===================================================== */

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          onClick={() => router.push(`/admin/clientes/${clienteId}`)}
        >
          <ArrowLeft size={18} />
        </Button>

        <h1 className="text-2xl font-semibold flex-1">Tarifas</h1>

        <Button onClick={openCreate} className="gap-2">
          <Plus size={18} /> Nueva tarifa
        </Button>
      </div>

      {error && <div className="text-red-600">{error}</div>}

      {/* List */}
      <div className="grid gap-4">
        {tarifas.map((t) => (
          <Card key={t.id} className="rounded-xl">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="font-medium capitalize">{t.tipo}</p>

                <p className="text-sm text-slate-500">
                  {Number(t.precio || 0).toFixed(2)} € · desde {t.fecha_inicio}
                </p>

                {t.fecha_fin && (
                  <p className="text-xs text-red-500">Cerrada: {t.fecha_fin}</p>
                )}
              </div>

              {t.activa && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => cerrarTarifa(t.id)}
                >
                  Cerrar
                </Button>
              )}
            </CardContent>
          </Card>
        ))}

        {!tarifas.length && !loading && (
          <div className="text-center text-slate-500 py-8">Sin tarifas</div>
        )}
      </div>

      {/* Drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <motion.div
            className="fixed inset-0 bg-black/40 z-50 flex justify-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-white w-full max-w-md h-full p-6"
              initial={{ x: 400 }}
              animate={{ x: 0 }}
              exit={{ x: 400 }}
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold">Nueva tarifa</h2>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDrawerOpen(false)}
                >
                  <X size={18} />
                </Button>
              </div>

              <div className="space-y-5">
                {/* Tipo */}
                <div>
                  <label className="text-sm">Tipo</label>

                  <select
                    className="w-full border rounded px-3 py-2 text-sm"
                    value={editing.tipo}
                    onChange={(e) =>
                      setEditing({ ...editing, tipo: e.target.value })
                    }
                  >
                    <option value="hora">Hora</option>
                    <option value="dia">Día</option>
                    <option value="mes">Mes</option>
                    <option value="trabajo">Trabajo</option>
                  </select>
                </div>

                {/* Precio */}
                <div>
                  <label className="text-sm">Precio (€)</label>

                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editing.precio}
                    onChange={(e) =>
                      setEditing({ ...editing, precio: e.target.value })
                    }
                  />
                </div>

                {/* Fecha */}
                <div>
                  <label className="text-sm">Fecha inicio</label>

                  <Input
                    type="date"
                    value={editing.fecha_inicio}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        fecha_inicio: e.target.value,
                      })
                    }
                  />
                </div>

                {/* Save */}
                <div className="pt-4">
                  <Button className="w-full" disabled={loading} onClick={save}>
                    Guardar tarifa
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
