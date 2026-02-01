// src/components/empleado/drawer/DrawerMisSolicitudes.tsx
"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";

const API_ENDPOINTS = {
  mis: "/empleado/ausencias/mis", // <-- cambia si tu ruta es distinta
};

type Ausencia = {
  id: string;
  tipo: "vacaciones" | "baja_medica" | string;
  fecha_inicio: string;
  fecha_fin: string;
  estado: "pendiente" | "aprobado" | "rechazado" | string;
  comentario_empleado?: string | null;
  motivo?: string | null;
};

function pillClass(estado: string) {
  switch (estado) {
    case "aprobado":
      return "bg-green-100 text-green-700";
    case "rechazado":
      return "bg-red-100 text-red-700";
    default:
      return "bg-yellow-100 text-yellow-700";
  }
}

export default function DrawerMisSolicitudes({
  onSelectAusencia,
}: {
  onSelectAusencia?: (a: Ausencia) => void;
}) {
  const [items, setItems] = useState<Ausencia[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get(API_ENDPOINTS.mis);
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      console.error("Error mis solicitudes", e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    async function safeLoad() {
      if (document.hidden) return;
      await load();
    }

    // inicial
    safeLoad();

    const onFocus = () => safeLoad();
    const onVisibility = () => safeLoad();
    const onOnline = () => safeLoad();

    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);

    // polling SOLO si está visible
    interval = setInterval(() => {
      if (!document.hidden) {
        load();
      }
    }, 60000); // ⬅️ subimos a 60s

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);

      if (interval) clearInterval(interval);
    };
  }, []);

  return (
    <div className="p-4 space-y-3">
      <div className="rounded-2xl border border-black/5 bg-white">
        {loading ? (
          <div className="p-4 text-sm text-gray-500">Cargando…</div>
        ) : items.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">
            No tienes solicitudes todavía.
          </div>
        ) : (
          <ul>
            {items.map((a, idx) => (
              <li key={a.id}>
                <button
                  className="w-full text-left p-4 active:bg-black/[0.04]"
                  onClick={() => onSelectAusencia?.(a)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[15px] font-semibold text-gray-900">
                        {a.tipo === "baja_medica"
                          ? "Baja médica"
                          : "Vacaciones"}
                      </div>
                      <div className="text-[13px] text-gray-500 mt-1">
                        {a.fecha_inicio} → {a.fecha_fin}
                      </div>
                      {a.comentario_empleado ? (
                        <div className="text-[13px] text-gray-700 mt-2 line-clamp-2">
                          {a.comentario_empleado}
                        </div>
                      ) : null}
                    </div>

                    <span
                      className={[
                        "px-2.5 py-1 rounded-full text-xs font-semibold",
                        pillClass(a.estado),
                      ].join(" ")}
                    >
                      {a.estado}
                    </span>
                  </div>
                </button>

                {idx !== items.length - 1 ? (
                  <div className="h-px bg-black/5 mx-4" />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        onClick={load}
        className="w-full py-3 rounded-xl border border-black/10 bg-white text-sm font-semibold active:bg-black/[0.04]"
      >
        Recargar
      </button>
    </div>
  );
}
