"use client";

import { useEffect, useState, useRef } from "react";
import { api } from "@/services/api";
import { getUser, logout } from "@/services/auth";
import {
  Settings, Users, Clock, AlertTriangle, Briefcase, Calendar,
  Eye, EyeOff, ChevronUp, ChevronDown, LayoutGrid, X,
} from "lucide-react";
import Link from "next/link";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { showSuccess } from "@/lib/toast";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";

interface DashboardData {
  empleadosActivos: number;
  fichajesHoy: number;
  sospechososHoy: number;
  trabajandoAhora: { id: string; empleado_nombre: string; cliente_nombre: string | null; estado: string; desde: string }[];
  ultimosFichajes: { id: string; empleado_nombre: string; cliente_nombre: string | null; tipo: string; fecha: string }[];
  stats?: {
    fichajesUltimosDias: { dia: string; cantidad: number }[];
    fichajesPorTipoHoy: { tipo: string; cantidad: number }[];
    topClientesSemana: { nombre: string; total: number }[];
  };
}

type WidgetConfig = { id: string; visible: boolean };

const ALL_WIDGETS = [
  { id: "kpi_empleados", label: "KPI: Empleados activos", module: "empleados", icon: Users },
  { id: "kpi_fichajes", label: "KPI: Fichajes hoy", module: "fichajes", icon: Clock },
  { id: "kpi_sospechosos", label: "KPI: Sospechosos", module: "fichajes", icon: AlertTriangle },
  { id: "kpi_calendario", label: "KPI: Calendario", module: "calendario", icon: Calendar },
  { id: "chart_actividad", label: "Actividad semanal", module: "fichajes", icon: LayoutGrid },
  { id: "chart_clientes", label: "Top clientes / Distribución", module: null, icon: LayoutGrid },
  { id: "list_trabajando", label: "Trabajando ahora", module: "fichajes", icon: Briefcase },
  { id: "list_fichajes", label: "Últimos fichajes", module: "fichajes", icon: Clock },
];

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [modulos, setModulos] = useState<Record<string, boolean>>({});
  const [widgets, setWidgets] = useState<WidgetConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState(false);
  const [editingWidgets, setEditingWidgets] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  function hasModule(name: string) {
    return modulos[name] !== false;
  }

  function isWidgetVisible(id: string) {
    const w = widgets.find((w) => w.id === id);
    return w ? w.visible : true;
  }

  function shouldShowWidget(id: string, module: string | null) {
    if (module && !hasModule(module)) return false;
    return isWidgetVisible(id);
  }

  async function loadAll() {
    try {
      setLoading(true);
      const [dashRes, widgetRes] = await Promise.all([
        api.get("/admin/dashboard"),
        api.get("/admin/configuracion/widgets").catch(() => ({ data: { widgets: [] } })),
      ]);
      setData(dashRes.data);
      const w = widgetRes.data.widgets;
      setWidgets(Array.isArray(w) ? w : []);
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || "No se pudieron cargar los datos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const u = getUser();
    if (u) setModulos(u.modulos || {});
    loadAll();
  }, []);

  useEffect(() => {
    const handler = () => {
      const u = getUser();
      if (u) setModulos(u.modulos || {});
      loadAll();
    };
    window.addEventListener("session-updated", handler);
    return () => window.removeEventListener("session-updated", handler);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function toggleWidget(id: string) {
    setWidgets((prev) => {
      const existing = prev.find((w) => w.id === id);
      if (existing) {
        return prev.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w));
      }
      return [...prev, { id, visible: false }];
    });
  }

  function moveWidget(id: string, direction: "up" | "down") {
    const order = getWidgetOrder();
    const idx = order.indexOf(id);
    if (idx === -1) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= order.length) return;
    const newOrder = [...order];
    [newOrder[idx], newOrder[newIdx]] = [newOrder[newIdx], newOrder[idx]];
    setWidgets(newOrder.map((wid) => {
      const existing = widgets.find((w) => w.id === wid);
      return { id: wid, visible: existing ? existing.visible : true };
    }));
  }

  function getWidgetOrder(): string[] {
    const safeWidgets = Array.isArray(widgets) ? widgets : [];
    const configured = safeWidgets.map((w) => w.id);
    const unconfigured = ALL_WIDGETS.map((w) => w.id).filter((id) => !configured.includes(id));
    return [...configured, ...unconfigured];
  }

  async function saveWidgets() {
    try {
      await api.put("/admin/configuracion/widgets", { widgets });
      showSuccess("Widgets guardados");
      setEditingWidgets(false);
    } catch {
      // silent
    }
  }

  function hora(d: string) {
    return new Date(d).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  }
  function fecha(d: string) {
    return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
  }
  function fechaGrafico(d: string) {
    const p = d.split("-");
    return p.length === 3 ? `${p[2]}/${p[1]}` : d;
  }
  function labelTipo(t: string) {
    const m: Record<string, string> = { entrada: "ENTRADA", salida: "SALIDA", descanso_inicio: "INICIO DESCANSO", descanso_fin: "FIN DESCANSO" };
    return m[t] || t.toUpperCase();
  }
  function badgeClass(t: string) {
    const base = "px-2 py-1 rounded-full text-xs font-medium";
    const m: Record<string, string> = { entrada: `bg-green-100 text-green-800 ${base}`, salida: `bg-red-100 text-red-800 ${base}`, descanso_inicio: `bg-yellow-100 text-yellow-800 ${base}`, descanso_fin: `bg-yellow-100 text-yellow-800 ${base}` };
    return m[t] || `bg-gray-100 text-gray-800 ${base}`;
  }

  if (loading) return <LoadingSpinner fullPage />;
  if (error || !data) {
    return (
      <div className="app-main">
        <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-4"><p className="text-red-700">{error}</p></div>
        <button onClick={loadAll} className="btn-primary">Reintentar</button>
      </div>
    );
  }

  const orderedWidgets = getWidgetOrder();

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Resumen general de actividad</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditingWidgets(!editingWidgets)}
            className={`p-2 rounded-lg transition-colors ${editingWidgets ? "bg-blue-100 text-blue-600" : "hover:bg-gray-100 text-gray-500"}`}
            title="Personalizar widgets"
          >
            <LayoutGrid className="w-5 h-5" />
          </button>
          <div className="relative" ref={menuRef}>
            <button onClick={() => setOpenMenu(!openMenu)} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
              <Settings className="w-5 h-5 text-gray-500" />
            </button>
            {openMenu && (
              <div className="absolute right-0 mt-2 w-52 bg-white border rounded-xl shadow-xl z-50 overflow-hidden">
                <Link href="/admin/configuracion" className="block px-4 py-3 text-sm hover:bg-gray-50" onClick={() => setOpenMenu(false)}>Configuración</Link>
                <Link href="/admin/perfil" className="block px-4 py-3 text-sm hover:bg-gray-50" onClick={() => setOpenMenu(false)}>Perfil</Link>
                <div className="border-t" />
                <button className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50" onClick={logout}>Cerrar sesión</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Widget Editor Panel */}
      {editingWidgets && (
        <div className="bg-white border-2 border-blue-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Personalizar Dashboard</h3>
            <div className="flex gap-2">
              <button onClick={saveWidgets} className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-600">Guardar</button>
              <button onClick={() => setEditingWidgets(false)} className="p-1"><X className="w-4 h-4 text-gray-400" /></button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {orderedWidgets.map((id, idx) => {
              const def = ALL_WIDGETS.find((w) => w.id === id);
              if (!def) return null;
              if (def.module && !hasModule(def.module)) return null;
              const visible = isWidgetVisible(id);
              const Icon = def.icon;
              return (
                <div key={id} className={`flex items-center gap-2 p-2 rounded-lg border transition-colors ${visible ? "bg-blue-50 border-blue-200" : "bg-gray-50 border-gray-200"}`}>
                  <button onClick={() => toggleWidget(id)} className="shrink-0">
                    {visible ? <Eye className="w-4 h-4 text-blue-500" /> : <EyeOff className="w-4 h-4 text-gray-400" />}
                  </button>
                  <Icon className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="text-xs flex-1 truncate">{def.label}</span>
                  <div className="flex flex-col shrink-0">
                    <button onClick={() => moveWidget(id, "up")} disabled={idx === 0} className="disabled:opacity-20"><ChevronUp className="w-3 h-3" /></button>
                    <button onClick={() => moveWidget(id, "down")} disabled={idx === orderedWidgets.length - 1} className="disabled:opacity-20"><ChevronDown className="w-3 h-3" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {shouldShowWidget("kpi_empleados", "empleados") && (
          <div className="bg-white rounded-xl p-4 md:p-6 shadow-sm border hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm font-medium text-gray-500">Empleados</p>
                <p className="text-2xl md:text-3xl font-bold mt-1">{data.empleadosActivos}</p>
              </div>
              <div className="p-2 md:p-3 bg-blue-50 rounded-lg"><Users className="w-5 h-5 md:w-6 md:h-6 text-blue-600" /></div>
            </div>
          </div>
        )}
        {shouldShowWidget("kpi_fichajes", "fichajes") && (
          <div className="bg-white rounded-xl p-4 md:p-6 shadow-sm border hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm font-medium text-gray-500">Fichajes Hoy</p>
                <p className="text-2xl md:text-3xl font-bold mt-1">{data.fichajesHoy}</p>
              </div>
              <div className="p-2 md:p-3 bg-green-50 rounded-lg"><Clock className="w-5 h-5 md:w-6 md:h-6 text-green-600" /></div>
            </div>
          </div>
        )}
        {shouldShowWidget("kpi_sospechosos", "fichajes") && (
          <div className="bg-white rounded-xl p-4 md:p-6 shadow-sm border hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm font-medium text-gray-500">Sospechosos</p>
                <p className={`text-2xl md:text-3xl font-bold mt-1 ${data.sospechososHoy > 0 ? "text-red-600" : ""}`}>{data.sospechososHoy}</p>
              </div>
              <div className={`p-2 md:p-3 rounded-lg ${data.sospechososHoy > 0 ? "bg-red-50" : "bg-gray-50"}`}>
                <AlertTriangle className={`w-5 h-5 md:w-6 md:h-6 ${data.sospechososHoy > 0 ? "text-red-600" : "text-gray-400"}`} />
              </div>
            </div>
          </div>
        )}
        {shouldShowWidget("kpi_calendario", "calendario") && (
          <div className="bg-white rounded-xl p-4 md:p-6 shadow-sm border hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm font-medium text-gray-500">Calendario</p>
                <Link href="/admin/calendario" className="text-sm font-semibold text-primary hover:underline mt-1 inline-block">Ver planificación</Link>
              </div>
              <div className="p-2 md:p-3 bg-purple-50 rounded-lg"><Calendar className="w-5 h-5 md:w-6 md:h-6 text-purple-600" /></div>
            </div>
          </div>
        )}
      </div>

      {/* Charts */}
      {data.stats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {shouldShowWidget("chart_actividad", "fichajes") && (
            <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border">
              <h3 className="text-base md:text-lg font-semibold">Actividad Semanal</h3>
              <p className="text-xs md:text-sm text-gray-500 mb-4">Fichajes últimos 7 días</p>
              <div className="h-52 md:h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.stats.fichajesUltimosDias}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="dia" tickFormatter={fechaGrafico} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: "transparent" }} contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }} />
                    <Bar dataKey="cantidad" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={32} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          {shouldShowWidget("chart_clientes", null) && (
            <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border">
              <h3 className="text-base md:text-lg font-semibold mb-4">
                {hasModule("clientes") ? "Top Clientes (Semana)" : "Distribución Tipos Hoy"}
              </h3>
              <div className="h-52 md:h-64">
                {hasModule("clientes") && data.stats.topClientesSemana.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.stats.topClientesSemana} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal vertical={false} />
                      <XAxis type="number" hide />
                      <YAxis dataKey="nombre" type="category" width={100} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip cursor={{ fill: "transparent" }} contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }} />
                      <Bar dataKey="total" fill="#10b981" radius={[0, 4, 4, 0]} barSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={data.stats.fichajesPorTipoHoy} cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={5} dataKey="cantidad">
                        {data.stats.fichajesPorTipoHoy.map((_, i) => (
                          <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend iconType="circle" />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lists */}
      <div className="grid lg:grid-cols-2 gap-6">
        {shouldShowWidget("list_trabajando", "fichajes") && (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="p-4 md:p-6 border-b flex items-center justify-between">
              <h2 className="text-base md:text-lg font-semibold flex items-center gap-2"><Briefcase className="w-5 h-5 text-gray-400" /> Trabajando ahora</h2>
              <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">{data.trabajandoAhora.length}</span>
            </div>
            {!data.trabajandoAhora.length ? (
              <div className="p-8 text-center text-gray-500 text-sm">Nadie fichando actualmente</div>
            ) : (
              <div className="divide-y max-h-[350px] overflow-y-auto">
                {data.trabajandoAhora.map((t) => (
                  <div key={t.id} className="p-3 md:p-4 hover:bg-gray-50 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-sm">{t.empleado_nombre}</div>
                      <div className="text-xs text-gray-500">{t.cliente_nombre || "Sin cliente"} · Desde {hora(t.desde)}</div>
                    </div>
                    <div className="w-2 h-2 rounded-full bg-green-500 ring-2 ring-green-100" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {shouldShowWidget("list_fichajes", "fichajes") && (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="p-4 md:p-6 border-b">
              <h2 className="text-base md:text-lg font-semibold flex items-center gap-2"><Clock className="w-5 h-5 text-gray-400" /> Últimos fichajes</h2>
            </div>
            {!data.ultimosFichajes.length ? (
              <div className="p-8 text-center text-gray-500 text-sm">No hay actividad reciente</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50/50 text-gray-500">
                    <tr>
                      <th className="px-4 md:px-6 py-3 font-medium">Empleado</th>
                      <th className="px-4 md:px-6 py-3 font-medium hidden sm:table-cell">Cliente</th>
                      <th className="px-4 md:px-6 py-3 font-medium">Estado</th>
                      <th className="px-4 md:px-6 py-3 font-medium text-right">Hora</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.ultimosFichajes.map((f) => (
                      <tr key={f.id} className="hover:bg-gray-50">
                        <td className="px-4 md:px-6 py-3 font-medium">{f.empleado_nombre}</td>
                        <td className="px-4 md:px-6 py-3 text-gray-500 hidden sm:table-cell">{f.cliente_nombre || "—"}</td>
                        <td className="px-4 md:px-6 py-3"><span className={badgeClass(f.tipo)}>{labelTipo(f.tipo)}</span></td>
                        <td className="px-4 md:px-6 py-3 text-gray-500 text-right">
                          <div className="flex flex-col items-end"><span>{hora(f.fecha)}</span><span className="text-xs text-gray-400">{fecha(f.fecha)}</span></div>
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
  );
}
