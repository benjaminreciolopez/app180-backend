"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";

type Props = {
  jornadaId: string;
  onClose: () => void;
};

export default function DrawerDetalleJornadaAdmin({
  jornadaId,
  onClose,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  async function load() {
    try {
      const res = await api.get(`/admin/jornadas/${jornadaId}`);
      setData(res.data);
    } catch (e) {
      console.error("Error cargando jornada", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (jornadaId) load();
  }, [jornadaId]);
  setLoading(true);
  setData(null);

  if (loading) {
    return <div className="p-4 text-sm text-gray-500">Cargando jornada…</div>;
  }

  if (!data) {
    return <div className="p-4 text-sm text-red-500">No se pudo cargar</div>;
  }

  const { jornada, empleado, turno, fichajes, plan, resumen, avisos } = data;

  return (
    <div className="p-4 space-y-4">
      {/* Cabecera */}
      <div>
        <div className="text-lg font-semibold">
          {empleado?.nombre || "Empleado"}
        </div>
        <div className="text-sm text-gray-500">
          {new Date(jornada.fecha).toLocaleDateString()}· Estado:{" "}
          {jornada.estado}
        </div>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-3 gap-3">
        <Metric
          label="Trabajado"
          value={`${jornada.minutos_trabajados ?? 0} min`}
        />
        <Metric
          label="Descanso"
          value={`${jornada.minutos_descanso ?? 0} min`}
        />
        <Metric label="Extra" value={`${jornada.minutos_extra ?? 0} min`} />
      </div>

      {/* Avisos */}
      {avisos?.length > 0 && (
        <div className="space-y-2">
          <div className="font-semibold text-sm">Avisos</div>
          {avisos.map((a: any, i: number) => (
            <div
              key={i}
              className={`text-sm rounded-lg px-3 py-2 ${
                a.nivel === "danger"
                  ? "bg-red-100 text-red-700"
                  : a.nivel === "warning"
                    ? "bg-yellow-100 text-yellow-700"
                    : "bg-gray-100 text-gray-600"
              }`}
            >
              {a.mensaje}
            </div>
          ))}
        </div>
      )}

      {/* Fichajes */}
      <div>
        <div className="font-semibold text-sm mb-2">Fichajes</div>
        <div className="space-y-1 text-sm">
          {fichajes.map((f: any) => (
            <div key={f.id} className="flex justify-between border-b py-1">
              <span>{f.tipo}</span>
              <span>{new Date(f.fecha).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Plan esperado */}
      {plan?.plantilla_id && (
        <div>
          <div className="font-semibold text-sm mb-2">Plan esperado</div>
          <div className="text-sm text-gray-600">Modo: {plan.modo}</div>
          {plan.rango && (
            <div className="text-sm">
              Rango: {plan.rango.inicio} - {plan.rango.fin}
            </div>
          )}
        </div>
      )}

      <div className="pt-2">
        <button
          onClick={onClose}
          className="w-full py-2 rounded-xl bg-black text-white text-sm font-semibold"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-xl p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
