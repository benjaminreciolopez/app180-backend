// app/empleado/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/services/api";
import { logout } from "@/services/auth";
import { useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import FloatingActionButton from "@/components/ui/FloatingActionButton";

import IOSDrawer from "@/components/ui/IOSDrawer";
import DrawerMenu from "@/components/empleado/drawer/DrawerMenu";
import DrawerCalendario from "@/components/empleado/DrawerCalendario";
import DrawerDiaDetalle from "@/components/empleado/drawer/DrawerDiaDetalle";
import DrawerSolicitarAusencia from "@/components/empleado/DrawerSolicitarAusencia";
import DrawerMisSolicitudes from "@/components/empleado/DrawerMisSolicitudes";
import DrawerEventoDetalle from "@/components/empleado/DrawerEventoDetalle";
import type { CalendarioEvento } from "@/components/empleado/calendarioTypes";
import { FichajeAction } from "./FichajeAction";
import type { EstadoAusencia } from "@/types/ausencias";
import { useEstadoFichaje } from "./useEstadoFichaje";
import { usePlanDiaEmpleado } from "./usePlanDiaEmpleado";
import PlanVsRealTimeline from "./PlanVsRealTimeline";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

type FichajeHoy = { id: string; tipo_label: string; hora: string };
type WorkLogHoy = {
  id: string;
  descripcion: string;
  minutos: number | null;
  cliente_nombre?: string | null;
  tipo_facturacion?: 'hora' | 'dia' | 'mes' | 'valorado';
  duracion_texto?: string | null;
};

type DashboardData = {
  nombre?: string;
  fichando?: boolean;
  estado_label?: string;
  estado_color?: string;
  minutos_trabajados_hoy?: string;
  fichajes_hoy?: FichajeHoy[];
};

function colorClass(color?: string) {
  switch (color) {
    case "green-600":
      return "text-green-600";
    case "red-600":
      return "text-red-600";
    case "yellow-600":
      return "text-yellow-600";
    case "blue-600":
      return "text-blue-600";
    default:
      return "text-gray-500";
  }
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

function hhmmssToMin(v?: string | null) {
  if (!v) return null;
  const s = String(v).slice(0, 8);
  const [hh, mm, ss] = s.split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm + (Number.isFinite(ss) ? ss / 60 : 0);
}

function isNowOutsideRange(rango?: { inicio: string; fin: string } | null) {
  if (!rango?.inicio || !rango?.fin) return false;
  const n = nowMinutes();
  const a = hhmmssToMin(rango.inicio);
  const z = hhmmssToMin(rango.fin);
  if (a == null || z == null) return false;
  const GRACE = 10;
  return n < a - GRACE || n > z + GRACE;
}

function hhmm(v?: string | null) {
  if (!v) return "—";
  return String(v).slice(0, 5);
}

function fmtMin(min?: number | null) {
  if (min == null || Number.isNaN(Number(min))) return "—";
  const m = Math.max(0, Math.floor(Number(min)));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${r}m`;
  return `${h}h ${String(r).padStart(2, "0")}m`;
}

function fmtRangeISO(startIso?: string | null, endIso?: string | null) {
  if (!startIso) return "—";
  const s = new Date(startIso);
  const e = endIso ? new Date(endIso) : null;
  const hs = String(s.getHours()).padStart(2, "0");
  const ms = String(s.getMinutes()).padStart(2, "0");
  if (!e) return `${hs}:${ms} – …`;
  const he = String(e.getHours()).padStart(2, "0");
  const me = String(e.getMinutes()).padStart(2, "0");
  return `${hs}:${ms} – ${he}:${me}`;
}

type DrawerKey =
  | "menu"
  | "calendario"
  | "dia"
  | "evento"
  | "vacaciones"
  | "baja"
  | "solicitudes";

type DrawerScreen = { key: DrawerKey; title: string };


function formatWorkLogDuracion(item: WorkLogHoy) {
  if (item.tipo_facturacion === 'valorado') {
      return item.duracion_texto || '—';
  }
  
  const m = item.minutos;
  if (m == null) return "—";

  if (item.tipo_facturacion === 'dia') {
      const dias = m / 480;
      const val = Number(dias.toFixed(2));
      return `${val} ${val === 1 ? 'día' : 'días'}`;
  }

  if (item.tipo_facturacion === 'mes') {
      const meses = m / 9600;
      const val = Number(meses.toFixed(2));
      return `${val} ${val === 1 ? 'mes' : 'meses'}`;
  }

  // Default horas - fallback to avoid "min" text if minutes are large
  // Assuming user wants hours since that's standard for labor
  const horas = m / 60;
  return `${Number(horas.toFixed(2))} h`;
}

export default function EmpleadoDashboardPage() {
  const router = useRouter();

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const {
    estado: estadoFichaje,
    boton,
    reload: reloadEstadoFichaje,
  } = useEstadoFichaje();

  const {
    data: planDia,
    loading: loadingPlan,
    error: errorPlan,
    reload: reloadPlanDia,
  } = usePlanDiaEmpleado();

  const [workLogsHoy, setWorkLogsHoy] = useState<WorkLogHoy[]>([]);
  const [estadoDia, setEstadoDia] = useState<{
    laborable: boolean;
    label?: string;
  } | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [stack, setStack] = useState<DrawerScreen[]>([
    { key: "menu", title: "Opciones" },
  ]);
  const current = stack[stack.length - 1];

  const [selectedEvent, setSelectedEvent] = useState<CalendarioEvento | null>(
    null
  );

  function openDrawer() {
    setDrawerOpen(true);
    setStack([{ key: "menu", title: "Opciones" }]);
    setSelectedEvent(null);
    setSelectedDay(null);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setStack([{ key: "menu", title: "Opciones" }]);
    setSelectedEvent(null);
    setSelectedDay(null);
  }

  function push(screen: DrawerScreen) {
    setStack((prev) => [...prev, screen]);
  }

  function pop() {
    setStack((prev) => {
      if (prev.length <= 1) {
        closeDrawer();
        return prev;
      }
      return prev.slice(0, -1);
    });
  }

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/empleado/dashboard");
      setData((res.data || {}) as DashboardData);
    } catch (e) {
      console.error(e);
      setError("No se ha podido cargar el dashboard");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadWorkLogsHoyFn() {
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      const res = await api.get("/worklogs/mis", {
        params: { desde: hoy, hasta: hoy },
      });
      setWorkLogsHoy(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      console.error("Error cargando work logs hoy", e);
      setWorkLogsHoy([]);
    }
  }

  async function loadEstadoDiaFn() {
    try {
      const res = await api.get("/calendario/hoy");
      setEstadoDia(res.data);
    } catch {
      setEstadoDia({ laborable: true });
    }
  }

  useEffect(() => {
    loadDashboard();
    loadWorkLogsHoyFn();
    loadEstadoDiaFn();
  }, []);

  const fichajesHoy = useMemo<FichajeHoy[]>(
    () => (Array.isArray(data?.fichajes_hoy) ? data!.fichajes_hoy! : []),
    [data]
  );

  const planBloques = useMemo(() => planDia?.plan?.bloques || [], [planDia]);
  const realBloques = useMemo(
    () => planDia?.resumen?.bloques_reales || [],
    [planDia]
  );
  const avisos = useMemo(() => planDia?.avisos || [], [planDia]);

  const outsideRange = useMemo(
    () => isNowOutsideRange(planDia?.plan?.rango || null),
    [planDia?.plan?.rango]
  );

  const status = useMemo(() => {
    const hasPlan = !!planDia?.plan?.plantilla_id;
    const hasAvisos = (avisos || []).length > 0;

    if (!hasPlan)
      return {
        label: "Sin planificación",
        cls: "bg-gray-100 border-gray-200 text-gray-700",
      };
    if (hasAvisos)
      return {
        label: "Incidencias",
        cls: "bg-yellow-50 border-yellow-200 text-yellow-900",
      };
    if (outsideRange)
      return {
        label: "Fuera de rango",
        cls: "bg-orange-50 border-orange-200 text-orange-900",
      };
    return {
      label: "Plan OK",
      cls: "bg-green-50 border-green-200 text-green-900",
    };
  }, [planDia?.plan?.plantilla_id, avisos, outsideRange]);

  if (loading) return <LoadingSpinner fullPage />;

  if (error) {
    return (
      <div className="p-4 space-y-3">
        <div className="text-red-600 font-semibold">{error}</div>
        <button className="btn-primary px-4 py-2" onClick={loadDashboard}>
          Reintentar
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="app-main space-y-6 pb-24">
      {/* FAB iOS */}
      <FloatingActionButton ariaLabel="Abrir menú" onClick={openDrawer}>
        <Menu size={18} className="text-gray-800" />
      </FloatingActionButton>

      {/* Drawer iOS stack */}
      <IOSDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        header={{
          title: current.title,
          canGoBack: stack.length > 1,
          onBack: pop,
          onClose: closeDrawer,
        }}
      >
        {current.key === "menu" ? (
          <DrawerMenu
            onCalendario={() =>
              push({ key: "calendario", title: "Calendario" })
            }
            onVacaciones={() =>
              push({ key: "vacaciones", title: "Solicitar vacaciones" })
            }
            onBaja={() => push({ key: "baja", title: "Solicitar baja médica" })}
            onSolicitudes={() =>
              push({ key: "solicitudes", title: "Mis solicitudes" })
            }
            onLogout={() => {
              logout();
            }}
          />
        ) : null}

        {current.key === "calendario" ? (
          <DrawerCalendario
            onSelectDay={(ymd) => {
              setSelectedDay(ymd);
              push({ key: "dia", title: ymd });
            }}
          />
        ) : null}

        {current.key === "dia" && selectedDay ? (
          <DrawerDiaDetalle
            ymd={selectedDay}
            onSelectEvent={(ev) => {
              setSelectedEvent(ev);
              push({ key: "evento", title: "Detalle" });
            }}
          />
        ) : null}

        {current.key === "evento" && selectedEvent ? (
          <DrawerEventoDetalle event={selectedEvent} />
        ) : null}

        {current.key === "vacaciones" ? (
          <DrawerSolicitarAusencia
            tipoInicial="vacaciones"
            onDone={() => {
              setSelectedEvent(null);
              setSelectedDay(null);
              setStack([
                { key: "menu", title: "Opciones" },
                { key: "calendario", title: "Calendario" },
              ]);
              loadEstadoDiaFn();
              reloadPlanDia();
            }}
          />
        ) : null}

        {current.key === "baja" ? (
          <DrawerSolicitarAusencia
            tipoInicial="baja_medica"
            onDone={() => {
              setSelectedEvent(null);
              setSelectedDay(null);
              setStack([
                { key: "menu", title: "Opciones" },
                { key: "calendario", title: "Calendario" },
              ]);
              loadEstadoDiaFn();
              reloadPlanDia();
            }}
          />
        ) : null}

        {current.key === "solicitudes" ? (
          <DrawerMisSolicitudes
            onSelectAusencia={(a) => {
              setSelectedEvent({
                id: `aus-${a.id}`,
                tipo: a.tipo,
                title: a.tipo === "baja_medica" ? "Baja médica" : "Vacaciones",
                start: a.fecha_inicio,
                end: a.fecha_fin,
                allDay: true,
                estado: a.estado as EstadoAusencia,
              });
              push({ key: "evento", title: "Detalle" });
            }}
          />
        ) : null}
      </IOSDrawer>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">
          Hola, {data.nombre || "Empleado"}
        </h1>
        <p className="text-muted">
          Jornada: {planDia?.plan?.plantilla_nombre ?? "Sin jornada"}
        </p>
      </div>

      {/* Estado de hoy */}
      <div className="bg-white border rounded p-4 space-y-2">
        <h2 className="font-semibold text-lg">Estado de hoy</h2>

        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Situación actual</span>
          <span
            className={`font-bold ${
              estadoFichaje === "dentro" ? "text-green-600" : "text-gray-500"
            }`}
          >
            {estadoFichaje === "dentro"
              ? "Trabajando"
              : estadoFichaje === "descanso"
                ? "En descanso"
                : "Fuera de jornada"}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Estado</span>
          <span className={`font-semibold ${colorClass(data.estado_color)}`}>
            {data.estado_label || "—"}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Hoy</span>
          <span className="font-semibold">
            {data.minutos_trabajados_hoy || "—"}
          </span>
        </div>
      </div>

      {estadoDia?.laborable === false ? (
        <div className="p-4 border rounded bg-gray-100 text-sm text-gray-700">
          Hoy no es un día laborable: <b>{estadoDia.label || "No laborable"}</b>
        </div>
      ) : null}

      {/* ============================= */}
      {/* PLAN + REAL + RESUMEN + AVISOS */}
      {/* ============================= */}
      <div className="card space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Plan de hoy</h3>

          <button
            className="text-xs px-2 py-1 rounded bg-gray-100 border hover:bg-gray-200 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
            onClick={reloadPlanDia}
            disabled={loadingPlan}
            title="Refrescar plan"
          >
            {loadingPlan ? "..." : "Refrescar"}
          </button>
        </div>

        {errorPlan ? (
          <div className="text-sm text-red-600">{errorPlan}</div>
        ) : loadingPlan ? (
          <div className="text-sm text-gray-500 py-4"><LoadingSpinner showText={false} /></div>
        ) : (
          <>
            <div className="text-sm text-gray-700">
              <b>Modo:</b>{" "}
              {planDia?.plan?.modo === "excepcion" ? "Excepción" : "Semanal"} ·{" "}
              <b>Rango:</b>{" "}
              {planDia?.plan?.rango
                ? `${hhmm(planDia.plan.rango.inicio)} – ${hhmm(
                    planDia.plan.rango.fin
                  )}`
                : "No definido"}
              {planDia?.plan?.nota ? (
                <>
                  {" "}
                  · <b>Nota:</b> {planDia.plan.nota}
                </>
              ) : null}
            </div>

            {planBloques.length === 0 ? (
              <div className="text-sm text-gray-500">
                Sin bloques esperados.
              </div>
            ) : (
              <ul className="text-sm space-y-2">
                {planBloques.map((b, idx) => {
                   const now = nowMinutes();
                   const start = hhmmssToMin(b.inicio) || 0;
                   const end = hhmmssToMin(b.fin) || 9999;
                   const isTime = now >= start && now <= end;
                   
                   const isClockedIn = estadoFichaje === 'dentro' || estadoFichaje === 'descanso';
                   const isActive = isClockedIn && isTime;

                   return (
                  <li
                    key={`${b.tipo}-${idx}`}
                    className={`flex items-center justify-between border rounded p-2 transition-all ${
                        isActive 
                        ? "border-green-500 bg-green-50 shadow-sm ring-1 ring-green-500 custom-bounce-subtle" 
                        : "border-gray-200"
                    }`}
                  >
                    <div className="flex flex-col">
                        <span className="font-medium capitalize flex items-center gap-2">
                            {b.tipo}
                            {isActive && (
                                <span className="text-[10px] bg-green-600 text-white px-1.5 py-0.5 rounded-full uppercase tracking-wider font-bold animate-pulse">
                                    En curso
                                </span>
                            )}
                        </span>
                        {isActive && <span className="text-xs text-green-700">Bloque actual</span>}
                    </div>
                    <span className={`text-gray-700 ${isActive ? 'font-bold':''}`}>
                      {hhmm(b.inicio)} – {hhmm(b.fin)}
                    </span>
                  </li>
                )})}
              </ul>
            )}
          </>
        )}
      </div>
      {!loadingPlan && planDia?.plan?.rango ? (
        <div className="card space-y-2">
          <h3 className="font-semibold">Plan vs Real</h3>

          <PlanVsRealTimeline
            rango={planDia.plan.rango}
            planBloques={planBloques}
            realBloques={realBloques}
          />
        </div>
      ) : null}

      <div className="card space-y-2">
        <h3 className="font-semibold">Lo que llevas hoy</h3>

        {loadingPlan ? (
          <div className="text-sm text-gray-500 py-4"><LoadingSpinner showText={false} /></div>
        ) : realBloques.length === 0 ? (
          <div className="text-sm text-gray-500">
            Aún no hay bloques reales.
          </div>
        ) : (
          <ul className="text-sm space-y-2">
            {realBloques.map((b: any, idx: number) => (
              <li
                key={`${b.tipo}-${idx}`}
                className="border rounded p-2 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium capitalize">{b.tipo}</span>
                  <span className="text-gray-700">
                    {fmtRangeISO(b.inicio, b.fin)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-600">
                  <span>{b.ubicacion || ""}</span>
                  <span>{b.minutos != null ? `${b.minutos} min` : ""}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card space-y-2">
        <h3 className="font-semibold">Resumen</h3>
        <div className="text-sm flex items-center justify-between">
          <span className="text-gray-600">Trabajado</span>
          <span className="font-semibold">
            {fmtMin(planDia?.resumen?.minutos_trabajados ?? null)}
          </span>
        </div>
        <div className="text-sm flex items-center justify-between">
          <span className="text-gray-600">Descanso</span>
          <span className="font-semibold">
            {fmtMin(planDia?.resumen?.minutos_descanso ?? null)}
          </span>
        </div>
        <div className="text-sm flex items-center justify-between">
          <span className="text-gray-600">Extra</span>
          <span className="font-semibold">
            {fmtMin(planDia?.resumen?.minutos_extra ?? null)}
          </span>
        </div>
      </div>

      {avisos.length > 0 ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-4 space-y-2">
          <h3 className="font-semibold text-sm">Avisos</h3>
          <ul className="text-sm text-yellow-900 list-disc ml-5 space-y-1">
            {avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Fichajes hoy */}
      <div className="card">
        <h3 className="font-semibold mb-3">Fichajes de hoy</h3>

        {fichajesHoy.length === 0 ? (
          <p className="text-sm text-gray-500">No hay fichajes hoy</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {fichajesHoy.map((f) => (
              <li key={f.id} className="flex justify-between">
                <span>{f.tipo_label}</span>
                <span>{f.hora}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Worklogs hoy */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Trabajos de hoy</h3>
          <button
            className="btn-primary text-sm px-3 py-1"
            onClick={() => router.push("/empleado/trabajos")}
          >
            Añadir
          </button>
        </div>

        {workLogsHoy.length === 0 ? (
          <p className="text-sm text-gray-500">
            No hay trabajos registrados hoy
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {workLogsHoy.map((w) => (
              <li key={w.id} className="flex justify-between items-start gap-2">
                <span className="truncate">
                  {w.descripcion}
                  {w.cliente_nombre ? (
                    <span className="text-gray-500"> · {w.cliente_nombre}</span>
                  ) : null}
                </span>
                <span className="whitespace-nowrap font-medium text-gray-700">
                  {formatWorkLogDuracion(w)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* Botón principal (fichaje) */}
      {/* Acciones */}
      <div className="sticky bottom-4 z-40 space-y-2 bg-white pt-2">
        <FichajeAction
          boton={boton}
          reload={() => {
            reloadEstadoFichaje();
            loadDashboard();
            loadWorkLogsHoyFn();
            reloadPlanDia();
          }}
        />

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => router.push("/empleado/trabajos")}
            className="bg-white border py-3 rounded-xl text-sm font-semibold shadow-sm transition-all hover:bg-gray-50 active:scale-95 active:bg-gray-100 cursor-pointer"
          >
            Añadir trabajo
          </button>
          <button
            onClick={openDrawer}
            className="bg-white border py-3 rounded-xl text-sm font-semibold shadow-sm transition-all hover:bg-gray-50 active:scale-95 active:bg-gray-100 cursor-pointer"
          >
            Menú
          </button>
        </div>
      </div>
    </div>
  );
}
