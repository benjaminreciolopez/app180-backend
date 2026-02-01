"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, X } from "lucide-react";
import { showSuccess, showError } from "@/lib/toast";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { UniversalExportButton } from "@/components/shared/UniversalExportButton";

const GeoPicker = dynamic(() => import("@/components/GeoPicker"), {
  ssr: false,
});

/* =====================================================
   Types
===================================================== */

type Cliente = {
  id: string;
  nombre: string;
  codigo?: string | null;
  activo: boolean;
  modo_defecto: string;
  requiere_geo: boolean;
  geo_policy: string | null;
  lat?: number | null;
  lng?: number | null;
  radio_m?: number | null;
  razon_social?: string | null;
  nif?: string | null;
  nif_cif?: string | null;
  iban?: string | null;
  notas?: string | null;

  // New Fields
  direccion?: string | null;
  poblacion?: string | null;
  provincia?: string | null;
  cp?: string | null;
  pais?: string | null;
  email?: string | null;
  contacto_nombre?: string | null;
  contacto_email?: string | null;
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

export default function AdminClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoOpen, setGeoOpen] = useState(false);

  const [editing, setEditing] = useState<Cliente | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const router = useRouter();

  /* =========================
     Load
  ========================= */

  const BASE = "/admin/clientes";

  async function load() {
    try {
      setLoading(true);
      const data = await api(BASE);
      setClientes(data);
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

  async function openCreate() {
    try {
      const r = await api("/admin/clientes/next-code");

      setEditing({
        id: "",
        nombre: "",
        codigo: r.codigo, // 👈 aquí
        activo: true,
        modo_defecto: "mixto",
        requiere_geo: true,
        geo_policy: "strict",
        pais: "España",
        direccion: "",
        poblacion: "",
        provincia: "",
        cp: "",
        email: "",
        nif: ""
      });

      setDrawerOpen(true);
    } catch (e: any) {
      showError("No se pudo generar código");
    }
  }

  function openEdit(c: Cliente) {
    setEditing({ ...c });
    setDrawerOpen(true);
  }

  async function save() {
    if (!editing) return;

    try {
      setLoading(true);

      if (editing.id) {
        await api(`${BASE}/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(editing),
        });
      } else {
        await api(BASE, {
          method: "POST",
          body: JSON.stringify(editing),
        });
      }

      setDrawerOpen(false);
      setEditing(null);
      await load();
      showSuccess("Cliente guardado correctamente");
    } catch (e: any) {
      showError(e.message || "Error al guardar");
    } finally {
      setLoading(false);
    }
  }

  async function deactivate(id: string) {
    if (!confirm("¿Desactivar cliente?")) return;

    try {
      await api(`${BASE}/${id}`, {
        method: "DELETE",
      });

      await load();
      showSuccess("Cliente desactivado");
    } catch (e: any) {
      showError(e.message || "Error al desactivar");
    }
  }

  /* ===================================================== */

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Clientes</h1>

        <div className="flex gap-2">
             <UniversalExportButton 
                module="clientes" 
                queryParams={{}} 
                label="Exportar"
            />
            <Button onClick={openCreate} className="gap-2">
            <Plus size={18} /> Nuevo cliente
            </Button>
        </div>
      </div>

      {error && <div className="text-red-600">{error}</div>}

      {/* Table */}
      <Card className="rounded-2xl shadow-sm">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr className="text-left">
                <th className="p-3">Nombre</th>
                <th className="p-3">Código</th>
                <th className="p-3">Modo</th>
                <th className="p-3">Geo</th>
                <th className="p-3">Activo</th>
                <th className="p-3 text-right">Acciones</th>
              </tr>
            </thead>

            <tbody>
              {clientes.map((c) => (
                <tr
                  key={c.id}
                  className="border-b last:border-0 hover:bg-slate-50"
                >
                  <td
                    className="p-3 font-medium text-blue-600 cursor-pointer hover:underline"
                    onClick={() => router.push(`/admin/clientes/${c.id}`)}
                  >
                    {c.nombre}
                  </td>
                  <td className="p-3 text-slate-600">{c.codigo || "—"}</td>
                  <td className="p-3">{c.modo_defecto}</td>
                  <td className="p-3">
                    {c.requiere_geo ? c.geo_policy || "strict" : "No"}
                  </td>
                  <td className="p-3">
                    {c.activo ? (
                      <span className="text-green-600">Sí</span>
                    ) : (
                      <span className="text-red-500">No</span>
                    )}
                  </td>

                  <td className="p-3 text-right space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEdit(c)}
                    >
                      <Pencil size={14} />
                    </Button>

                    {c.activo && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => deactivate(c.id)}
                      >
                        <X size={14} />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}

              {!clientes.length && !loading && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-500">
                    Sin clientes
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
                  {editing.id ? "Editar cliente" : "Nuevo cliente"}
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

                {/* Código */}
                <div>
                  <label className="text-sm">Código</label>
                  <Input
                    value={editing.codigo || ""}
                    disabled
                    className="bg-slate-100 cursor-not-allowed"
                  />
                </div>

                {/* Modo */}
                <div>
                  <label className="text-sm">Modo defecto</label>
                  <Select
                    value={editing.modo_defecto}
                    onValueChange={(v: string) =>
                      setEditing({ ...editing, modo_defecto: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hora">Hora</SelectItem>
                      <SelectItem value="dia">Día</SelectItem>
                      <SelectItem value="mes">Mes</SelectItem>
                      <SelectItem value="trabajo">Trabajo</SelectItem>
                      <SelectItem value="mixto">Mixto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" onClick={() => setGeoOpen(true)}>
                  Seleccionar en mapa
                </Button>

                {/* Geo */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Geolocalización</label>

                  <Select
                    value={editing.geo_policy || "strict"}
                    onValueChange={(v: string) =>
                      setEditing({ ...editing, geo_policy: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="strict">Estricto</SelectItem>
                      <SelectItem value="soft">Flexible</SelectItem>
                      <SelectItem value="info">Informativo</SelectItem>
                    </SelectContent>
                  </Select>
                  {editing.lat != null && editing.lng != null ? (
                    <p className="text-sm text-slate-600">
                      Ubicación guardada ✔
                    </p>
                  ) : (
                    <p className="text-sm text-slate-400">No hay ubicación</p>
                  )}

                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      placeholder="Lat"
                      value={editing.lat || ""}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          lat: Number(e.target.value) || null,
                        })
                      }
                    />
                    <Input
                      placeholder="Lng"
                      value={editing.lng || ""}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          lng: Number(e.target.value) || null,
                        })
                      }
                    />
                    <Input
                      placeholder="Radio (m)"
                      value={editing.radio_m || ""}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          radio_m: Number(e.target.value) || null,
                        })
                      }
                    />
                  </div>
                </div>

                </div>

                {/* Fiscal Completo */}
                <div className="space-y-3 pt-4 border-t">
                  <h3 className="font-medium text-slate-800">Datos Fiscales y Contacto</h3>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-500">NIF / CIF</label>
                      <Input
                        placeholder="B12345678"
                        value={editing.nif || editing.nif_cif || ""}
                        onChange={(e) =>
                          setEditing({ ...editing, nif: e.target.value, nif_cif: e.target.value })
                        }
                      />
                    </div>
                     <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-500">Razón Social</label>
                      <Input
                        placeholder="Empresa S.L."
                        value={editing.razon_social || ""}
                        onChange={(e) =>
                          setEditing({ ...editing, razon_social: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-500">Dirección</label>
                    <Input
                      placeholder="Calle Principal, 123"
                      value={editing.direccion || ""}
                      onChange={(e) => setEditing({ ...editing, direccion: e.target.value })}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                     <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-500">CP</label>
                        <Input value={editing.cp || ""} onChange={(e) => setEditing({ ...editing, cp: e.target.value })} />
                     </div>
                     <div className="space-y-1 col-span-2">
                        <label className="text-xs font-medium text-slate-500">Población</label>
                        <Input value={editing.poblacion || ""} onChange={(e) => setEditing({ ...editing, poblacion: e.target.value })} />
                     </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-500">Provincia</label>
                         <Input value={editing.provincia || ""} onChange={(e) => setEditing({ ...editing, provincia: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-500">País</label>
                         <Input value={editing.pais || "España"} onChange={(e) => setEditing({ ...editing, pais: e.target.value })} />
                      </div>
                  </div>

                  <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-500">Email Facturación</label>
                      <Input 
                        type="email" 
                        value={editing.email || ""} 
                        onChange={(e) => setEditing({ ...editing, email: e.target.value })} 
                      />
                  </div>
                  
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-500">IBAN</label>
                    <Input
                        value={editing.iban || ""}
                        onChange={(e) => setEditing({ ...editing, iban: e.target.value })}
                    />
                  </div>
                </div>

                {/* Notas */}
                <div>
                  <label className="text-sm">Notas</label>
                  <textarea
                    className="w-full border rounded-md p-2 text-sm min-h-[80px]"
                    value={editing.notas || ""}
                    onChange={(e) =>
                      setEditing({ ...editing, notas: e.target.value })
                    }
                  />
                </div>

                {/* Save */}
                <div className="pt-4">
                  <Button className="w-full" disabled={loading} onClick={save}>
                    Guardar
                  </Button>
                </div>

            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {geoOpen && editing && (
        <GeoPicker
          lat={editing.lat || null}
          lng={editing.lng || null}
          radio={editing.radio_m || null}
          onChange={(v) =>
            setEditing((prev) => 
              prev ? {
              ...prev,
              lat: v.lat,
              lng: v.lng,
              radio_m: v.radio,
            } : null)
          }
          onClose={() => setGeoOpen(false)}
        />
      )}
    </div>
  );
}
