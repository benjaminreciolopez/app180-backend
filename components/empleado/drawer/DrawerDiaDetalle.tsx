"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import type { CalendarioEvento } from "../calendarioTypes";
import { colorFor } from "../calendarioColors";

type DiaDetalleResponse = {
  fecha: string;
  laborable: boolean;
  label: string;
  descripcion?: string | null;
  eventos: CalendarioEvento[];
};

export default function DrawerDiaDetalle({
  ymd,
  onSelectEvent,
}: {
  ymd: string;
  onSelectEvent: (ev: CalendarioEvento) => void;
}) {
  const [data, setData] = useState<DiaDetalleResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await api.get<DiaDetalleResponse>(
          "/calendario/usuario/dia",
          { params: { fecha: ymd } }
        );
        setData(res.data);
      } catch (e) {
        console.error("Error cargando detalle del día", e);
        setData(null);
      } finally {
        setLoading(false);
      }
    }

    if (ymd) load();
  }, [ymd]);

  if (loading) {
    return <div className="p-4 text-sm text-gray-500">Cargando…</div>;
  }

  if (!data) {
    return (
      <div className="p-4 text-sm text-gray-500">No se pudo cargar el día.</div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {/* Cabecera */}
      <div className="text-sm text-gray-500">
        <span className="font-medium text-gray-700">{data.label}</span>
        {" · "}
        {new Date(data.fecha).toLocaleDateString("es-ES", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </div>

      {data.descripcion && (
        <div className="text-xs text-gray-500">{data.descripcion}</div>
      )}

      {/* Eventos */}
      {data.eventos.length === 0 ? (
        <div className="text-sm text-gray-500">
          No hay eventos para este día.
        </div>
      ) : (
        <ul className="space-y-2">
          {data.eventos.map((ev) => {
            const col = colorFor(ev.tipo, ev.estado);
            return (
              <li
                key={ev.id}
                onClick={() => onSelectEvent(ev)}
                className="border rounded p-3 flex items-center justify-between cursor-pointer active:bg-black/[0.04]"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: col }}
                  />
                  <span className="font-medium">{ev.title}</span>
                </div>

                {ev.estado && (
                  <span className="text-xs text-gray-500">{ev.estado}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
