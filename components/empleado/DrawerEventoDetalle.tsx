"use client";

import type { CalendarioEvento } from "./calendarioTypes";
import { colorFor } from "./calendarioColors";
import AusenciaAdjuntosPanel from "@/components/ausencias/AusenciaAdjuntosPanel";

function fmt(d: string) {
  if (!d) return "";
  const date = new Date(d);
  return isNaN(date.getTime())
    ? d
    : date.toLocaleDateString("es-ES", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
}

export default function DrawerEventoDetalle({
  event,
}: {
  event: CalendarioEvento;
}) {
  const col = colorFor(event.tipo);

  // Solo ausencias (vacaciones/baja_medica) tienen adjuntos
  const esAusencia =
    event.tipo === "vacaciones" || event.tipo === "baja_medica";
  const ausenciaId = (event.id || "").startsWith("aus-")
    ? (event.id || "").replace("aus-", "")
    : event.id;

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-2xl border border-black/5 p-4 bg-white">
        <div className="flex items-start gap-3">
          <span
            className="w-3 h-3 rounded-full mt-1"
            style={{ backgroundColor: col }}
          />
          <div className="flex-1">
            <div className="text-[15px] font-semibold text-gray-900">
              {event.title}
            </div>
            <div className="text-[13px] text-gray-500 mt-1">
              Tipo: <span className="font-medium">{event.tipo}</span>
              {event.subtipo ? (
                <>
                  {" "}
                  · Subtipo:{" "}
                  <span className="font-medium">{event.subtipo}</span>
                </>
              ) : null}
            </div>

            <div className="text-[13px] text-gray-700 mt-3 space-y-1">
              <div>
                <span className="text-gray-500">Inicio:</span>{" "}
                <span className="font-medium">{fmt(event.start)}</span>
              </div>
              {event.end ? (
                <div>
                  <span className="text-gray-500">Fin:</span>{" "}
                  <span className="font-medium">{fmt(event.end)}</span>
                </div>
              ) : null}
              {event.estado ? (
                <div>
                  <span className="text-gray-500">Estado:</span>{" "}
                  <span className="font-medium">{event.estado}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {esAusencia && ausenciaId ? (
        <AusenciaAdjuntosPanel
          ausenciaId={ausenciaId}
          canDelete={false} // empleado NO borra
          title={
            event.tipo === "baja_medica"
              ? "Partes/justificantes"
              : "Documentos (opcional)"
          }
        />
      ) : null}

      <div className="text-xs text-gray-500">
        Nota: los rangos “todo el día” en calendario suelen venir con el fin
        ajustado (+1 día) para que FullCalendar pinte el último día incluido.
      </div>
    </div>
  );
}
