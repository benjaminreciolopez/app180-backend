"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import esLocale from "@fullcalendar/core/locales/es";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, LogOut, Info, X } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";

import { api } from "@/services/api";
import type { CalendarioEvento } from "./calendarioTypes";
import { colorFor } from "./calendarioColors";
import CalendarioLegend from "./CalendarioLegend";

type ViewMode = "dayGridMonth" | "timeGridWeek" | "listWeek" | "listMonth";

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDaysISO(isoDate: string, days: number) {
  // isoDate: YYYY-MM-DD
  const [y, m, dd] = isoDate.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(y, (m || 1) - 1, dd || 1);
  dt.setDate(dt.getDate() + days);
  return toISODate(dt);
}

function titleForTipo(tipo?: string) {
  const t = String(tipo || "").toLowerCase();

  if (t === "vacaciones") return "Vacaciones";
  if (t === "baja_medica") return "Baja médica";

  if (t === "festivo_local") return "Festivo local";
  if (t === "festivo_nacional") return "Festivo nacional";
  if (t === "festivo_empresa") return "Festivo de empresa";

  if (t === "convenio") return "Ajuste de convenio";
  if (t === "cierre_empresa") return "Cierre de empresa";
  if (t === "no_laborable") return "No laborable";

  if (t === "jornada_real") return "Jornada (real)";
  if (t === "jornada_plan") return "Jornada (plan)";

  // fallback
  return t ? t.replaceAll("_", " ") : "Evento";
}

const GOOGLE_CAL_CSS = `
  .fc-theme-standard td, .fc-theme-standard th {
    border: 1px solid #e5e7eb !important;
  }
  .fc .fc-daygrid-day-top {
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding-top: 4px;
  }
  .fc .fc-daygrid-day-number {
    padding: 0 !important;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 500;
    margin-bottom: 2px;
    color: #3c4043;
    text-decoration: none !important;
  }
  .fc-day-today {
    background-color: transparent !important;
  }
  .fc-day-today .fc-daygrid-day-number {
    background-color: #1a73e8;
    color: white !important;
    border-radius: 50%;
  }
  .fc-col-header-cell {
    padding: 8px 0 !important;
    background: white;
    font-weight: 500 !important;
    text-transform: uppercase;
    font-size: 11px;
    color: #70757a;
    border-bottom: 1px solid #e5e7eb !important;
  }
  .fc .fc-daygrid-event-harness {
    margin-top: 1px !important;
  }
`;

export default function DrawerCalendario({
  onSelectDay,
}: {
  onSelectDay: (ymd: string) => void;
}) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const lastRangeRef = useRef<{ desde: string; hasta: string } | null>(null);

  const [events, setEvents] = useState<CalendarioEvento[]>([]);
  const [loading, setLoading] = useState(false);
  const isMobile = useIsMobile();
  const [view, setView] = useState<ViewMode>(isMobile ? "listMonth" : "dayGridMonth"); // Default adaptable
  const [showLegend, setShowLegend] = useState(false);

  // Force view change on mobile detect
  // No forcing view change loop

  const [title, setTitle] = useState("");

  function apiCalendar() {
    return calendarRef.current?.getApi();
  }

  function syncTitle() {
    const api = apiCalendar();
    if (!api) return;
    const t = api.view.title || "";
    setTitle(t ? t.charAt(0).toUpperCase() + t.slice(1) : "");
  }

  async function load(desde: string, hasta: string) {
    const last = lastRangeRef.current;
    if (last && last.desde === desde && last.hasta === hasta) return;
    lastRangeRef.current = { desde, hasta };

    setLoading(true);
    try {
      // ÚNICO endpoint del calendario del empleado (integrado)
      const params = new URLSearchParams({ desde, hasta });
      const res = await api.get(
        `/empleado/calendario/integrado?${params.toString()}`,
      );
      setEvents(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      console.error("Error calendario integrado", e);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  const fcEvents = useMemo(() => {
    return (events || []).map((e) => {
      const tipo = String(e.tipo || "").toLowerCase();
      const col = colorFor(tipo, e.estado);

      // FullCalendar: eventos allDay deben tener end (exclusive) para render fiable
      const allDay = Boolean(e.allDay);
      const start = String(e.start);
      let end = e.end ? String(e.end) : undefined;

      if (allDay) {
        // Si viene solo start (un día), end debe ser el día siguiente (exclusive)
        // Si viene end y es inclusive (mismo día), igual forzamos +1 si coincide con start
        if (!end) {
          end = addDaysISO(start.slice(0, 10), 1);
        } else {
          const s = start.slice(0, 10);
          const z = end.slice(0, 10);
          if (z === s) end = addDaysISO(s, 1);
        }
      }

      const isBackground = e.meta?.display === "background";

      const computedTitle = e.title || titleForTipo(tipo);

      return {
        id: String(e.id),
        title: computedTitle,
        start,
        end,
        allDay,
        backgroundColor: col,
        borderColor: col,
        textColor: "#f79c9cff",
        display: isBackground ? "background" : "block",
        extendedProps: { ...e },
      };
    });
  }, [events]);

  useEffect(() => {
    const api = apiCalendar();
    if (!api) return;
    api.changeView(view);
  }, [view]);

  useEffect(() => {
    const api = apiCalendar();
    if (!api) return;
    syncTitle();
  }, []);

  return (
    <div className={`flex flex-col ${isMobile ? 'h-auto min-h-0' : 'fullscreen-page'}`}>
      <style>{GOOGLE_CAL_CSS}</style>
      
      {/* Controls & Legend */}
      <div className="p-3 space-y-3 shrink-0">
        {!isMobile && <CalendarioLegend />}

        <div className="bg-white border border-black/5 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-3 h-12 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button onClick={() => apiCalendar()?.prev()} className="p-2 hover:bg-gray-100 rounded-full" type="button">
                <ChevronLeft size={20} className="text-gray-600" />
              </button>
              <div className="font-bold text-lg text-gray-800 px-2">{title}</div>
              <button onClick={() => apiCalendar()?.next()} className="p-2 hover:bg-gray-100 rounded-full" type="button">
                <ChevronRight size={20} className="text-gray-600" />
              </button>
              <button onClick={() => apiCalendar()?.today()} className="ml-1 px-3 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-colors hidden sm:block" type="button">
                Hoy
              </button>
            </div>

            <div className="flex bg-gray-100 p-0.5 rounded-lg mr-2">
              <button
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                   view === "dayGridMonth" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
                onClick={() => setView("dayGridMonth")}
                type="button"
              >
                Mes
              </button>
              <button
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                   view === "listMonth" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
                onClick={() => setView("listMonth")}
                type="button"
              >
                Lista
              </button>
            </div>

            <button
               onClick={() => setShowLegend(true)}
               className="p-2 ml-1 text-gray-500 hover:bg-gray-100 rounded-full"
               title="Ver Leyenda"
            >
               <Info size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* Calendar Area */}
      <div className={`relative ${isMobile ? 'flex-1' : 'fullscreen-content'}`}>
        {loading && (
          <div className="absolute inset-0 grid place-items-center bg-white/70 z-10 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2">
                 <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                 <span className="text-xs font-medium text-gray-500">Cargando...</span>
            </div>
          </div>
        )}

        {/* Height wrapper to fix scroll issues: Mobile uses auto to let drawer scroll, Desktop uses 100% */}
        <div className={isMobile ? "" : "h-full"}>
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
              locale={esLocale}
              initialView={view}
              headerToolbar={false}
              events={fcEvents}
              height={isMobile ? "auto" : "100%"}
              contentHeight={isMobile ? "auto" : "100%"}
              expandRows={!isMobile}
              handleWindowResize
              datesSet={(arg) => {
                syncTitle();
                load(arg.startStr.slice(0, 10), arg.endStr.slice(0, 10));
              }}
              dateClick={(arg) => onSelectDay(arg.dateStr.slice(0, 10))}
              eventClick={(arg) => onSelectDay(arg.event.startStr.slice(0, 10))}
              dayCellClassNames={(arg) => {
                const isSunday = arg.date.getDay() === 0;
                return isSunday ? ["fc-sunday"] : [];
              }}
              eventContent={(arg) => {
                 // Estilo estilo "Google Calendar" mejorado
                 if (view === 'listMonth' || view === 'listWeek') return null; // Default list render

                 const props = arg.event.extendedProps;
                 const meta = props.meta || {};
                 let clienteLabel = "";
                 
                 if (meta.es_asignacion && meta.cliente_nombre) {
                    clienteLabel = meta.cliente_nombre;
                 } else if (props.tipo === "jornada_plan" && meta.bloques?.length) {
                    const c = meta.bloques[0].cliente_nombre;
                    if (c) clienteLabel = c;
                    if (meta.bloques.length > 1) {
                       const unique = new Set(meta.bloques.map((b:any) => b.cliente_nombre));
                       if (unique.size > 1) clienteLabel = "Varios";
                    }
                 }

                 return (
                   <div className="truncate px-1 py-0.5 text-[10px] font-semibold leading-tight flex flex-col gap-0.5 rounded-sm hover:brightness-95 transition-all">
                      <div className="flex items-center gap-1">
                         <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: arg.backgroundColor }} />
                         <span className="truncate text-gray-700">{arg.event.title}</span>
                      </div>
                      {clienteLabel && (
                        <div className="text-[9px] text-gray-500 pl-2.5 truncate font-normal">
                          {clienteLabel}
                        </div>
                      )}
                   </div>
                 );
              }}
              views={{
                  listWeek: { titleFormat: { day: 'numeric', month: 'short' } },
                  listMonth: { buttonText: 'Lista Mensual', titleFormat: { year: 'numeric', month: 'long' } },
                  dayGridMonth: { titleFormat: { year: 'numeric', month: 'long' } }
              }}
            />
        </div>
      </div>

      {/* Mobile Legend Modal (Simple Overlay) */}
      {showLegend && (
        <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
           <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50">
                  <h3 className="font-bold text-gray-900">Leyenda de Colores</h3>
                  <button onClick={() => setShowLegend(false)} className="p-1 hover:bg-gray-200 rounded-full">
                     <X size={20} className="text-gray-500" />
                  </button>
              </div>
              <div className="p-4 overflow-y-auto">
                 <CalendarioLegend />
              </div>
           </div>
        </div>
      )}
    </div>
  );
}
