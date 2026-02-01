"use client";

// Admin Dashboard with Recharts

import { useEffect, useState, useRef } from "react";
import { api } from "@/services/api";
import { getUser, logout } from "@/services/auth";
import { Settings, Users, Clock, AlertTriangle, Briefcase, Calendar } from "lucide-react";
import Link from "next/link";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

/* ========================
   Types
======================== */

interface TrabajandoAhoraItem {
  id: string;
  empleado_id: string;
  empleado_nombre: string;
  cliente_nombre: string | null;
  estado: string;
  desde: string;
}

interface UltimoFichaje {
  id: string;
  empleado_nombre: string;
  cliente_nombre: string | null;
  tipo: string;
  fecha: string;
}

interface DashboardData {
  empleadosActivos: number;
  fichajesHoy: number;
  sospechososHoy: number;
  trabajandoAhora: TrabajandoAhoraItem[];
  ultimosFichajes: UltimoFichaje[];
  stats?: {
    fichajesUltimosDias: { dia: string; cantidad: number }[];
    fichajesPorTipoHoy: { tipo: string; cantidad: number }[];
    topClientesSemana: { nombre: string; total: number }[];
  };
}

type Session = {
  modulos: {
    clientes?: boolean;
    fichajes?: boolean;
    calendario?: boolean;
    calendario_import?: boolean;
    empleados?: boolean;
    worklogs?: boolean;
    ausencias?: boolean;
    facturacion?: boolean;
  };
};

/* ========================
   Component
======================== */

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openMenu, setOpenMenu] = useState(false);

  const menuRef = useRef<HTMLDivElement | null>(null);

  /* ========================
     Session
  ======================== */

  function loadSession() {
    try {
      const u = getUser();
      if (!u) return;

      setSession({
        modulos: u.modulos || {},
      });
    } catch {}
  }

  /* ========================
     Data
  ======================== */

  async function loadDashboard() {
    try {
      setLoading(true);

      const res = await api.get("/admin/dashboard");

      setData(res.data);
      setError(null);
    } catch (err: any) {
      console.error(err);

      setError(err?.response?.data?.error || "No se pudieron cargar los datos");
    } finally {
      setLoading(false);
    }
  }

  /* ========================
     Effects
  ======================== */

  useEffect(() => {
    loadSession();
    loadDashboard();
  }, []);

  useEffect(() => {
    function onSessionUpdated() {
      loadSession();
      loadDashboard();
    }

    window.addEventListener("session-updated", onSessionUpdated);

    return () => {
      window.removeEventListener("session-updated", onSessionUpdated);
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  /* ========================
     Helpers
  ======================== */

  function hasModule(name: keyof Session["modulos"]) {
    return session?.modulos?.[name] === true;
  }

  function hora(d: string) {
    return new Date(d).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function fecha(d: string) {
    return new Date(d).toLocaleDateString("es-ES", {
        day: '2-digit',
        month: '2-digit'
    });
  }
  
  function fechaGrafico(d: string) {
      // convierte YYYY-MM-DD a DD/MM
      const parts = d.split('-');
      if(parts.length === 3) return `${parts[2]}/${parts[1]}`;
      return d;
  }

  function labelTipo(tipo: string) {
    switch (tipo) {
      case "entrada":
        return "ENTRADA";
      case "salida":
        return "SALIDA";
      case "descanso_inicio":
        return "INICIO DESCANSO";
      case "descanso_fin":
        return "FIN DESCANSO";
      default:
        return tipo.toUpperCase();
    }
  }

  function badgeClass(tipo: string) {
    switch (tipo) {
      case "entrada":
        return "bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-medium";
      case "salida":
        return "bg-red-100 text-red-800 px-2 py-1 rounded-full text-xs font-medium";
      case "descanso_inicio":
      case "descanso_fin":
        return "bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs font-medium";
      default:
        return "bg-gray-100 text-gray-800 px-2 py-1 rounded-full text-xs font-medium";
    }
  }

  /* ========================
     Render
  ======================== */

  if (loading) return <LoadingSpinner fullPage />;

  if (error || !data) {
    return (
      <div className="app-main">
        <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-4">
            <p className="text-red-700">{error}</p>
        </div>
        <button onClick={loadDashboard} className="btn-primary">
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">Dashboard</h1>
            <p className="text-gray-500 mt-1">Resumen general de actividad</p>
        </div>

        {/* Admin menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setOpenMenu(!openMenu)}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors"
          >
            <Settings className="w-6 h-6 text-gray-600" />
          </button>

          {openMenu && (
            <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-100 rounded-xl shadow-xl z-50 overflow-hidden">
              <Link
                href="/admin/configuracion"
                className="block px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                onClick={() => setOpenMenu(false)}
              >
                ⚙️ Configuración
              </Link>

              <Link
                href="/admin/perfil"
                className="block px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                onClick={() => setOpenMenu(false)}
              >
                👤 Perfil
              </Link>

              <div className="border-t border-gray-100"></div>

              <button
                className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 transition-colors"
                onClick={() => {
                  logout();
                }}
              >
                🚪 Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {hasModule("empleados") && (
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-gray-500">Empleados Activos</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">{data.empleadosActivos}</p>
                </div>
                <div className="p-3 bg-blue-50 rounded-lg">
                    <Users className="w-6 h-6 text-blue-600" />
                </div>
            </div>
          </div>
        )}

        {hasModule("fichajes") && (
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-gray-500">Fichajes Hoy</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">{data.fichajesHoy}</p>
                </div>
                <div className="p-3 bg-green-50 rounded-lg">
                    <Clock className="w-6 h-6 text-green-600" />
                </div>
            </div>
          </div>
        )}

        {hasModule("fichajes") && (
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-gray-500">Sospechosos</p>
                    <p className={`text-3xl font-bold mt-2 ${data.sospechososHoy > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                        {data.sospechososHoy}
                    </p>
                </div>
                <div className={`p-3 rounded-lg ${data.sospechososHoy > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                    <AlertTriangle className={`w-6 h-6 ${data.sospechososHoy > 0 ? 'text-red-600' : 'text-gray-400'}`} />
                </div>
            </div>
          </div>
        )}

         {hasModule("calendario") && (
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
             <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-gray-500">Calendario</p>
                     <Link
                        href="/admin/calendario"
                        className="text-sm font-semibold text-primary hover:underline mt-2 inline-block"
                    >
                        Ver planificación →
                    </Link>
                </div>
                <div className="p-3 bg-purple-50 rounded-lg">
                    <Calendar className="w-6 h-6 text-purple-600" />
                </div>
            </div>
          </div>
        )}
      </div>

      {/* CHARTS ROW */}
      {data.stats && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Activity Chart */}
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Actividad Semanal</h3>
                    <p className="text-sm text-gray-500 mb-6">Total de fichajes realizados en los últimos 7 días</p>
                  </div>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data.stats.fichajesUltimosDias}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis 
                                dataKey="dia" 
                                tickFormatter={fechaGrafico} 
                                tick={{fontSize: 12}}
                                axisLine={false}
                                tickLine={false}
                            />
                            <YAxis 
                                tick={{fontSize: 12}}
                                axisLine={false}
                                tickLine={false}
                            />
                            <Tooltip 
                                cursor={{fill: 'transparent'}}
                                contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                            />
                            <Bar 
                                dataKey="cantidad" 
                                fill="#3b82f6" 
                                radius={[4, 4, 0, 0]} 
                                barSize={40}
                            />
                        </BarChart>
                    </ResponsiveContainer>
                  </div>
              </div>

              {/* Distro Chart or Top Clients */}
               <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                  <h3 className="text-lg font-semibold text-gray-900 mb-6">
                      {hasModule('clientes') ? 'Top Clientes (Semana)' : 'Distribución Tipos Hoy'}
                  </h3>
                   <div className="h-64">
                       {hasModule('clientes') && data.stats.topClientesSemana.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={data.stats.topClientesSemana} layout="vertical" margin={{left: 20}}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                                    <XAxis type="number" hide />
                                    <YAxis 
                                        dataKey="nombre" 
                                        type="category" 
                                        width={100}
                                        tick={{fontSize: 11}}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <Tooltip 
                                        cursor={{fill: 'transparent'}}
                                         contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                                    />
                                    <Bar dataKey="total" fill="#10b981" radius={[0, 4, 4, 0]} barSize={20} />
                                </BarChart>
                            </ResponsiveContainer>
                       ) : (
                           // Fallback to Pie Chart if no client data or clients module disabled
                           <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={data.stats.fichajesPorTipoHoy}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={5}
                                        dataKey="cantidad"
                                    >
                                        {data.stats.fichajesPorTipoHoy.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip />
                                    <Legend iconType="circle" />
                                </PieChart>
                           </ResponsiveContainer>
                       )}
                   </div>
               </div>
          </div>
      )}

      {/* Bottom Lists */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Trabajando ahora */}
        {hasModule("fichajes") && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-50 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-gray-400" />
                  Trabajando ahora
              </h2>
              <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                  {data.trabajandoAhora.length} activos
              </span>
            </div>

            <div className="p-0">
              {!data.trabajandoAhora.length ? (
                <div className="p-8 text-center text-gray-500">
                    <p>Ningún empleado está fichando actualmente</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50 max-h-[400px] overflow-y-auto">
                  {data.trabajandoAhora.map((t) => (
                    <div key={t.id} className="p-4 hover:bg-gray-50 transition-colors flex items-center justify-between group">
                      <div>
                          <div className="font-semibold text-gray-900">{t.empleado_nombre}</div>
                          <div className="text-sm text-gray-500 flex items-center gap-1">
                              {t.cliente_nombre ? (
                                  <span className="text-blue-600 font-medium">{t.cliente_nombre}</span>
                              ) : "Sin cliente"}
                              <span>·</span>
                              <span>Desde {hora(t.desde)}</span>
                          </div>
                      </div>
                      <div className="w-2 h-2 rounded-full bg-green-500 ring-2 ring-green-100 group-hover:ring-green-200 transition-all"></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Últimos fichajes */}
        {hasModule("fichajes") && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-50">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-gray-400" />
                  Últimos fichajes
              </h2>
            </div>
            
            <div className="overflow-x-auto">
                {!data.ultimosFichajes.length ? (
                <div className="p-8 text-center text-gray-500">
                    <p>No hay actividad reciente</p>
                </div>
                ) : (
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50/50 text-gray-500">
                            <tr>
                                <th className="px-6 py-3 font-medium">Empleado</th>
                                <th className="px-6 py-3 font-medium hidden sm:table-cell">Cliente</th>
                                <th className="px-6 py-3 font-medium">Estado</th>
                                <th className="px-6 py-3 font-medium text-right">Hora</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                        {data.ultimosFichajes.map((f) => (
                            <tr key={f.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-6 py-4 font-medium text-gray-900">{f.empleado_nombre}</td>
                                <td className="px-6 py-4 text-gray-500 hidden sm:table-cell">{f.cliente_nombre || "—"}</td>
                                <td className="px-6 py-4">
                                    <span className={badgeClass(f.tipo)}>
                                        {labelTipo(f.tipo)}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-gray-500 text-right">
                                    <div className="flex flex-col items-end">
                                        <span>{hora(f.fecha)}</span>
                                        <span className="text-xs text-gray-400">{fecha(f.fecha)}</span>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
