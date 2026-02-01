//app180-frontend\components\admin\drawer\DrawerCrearAusenciaAdmin.tsx

"use client";

import { useMemo, useState } from "react";
import { api } from "@/services/api";

type Empleado = { id: string; nombre: string };

function ymd(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function DrawerCrearAusenciaAdmin({
  empleados,
  empleadoDefaultId,
  onClose,
  onCreated,
}: {
  empleados: Empleado[];
  empleadoDefaultId?: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const defaultEmp = useMemo(() => {
    if (empleadoDefaultId) return empleadoDefaultId;
    return empleados[0]?.id || "";
  }, [empleados, empleadoDefaultId]);

  const [empleadoId, setEmpleadoId] = useState(defaultEmp);
  const [tipo, setTipo] = useState<"vacaciones" | "baja_medica">("vacaciones");
  const [fechaInicio, setFechaInicio] = useState(ymd());
  const [fechaFin, setFechaFin] = useState(ymd());
  const [comentarioAdmin, setComentarioAdmin] = useState("");
  const [saving, setSaving] = useState(false);

  async function crear() {
    if (!empleadoId) return alert("Selecciona un empleado");
    if (!fechaInicio || !fechaFin) return alert("Fechas obligatorias");
    if (fechaInicio > fechaFin)
      return alert("La fecha de inicio no puede ser mayor que la de fin");

    setSaving(true);
    try {
      const res = await api.post("/admin/ausencias", {
        empleado_id: empleadoId,
        tipo,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        comentario_admin: comentarioAdmin || null,
      });
      if (res.data?.warning_festivos) {
        alert("Aviso: el rango incluye días no laborables/festivos.");
      }
      alert("Ausencia creada (aprobada)");
      onCreated();
      onClose();
    } catch (e: any) {
      console.error(e);
      alert(e?.response?.data?.error || "Error creando ausencia");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-2xl border border-black/10 bg-white p-4 space-y-3 shadow-sm">
        <div className="text-[15px] font-semibold text-gray-900">
          Crear ausencia (aprobada)
        </div>
        <div className="text-xs text-gray-500">
          Se registrará directamente como aprobada
        </div>

        <div className="grid grid-cols-1 gap-3">
          <label className="text-[13px] font-medium text-gray-600">
            Empleado
            <select
              className="mt-1 w-full border rounded-xl px-3 py-2 bg-white"
              value={empleadoId}
              onChange={(e) => setEmpleadoId(e.target.value)}
            >
              {empleados.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[13px] font-medium text-gray-600">
            Tipo
            <select
              className="mt-1 w-full border rounded-xl px-3 py-2 bg-white"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as any)}
            >
              <option value="vacaciones">Vacaciones</option>
              <option value="baja_medica">Baja médica</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-[13px] font-medium text-gray-600">
              Inicio
              <input
                type="date"
                className="mt-1 w-full border rounded-xl px-3 py-2"
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
              />
            </label>

            <label className="text-[13px] font-medium text-gray-600">
              Fin
              <input
                type="date"
                min={fechaInicio}
                className="mt-1 w-full border rounded-xl px-3 py-2"
                value={fechaFin}
                onChange={(e) => setFechaFin(e.target.value)}
              />
            </label>
          </div>

          <label className="text-[13px] font-medium text-gray-600">
            Comentario del admin (opcional)
            <textarea
              className="mt-1 w-full border rounded-xl px-3 py-2"
              rows={3}
              value={comentarioAdmin}
              onChange={(e) => setComentarioAdmin(e.target.value)}
              placeholder="Ej: ajuste por festivo, solicitud verbal, etc."
            />
          </label>
        </div>
      </div>

      <button
        disabled={saving}
        onClick={crear}
        className="w-full py-3 rounded-2xl bg-black text-white font-semibold disabled:opacity-60"
      >
        {saving ? "Creando…" : "Crear ausencia"}
      </button>

      <button
        onClick={onClose}
        className="w-full py-3 rounded-2xl border border-black/10 bg-white text-sm font-semibold active:bg-black/[0.04]"
      >
        Cancelar
      </button>
    </div>
  );
}
