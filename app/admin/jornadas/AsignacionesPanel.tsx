"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import type { Asignacion, EmpleadoLite, Plantilla } from "./types";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

export default function AsignacionesPanel() {
  const [empleados, setEmpleados] = useState<EmpleadoLite[]>([]);
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [empleadoSel, setEmpleadoSel] = useState<string>("");
  const [plantillaSel, setPlantillaSel] = useState<string>("");
  const [fechaInicio, setFechaInicio] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [fechaFin, setFechaFin] = useState<string>("");

  const [hist, setHist] = useState<Asignacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientes, setClientes] = useState<
    { id: string; nombre: string; codigo?: string }[]
  >([]);

  const [clienteSel, setClienteSel] = useState<string>("");

  async function loadBase() {
    setLoading(true);
    try {
      const [e, p, c] = await Promise.all([
        api.get("/employees"),
        api.get("/admin/plantillas"),
        api.get("/admin/clientes"),
      ]);
      setEmpleados(
        (e.data || []).map((x: any) => ({ id: x.id, nombre: x.nombre })),
      );
      setPlantillas(Array.isArray(p.data) ? p.data : []);
      setClientes(
        (c.data || []).map((x: any) => ({
          id: x.id,
          nombre: x.nombre,
          codigo: x.codigo,
        })),
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadHist(empleado_id: string) {
    if (!empleado_id) {
      setHist([]);
      return;
    }
    const r = await api.get(`/admin/plantillas/asignaciones/${empleado_id}`);
    setHist(Array.isArray(r.data) ? r.data : []);
  }

  useEffect(() => {
    loadBase();
  }, []);

  useEffect(() => {
    if (empleadoSel) loadHist(empleadoSel);
  }, [empleadoSel]);

  async function asignar() {
    if (!empleadoSel || !plantillaSel || !clienteSel || !fechaInicio) {
      alert("Empleado, plantilla, cliente y fecha_inicio son obligatorios");
      return;
    }
    await api.post("/admin/plantillas/asignar", {
      empleado_id: empleadoSel,
      plantilla_id: plantillaSel,
      cliente_id: clienteSel,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin || null,
    });
    await loadHist(empleadoSel);
    alert("Asignación creada");
  }

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="space-y-4">
      <div className="bg-white border rounded p-4 space-y-3">
        <h2 className="text-lg font-bold">Asignar plantilla a empleado</h2>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="text-sm font-semibold">Empleado</label>
            <select
              className="border p-2 rounded w-full"
              value={empleadoSel}
              onChange={(e) => setEmpleadoSel(e.target.value)}
            >
              <option value="">Selecciona...</option>
              {empleados.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-semibold">Plantilla</label>
            <select
              className="border p-2 rounded w-full"
              value={plantillaSel}
              onChange={(e) => setPlantillaSel(e.target.value)}
            >
              <option value="">Selecciona...</option>
              {plantillas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-semibold">Cliente</label>

            <select
              className="border p-2 rounded w-full"
              value={clienteSel}
              onChange={(e) => setClienteSel(e.target.value)}
            >
              <option value="">Selecciona...</option>

              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codigo ? `${c.codigo} · ` : ""}
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-semibold">Inicio</label>
            <input
              className="border p-2 rounded w-full"
              type="date"
              value={fechaInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-semibold">Fin (opcional)</label>
            <input
              className="border p-2 rounded w-full"
              type="date"
              value={fechaFin}
              onChange={(e) => setFechaFin(e.target.value)}
            />
          </div>
        </div>

        <button
          className="px-4 py-2 rounded bg-blue-600 text-white"
          onClick={asignar}
        >
          Asignar
        </button>

        <div className="text-xs text-gray-600">
          Regla: 1 plantilla activa por fecha. (Si solapas rangos, lo
          corregiremos en backend con validación.)
        </div>
      </div>

      <div className="bg-white border rounded p-4">
        <h3 className="font-bold mb-3">Historial asignaciones</h3>
        {!empleadoSel ? (
          <div className="text-gray-600 text-sm">
            Selecciona un empleado para ver su historial.
          </div>
        ) : hist.length === 0 ? (
          <div className="text-gray-600 text-sm">Sin asignaciones.</div>
        ) : (
          <table className="w-full border rounded overflow-hidden">
            <thead>
              <tr className="bg-gray-100">
                <th className="p-3 text-left">Cliente</th>
                <th className="p-3 text-left">Plantilla</th>
                <th className="p-3 text-left">Inicio</th>
                <th className="p-3 text-left">Fin</th>
                <th className="p-3 text-left">Activo</th>
              </tr>
            </thead>
            <tbody>
              {hist.map((h) => (
                <tr key={h.id} className="border-b">
                  <td className="p-3">
                    {h.cliente_nombre || h.cliente_id || "-"}
                  </td>

                  <td className="p-3">
                    {h.plantilla_nombre || h.plantilla_id}
                  </td>
                  <td className="p-3">{h.fecha_inicio}</td>
                  <td className="p-3">{h.fecha_fin || "-"}</td>
                  <td className="p-3">{String(h.activo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
