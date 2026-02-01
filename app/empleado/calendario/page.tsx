"use client";

import { useEffect, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import { api } from "@/services/api";
import listPlugin from "@fullcalendar/list";
import { useIsMobile } from "@/hooks/useIsMobile";
import { LogOut, Calendar as CalendarIcon } from "lucide-react";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

type EventoCalendario = {
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  backgroundColor: string;
  borderColor: string;
};

const COLOR_MAP: Record<string, string> = {
  laborable: "#16a34a",
  festivo: "#dc2626",
  vacaciones: "#f59e0b",
  baja_medica: "#2563eb",
  no_laborable: "#6b7280",
  jornada_plan: "#6366f1", // Indigo para planificados
};

export default function EmpleadoCalendarioPage() {
  const [events, setEvents] = useState<EventoCalendario[]>([]);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();

  async function loadCalendario() {
    try {
      const res = await api.get("/calendario/usuario");

      const data = Array.isArray(res.data) ? res.data : [];

      const mapped: EventoCalendario[] = data.map((e: any) => {
        const color = COLOR_MAP[e.tipo] || COLOR_MAP.no_laborable;

        return {
          title:
            e.tipo === "festivo"
              ? e.label || "Festivo"
              : e.tipo === "jornada_plan"
              ? e.title || "Turno"
              : `${e.tipo.replace("_", " ")}${
                  e.estado ? ` (${e.estado})` : ""
                }`,
          start: e.start,
          end: e.end,
          allDay: !!e.allDay,
          backgroundColor: color,
          borderColor: color,
          extendedProps: { ...e },
        };
      });

      setEvents(mapped);
    } catch (err) {
      console.error("Error cargando calendario", err);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCalendario();
  }, []);

  if (loading) {
    return <LoadingSpinner fullPage />;
  }

  const MobileHeader = (
    <div className="flex items-center justify-between px-4 py-3 bg-white border-b sticky top-0 z-20 shadow-sm md:hidden">
        <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-50 rounded-lg">
                <CalendarIcon className="w-5 h-5 text-indigo-600" />
            </div>
            <span className="font-bold text-gray-900">Mi Calendario</span>
        </div>
        <button 
           onClick={() => {
             if(confirm("¿Cerrar sesión?")) {
               document.cookie = "token=; Max-Age=0; path=/;";
               localStorage.removeItem("token");
               localStorage.removeItem("user_180");
               window.location.href = "/login";
             }
           }}
           className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
           title="Cerrar sesión"
        >
           <LogOut className="w-5 h-5" />
        </button>
    </div>
  );

  return (
    <div className="h-full flex flex-col md:space-y-4 md:p-6 p-0 bg-gray-50 md:bg-transparent">
      {/* Desktop Header */}
      <div className="hidden md:block">
        <h1 className="text-2xl font-bold">Calendario laboral</h1>
        <p className="text-sm text-gray-500">
          Festivos, vacaciones y ausencias
        </p>
      </div>

      {/* Mobile Header */}
      {isMobile && MobileHeader}

      <div className="flex-1 bg-white md:border md:rounded-xl overflow-hidden flex flex-col relative shadow-sm md:shadow-none">
        <FullCalendar
          plugins={[
            dayGridPlugin,
            timeGridPlugin,
            interactionPlugin,
            listPlugin,
          ]}
          initialView={isMobile ? "listWeek" : "dayGridMonth"}
          locale="es"
          headerToolbar={isMobile ? {
            left: "prev,next",
            center: "title",
            right: "dayGridMonth,listWeek"
          } : {
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,listWeek",
          }}
          events={events}
          height="100%"
          eventDisplay="block"
          views={{
            dayGridMonth: {
              titleFormat: { year: 'numeric', month: 'short' } 
            },
            listWeek: {
              titleFormat: { day: 'numeric', month: 'short' }
            }
          }}
        />
      </div>
    </div>
  );
}
