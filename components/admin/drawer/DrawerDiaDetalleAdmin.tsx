// app180-frontend/components/admin/drawer/DrawerDiaDetalleAdmin.tsx

"use client";

import { useMemo } from "react";
import type { CalendarioIntegradoEvento } from "@/types/calendario";
import { colorFor } from "@/components/empleado/calendarioColors";
import { Calendar, ChevronRight, UserCheck } from "lucide-react";

type DiaDetalleAdminData = {
  fecha: string; // YYYY-MM-DD
  laborable: boolean;
  label: string;
  descripcion?: string | null;
  eventos: CalendarioIntegradoEvento[];
};

function addOneDayYMD(ymd: string) {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (isNaN(d.getTime())) return ymd;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function safeYMD(value: string | Date) {
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  return s.slice(0, 10);
}

function eventTouchesDay(ev: CalendarioIntegradoEvento, ymd: string) {
  const isAllDay = Boolean(ev.allDay);
  if (isAllDay) {
    const s = safeYMD(ev.start);
    const endEx = ev.end ? safeYMD(ev.end) : addOneDayYMD(s);
    return ymd >= s && ymd < endEx;
  }
  const s = safeYMD(String(ev.start).slice(0, 10));
  return s === ymd;
}

function sortDayEvents(a: CalendarioIntegradoEvento, b: CalendarioIntegratedEvento) {
  const ad = Boolean(a.allDay);
  const bd = Boolean(b.allDay);
  if (ad !== bd) return ad ? -1 : 1;
  return String(a.start).localeCompare(String(b.start));
}

function buildDiaDetalleData(ymd: string, dayEvents: CalendarioIntegradoEvento[]): DiaDetalleAdminData {
  const festivo = dayEvents.find((e) => e.tipo === "calendario_empresa");
  const noLab = dayEvents.find((e) => e.tipo === "no_laborable");

  let laborable = true;
  let label = "Laborable";
  let descripcion: string | null = null;

  if (festivo) {
    laborable = false;
    label = "Festivo";
    descripcion = festivo.title || null;
  } else if (noLab) {
    laborable = false;
    label = "No laborable";
    descripcion = "Día no laborable";
  }

  return { fecha: ymd, laborable, label, descripcion, eventos: dayEvents };
}

function tipoLabel(t: CalendarioIntegradoEvento["tipo"]) {
  switch (t) {
    case "calendario_empresa": return "Festivo";
    case "no_laborable": return "No laborable";
    case "ausencia": return "Ausencia";
    case "jornada_real": return "Jornada real";
    case "jornada_plan": return "Plan";
    default: return t;
  }
}

function colorForEvento(ev: CalendarioIntegradoEvento) {
  if (ev.tipo === "ausencia") {
    const ausTipo = ev?.meta?.ausencia_tipo || "vacaciones";
    return colorFor(ausTipo, (ev.estado as any) || "aprobado");
  }
  if (ev.tipo === "jornada_real") {
    const wc = Number(ev?.meta?.warn_count || 0);
    if (wc >= 2) return colorFor("fichaje", "rechazado");
    if (wc >= 1) return colorFor("fichaje", "pendiente");
    return colorFor("fichaje", "aprobado");
  }
  if (ev.tipo === "calendario_empresa" || ev.tipo === "no_laborable") {
    return colorFor("festivo", "aprobado");
  }
  if (ev.tipo === "jornada_plan") return "#9CA3AF";
  return "#6B7280";
}

export default function DrawerDiaDetalleAdmin({
  ymd,
  allEvents,
  onSelectEvent,
  onCreatePlaning,
  onClose,
}: {
  ymd: string;
  allEvents: CalendarioIntegradoEvento[];
  onSelectEvent: (ev: CalendarioIntegradoEvento) => void;
  onCreatePlaning?: () => void;
  onClose: () => void;
}) {
  const dayEvents = useMemo(() => {
    return (allEvents || [])
      .filter((ev) => eventTouchesDay(ev, ymd))
      .slice()
      .sort(sortDayEvents as any);
  }, [allEvents, ymd]);

  const data = useMemo(() => buildDiaDetalleData(ymd, dayEvents), [ymd, dayEvents]);

  return (
    <div className="p-4 space-y-4">
      {/* Cabecera */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          <span className="font-semibold text-gray-900">{data.label}</span>
          {" · "}
          {new Date(data.fecha).toLocaleDateString("es-ES", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </div>
        <div className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full uppercase tracking-tight">
           {data.eventos.length} Eventos
        </div>
      </div>

      <button
        onClick={onCreatePlaning}
        className="w-full py-3.5 rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-200 flex items-center justify-center gap-2 text-sm font-bold active:scale-[0.98] transition-all"
      >
        <Plus size={18} />
        Asignar nuevo Planing
      </button>

      {/* Lista de eventos */}
      {data.eventos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 opacity-20">
          <Calendar size={64} strokeWidth={1} />
          <p className="text-sm font-medium mt-2">No hay actividad</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {data.eventos.map((ev) => {
            const col = colorForEvento(ev);
            const rightLabel =
              ev.tipo === "ausencia" && ev.estado
                ? ev.estado
                : ev.tipo === "jornada_real" && ev.estado
                  ? ev.estado
                  : tipoLabel(ev.tipo);

            return (
              <li
                key={String(ev.id)}
                onClick={() => onSelectEvent(ev)}
                className="group border border-gray-100 rounded-2xl p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 active:scale-[0.98] transition-all bg-white shadow-sm"
              >
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-3 h-3 rounded-full shrink-0 ring-2 ring-white shadow-md"
                      style={{ backgroundColor: col }}
                    />
                    <div className="flex flex-col">
                      <span className="font-bold text-gray-900 truncate text-[14px]">
                        {ev.title}
                      </span>
                      {/* NEW: Mostrar cliente si es un bloque con asignación específica */}
                      {ev.tipo === "jornada_plan" && ev.meta?.bloques?.[0]?.cliente_nombre && (
                        <span className="text-[10px] font-semibold text-indigo-600 truncate">
                          ➜ {ev.meta.bloques[0].cliente_nombre}
                          {ev.meta.bloques.length > 1 && new Set(ev.meta.bloques.map((b: any) => b.cliente_nombre)).size > 1 ? " y otros" : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                    {ev.empleado_nombre && (
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-lg">
                         <UserCheck size={10} />
                         {ev.empleado_nombre}
                      </div>
                    )}
                    <div className="text-[11px] text-gray-400 font-medium">
                      {String(ev.start).includes("T") ? String(ev.start).split("T")[1].slice(0, 5) : "Todo el día"}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <span className={`text-[9px] font-black px-2 py-0.5 rounded-lg uppercase tracking-widest ${
                    ev.tipo === 'ausencia' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {rightLabel}
                  </span>
                  <ChevronRight size={16} className="text-gray-300 group-hover:text-indigo-400 transition-colors" />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <button
        onClick={onClose}
        className="w-full py-4 rounded-xl border border-gray-100 text-gray-400 text-sm font-bold hover:bg-gray-50 transition-colors"
      >
        Cerrar agenda
      </button>
    </div>
  );
}

import { Plus } from "lucide-react";
import type { CalendarioIntegradoEvento as CalendarioIntegratedEvento } from "@/types/calendario";
