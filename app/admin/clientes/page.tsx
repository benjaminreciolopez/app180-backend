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
import { Plus, Pencil, X, Building2, MapPin, Receipt, Info, Map as MapIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  iva_defecto?: string | null;
  exento_iva?: boolean | null;
  forma_pago?: string | null;
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
        codigo: r.codigo,
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
        nif: "",
        nif_cif: "",
        razon_social: "",
        iban: "",
        notas: "",
        contacto_nombre: "",
        contacto_email: "",
        iva_defecto: "21",
        exento_iva: false,
        forma_pago: "TRANSFERENCIA"
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
              className="bg-white w-full max-w-lg h-full p-0 flex flex-col shadow-2xl"
              initial={{ x: 500 }}
              animate={{ x: 0 }}
              exit={{ x: 500 }}
              transition={{ type: "spring", damping: 30, stiffness: 200 }}
            >
              {/* Header Drawer */}
              <div className="flex items-center justify-between p-6 border-b bg-slate-50/50">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 leading-none">
                    {editing.id ? "Editar Cliente" : "Nuevo Cliente"}
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">
                    {editing.id ? `ID: ${editing.id}` : "Complete los datos del nuevo cliente"}
                  </p>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full hover:bg-white hover:shadow-sm"
                  onClick={() => setDrawerOpen(false)}
                >
                  <X size={20} />
                </Button>
              </div>

              {/* Form Content with Tabs */}
              <div className="flex-1 overflow-y-auto p-6">
                <Tabs defaultValue="general" className="w-full">
                  <TabsList className="grid w-full grid-cols-3 mb-6 bg-slate-100 p-1 rounded-xl">
                    <TabsTrigger value="general" className="rounded-lg gap-2">
                       <Building2 size={14} /> General
                    </TabsTrigger>
                    <TabsTrigger value="fiscal" className="rounded-lg gap-2">
                       <Receipt size={14} /> Fiscal
                    </TabsTrigger>
                    <TabsTrigger value="geo" className="rounded-lg gap-2">
                       <MapPin size={14} /> Ubicación
                    </TabsTrigger>
                  </TabsList>

                  {/* TAB GENERAL */}
                  <TabsContent value="general" className="space-y-6 mt-0 border-0 p-0">
                    <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100 space-y-4">
                      <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Nombre Comercial</label>
                        <Input
                          placeholder="Ej: Restaurante El Faro"
                          className="bg-white border-slate-200"
                          value={editing.nombre}
                          onChange={(e) =>
                            setEditing({ ...editing, nombre: e.target.value })
                          }
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Código</label>
                          <Input
                            value={editing.codigo || ""}
                            disabled
                            className="bg-slate-100 border-slate-200 font-mono text-xs cursor-not-allowed"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Modo Defecto</label>
                          <Select
                            value={editing.modo_defecto}
                            onValueChange={(v: string) =>
                              setEditing({ ...editing, modo_defecto: v })
                            }
                          >
                            <SelectTrigger className="bg-white border-slate-200">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="hora">Por Hora</SelectItem>
                              <SelectItem value="dia">Por Día</SelectItem>
                              <SelectItem value="mes">Por Mes</SelectItem>
                              <SelectItem value="trabajo">Por Trabajo</SelectItem>
                              <SelectItem value="mixto">Mixto</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100 space-y-4">
                       <h4 className="text-sm font-semibold flex items-center gap-2 text-slate-700">
                          <Info size={16} className="text-blue-500" /> Notas Internas
                       </h4>
                       <textarea
                        className="w-full border border-slate-200 rounded-lg p-3 text-sm min-h-[120px] focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none bg-white transition-all"
                        placeholder="Observaciones importantes sobre el cliente..."
                        value={editing.notas || ""}
                        onChange={(e) =>
                          setEditing({ ...editing, notas: e.target.value })
                        }
                      />
                    </div>
                  </TabsContent>

                  {/* TAB FISCAL */}
                  <TabsContent value="fiscal" className="space-y-6 mt-0 border-0 p-0">
                    <div className="bg-blue-50/30 p-4 rounded-xl border border-blue-100/50 space-y-4">
                      <h4 className="text-sm font-semibold text-blue-800">Identificación Fiscal</h4>
                      
                      <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Razón Social</label>
                        <Input
                          placeholder="Nombre legal completo"
                          className="bg-white border-slate-200"
                          value={editing.razon_social || ""}
                          onChange={(e) =>
                            setEditing({ ...editing, razon_social: e.target.value })
                          }
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">NIF / CIF</label>
                          <Input
                            placeholder="B12345678"
                            className="bg-white border-slate-200"
                            value={editing.nif || editing.nif_cif || ""}
                            onChange={(e) =>
                              setEditing({ ...editing, nif: e.target.value, nif_cif: e.target.value })
                            }
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Email Facturación</label>
                          <Input
                            type="email"
                            placeholder="facturas@empresa.com"
                            className="bg-white border-slate-200"
                            value={editing.email || ""}
                            onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100 space-y-4">
                      <h4 className="text-sm font-semibold text-slate-700">Pagos y Facturación</h4>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">IVA por Defecto</label>
                          <Select
                            value={String(editing.iva_defecto || "21")}
                            onValueChange={(v) => setEditing({ ...editing, iva_defecto: v })}
                          >
                            <SelectTrigger className="bg-white border-slate-200 w-full">
                              <SelectValue placeholder="Seleccionar IVA" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="21">21% (General)</SelectItem>
                              <SelectItem value="10">10% (Reducido)</SelectItem>
                              <SelectItem value="4">4% (Superreducido)</SelectItem>
                              <SelectItem value="0">0% (Exento)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Forma de Pago</label>
                          <Select
                            value={editing.forma_pago || "TRANSFERENCIA"}
                            onValueChange={(v) => setEditing({ ...editing, forma_pago: v })}
                          >
                            <SelectTrigger className="bg-white border-slate-200 w-full">
                              <SelectValue placeholder="Forma de pago" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="TRANSFERENCIA">Transferencia</SelectItem>
                              <SelectItem value="DOMICILIACION">Domiciliación</SelectItem>
                              <SelectItem value="EFECTIVO">Efectivo</SelectItem>
                              <SelectItem value="TARJETA">Tarjeta</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">IBAN Cuenta Bancaria</label>
                        <Input
                          placeholder="ES00 0000 0000 0000 0000 0000"
                          className="bg-white border-slate-200 font-mono text-sm"
                          value={editing.iban || ""}
                          onChange={(e) => setEditing({ ...editing, iban: e.target.value })}
                        />
                      </div>
                    </div>
                  </TabsContent>

                  {/* TAB GEOLOCALIZACIÓN Y DIRECCIÓN */}
                  <TabsContent value="geo" className="space-y-6 mt-0 border-0 p-0">
                    <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100 space-y-4">
                      <h4 className="text-sm font-semibold text-slate-700">Dirección Postal</h4>
                      
                      <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Dirección</label>
                        <Input
                          placeholder="Calle, número, piso..."
                          className="bg-white border-slate-200"
                          value={editing.direccion || ""}
                          onChange={(e) => setEditing({ ...editing, direccion: e.target.value })}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">CP</label>
                          <Input
                            placeholder="28001"
                            className="bg-white border-slate-200"
                            value={editing.cp || ""}
                            onChange={(e) => setEditing({ ...editing, cp: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Población</label>
                          <Input
                            placeholder="Madrid"
                            className="bg-white border-slate-200"
                            value={editing.poblacion || ""}
                            onChange={(e) => setEditing({ ...editing, poblacion: e.target.value })}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Provincia</label>
                          <Input
                            placeholder="Madrid"
                            className="bg-white border-slate-200"
                            value={editing.provincia || ""}
                            onChange={(e) => setEditing({ ...editing, provincia: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">País</label>
                          <Input
                            placeholder="España"
                            className="bg-white border-slate-200"
                            value={editing.pais || "España"}
                            onChange={(e) => setEditing({ ...editing, pais: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="bg-emerald-50/30 p-4 rounded-xl border border-emerald-100/50 space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-emerald-800">Geovalla (Fichaje)</h4>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="bg-white border-emerald-200 text-emerald-700 hover:bg-emerald-50 gap-2 h-8"
                          onClick={() => setGeoOpen(true)}
                        >
                          <MapIcon size={14} /> Abrir Mapa
                        </Button>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Política de Restricción</label>
                        <Select
                          value={editing.geo_policy || "strict"}
                          onValueChange={(v: string) =>
                            setEditing({ ...editing, geo_policy: v })
                          }
                        >
                          <SelectTrigger className="bg-white border-emerald-200">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="strict">Estricto (Bloquea fuera)</SelectItem>
                            <SelectItem value="soft">Flexible (Avisa fuera)</SelectItem>
                            <SelectItem value="info">Solo Informativo</SelectItem>
                            <SelectItem value="none">Desactivado</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white p-2 rounded-lg border border-emerald-100/50">
                           <label className="text-[10px] font-bold text-slate-400 uppercase block">Coordenada Lat</label>
                           <p className="text-sm font-mono text-slate-700">
                             {editing.lat != null ? Number(editing.lat).toFixed(6) : "—"}
                           </p>
                        </div>
                        <div className="bg-white p-2 rounded-lg border border-emerald-100/50">
                           <label className="text-[10px] font-bold text-slate-400 uppercase block">Coordenada Lng</label>
                           <p className="text-sm font-mono text-slate-700">
                             {editing.lng != null ? Number(editing.lng).toFixed(6) : "—"}
                           </p>
                        </div>
                      </div>
                      
                      <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Radio de margen (Metros)</label>
                        <Input
                          type="number"
                          placeholder="100"
                          className="bg-white border-emerald-200"
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
                  </TabsContent>
                </Tabs>
              </div>

              {/* Footer Drawer */}
              <div className="p-6 border-t bg-slate-50/80 flex gap-3">
                <Button 
                  variant="outline" 
                  className="flex-1 rounded-xl h-12"
                  onClick={() => setDrawerOpen(false)}
                >
                  Cancelar
                </Button>
                <Button 
                  className="flex-[2] rounded-xl h-12 bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-200" 
                  disabled={loading} 
                  onClick={save}
                >
                  {loading ? "Guardando..." : "Guardar Cliente"}
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
