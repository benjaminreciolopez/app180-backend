"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import { showSuccess, showError } from "@/lib/toast";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

type EmpleadoLite = { id: string; nombre: string };
type Plantilla = { id: string; nombre: string };
type Asignacion = {
  id: string;
  plantilla_id: string;
  plantilla_nombre: string;
  cliente_id?: string; // Legacy
  fecha_inicio: string;
  fecha_fin: string | null;
  activo: boolean;
};

export default function PlantillasAsignacionPanel() {
  const [empleados, setEmpleados] = useState<EmpleadoLite[]>([]);
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  
  const [loading, setLoading] = useState(true);

  // Seleccion
  const [empleadoSel, setEmpleadoSel] = useState<string>("");
  const [hist, setHist] = useState<Asignacion[]>([]);

  // Form
  const [plantillaSel, setPlantillaSel] = useState<string>("");
  const [fechaInicio, setFechaInicio] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [fechaFin, setFechaFin] = useState<string>("");
  const [asignando, setAsignando] = useState(false);
  const [reseteando, setReseteando] = useState(false);
  const [renovando, setRenovando] = useState<string | null>(null);

  async function loadBase() {
    setLoading(true);
    try {
      const [e, p] = await Promise.all([
        api.get("/employees"),
        api.get("/admin/plantillas"),
      ]);
      setEmpleados(
        (e.data || []).map((x: any) => ({ id: x.id, nombre: x.nombre })),
      );
      setPlantillas(Array.isArray(p.data) ? p.data : []);
    } catch (e) {
      console.error(e);
      showError("Error cargando base de plantillas/empleados");
    } finally {
      setLoading(false);
    }
  }

  async function loadHist(empleado_id: string) {
    if (!empleado_id) {
      setHist([]);
      return;
    }
    try {
      const r = await api.get(`/admin/jornadas/asignar/${empleado_id}`);
      const data = Array.isArray(r.data) ? r.data : [];
      // Calcular "activo" en cliente
      const now = new Date();
      now.setHours(0,0,0,0);
      const withActive = data.map((x: any) => {
         const fFin = x.fecha_fin ? new Date(x.fecha_fin) : null;
         const isActive = !fFin || fFin >= now;
         return { ...x, activo: isActive };
      });
      setHist(withActive);
    } catch(e) {
      console.error(e);
    }
  }

  useEffect(() => {
    loadBase();
  }, []);

  useEffect(() => {
    if (empleadoSel) loadHist(empleadoSel);
    else setHist([]);
  }, [empleadoSel]);

  async function asignar() {
    if (!plantillaSel || !fechaInicio) {
      showError("Plantilla y fecha inicio son obligatorios");
      return;
    }
    // NOTA: Ya no mandamos cliente_id
    try {
      setAsignando(true);
      await api.post("/admin/plantillas/asignar", {
        empleado_id: empleadoSel,
        plantilla_id: plantillaSel,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin || null,
      });
      await loadHist(empleadoSel);
      showSuccess('Horario asignado correctamente');
    } catch (e: any) {
      console.error(e);
      showError(e.response?.data?.error || 'Error al asignar horario');
    } finally {
      setAsignando(false);
    }
  }

  async function resetear() {
    if (!empleadoSel) {
      showError("Selecciona un empleado primero");
      return;
    }

    const ok = confirm("¿Seguro que quieres quitar el horario actual de este empleado?");
    if (!ok) return;

    try {
      setReseteando(true);
      await api.post("/admin/plantillas/desasignar", {
        empleado_id: empleadoSel,
      });
      await loadHist(empleadoSel);
      showSuccess('Horario eliminado correctamente');
    } catch (e: any) {
      console.error(e);
      showError(e.response?.data?.error || 'Error al eliminar horario');
    } finally {
      setReseteando(false);
    }
  }

  async function renovar(id: string) {
    const meses = window.prompt("¿Cuántos meses quieres ampliar?", "1");
    if (!meses || isNaN(parseInt(meses))) return;

    try {
      setRenovando(id);
      await api.post("/jornadas/asignar/renovar", {
        asignacion_id: id,
        meses: parseInt(meses),
      });
      await loadHist(empleadoSel);
      showSuccess("Planing renovado");
    } catch (e: any) {
      showError(e.response?.data?.error || "Error al renovar");
    } finally {
      setRenovando(null);
    }
  }

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="space-y-6">
      <div className="bg-white border rounded p-4 space-y-4 shadow-sm">
        <h2 className="text-lg font-bold border-b pb-2">Asignar Horario (Plantilla)</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-semibold mb-1">Empleado</label>
              <select
                className="border p-2 rounded w-full bg-gray-50"
                value={empleadoSel}
                onChange={(e) => setEmpleadoSel(e.target.value)}
              >
                <option value="">(Para el Administrador)</option>
                {empleados.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">Plantilla de Horario</label>
              <select
                className="border p-2 rounded w-full"
                value={plantillaSel}
                onChange={(e) => setPlantillaSel(e.target.value)}
              >
                <option value="">-- Selecciona plantilla --</option>
                {plantillas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm font-semibold mb-1">Inicio</label>
                <input
                  className="border p-2 rounded w-full"
                  type="date"
                  value={fechaInicio}
                  onChange={(e) => setFechaInicio(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Fin (Opcional)</label>
                <input
                  className="border p-2 rounded w-full"
                  type="date"
                  value={fechaFin}
                  onChange={(e) => setFechaFin(e.target.value)}
                />
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              <button
                className="px-4 py-2 rounded bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={asignar}
                disabled={asignando || reseteando}
              >
                {asignando ? 'Asignando...' : 'Asignar Horario'}
              </button>
              <button
                className="px-4 py-2 rounded bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={resetear}
                disabled={!empleadoSel || asignando || reseteando}
              >
                {reseteando ? 'Eliminando...' : 'Quitar Horario'}
              </button>
            </div>
          </div>
          
          <div className="bg-gray-50 rounded p-3 border">
            <h3 className="font-bold text-sm mb-2 text-gray-700">Historial de Horarios</h3>
             {!empleadoSel ? (
               <div className="text-blue-600 text-sm italic font-medium">Asignaciones para el Administrador</div>
            ) : hist.length === 0 ? (
               <div className="text-gray-500 text-sm">Sin historial de horarios.</div>
            ) : (
                <div className="overflow-x-auto max-h-[300px]">
                <table className="w-full text-sm">
                  <thead className="text-left text-gray-600 sticky top-0 bg-gray-50">
                    <tr>
                      <th className="pb-2">Plantilla</th>
                      <th className="pb-2">Inicio</th>
                      <th className="pb-2">Fin</th>
                      <th className="pb-2 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {hist.map((h) => (
                      <tr key={h.id}>
                        <td className="py-2 pr-2 font-medium">{h.plantilla_nombre}</td>
                        <td className="py-2 pr-2 whitespace-nowrap">{h.fecha_inicio}</td>
                        <td className="py-2 pr-2 whitespace-nowrap">{h.fecha_fin || "-"}</td>
                        <td className="py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                             {h.activo ? (
                              <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded-full text-xs">Activo</span>
                            ) : (
                              <span className="text-gray-500 text-xs">Inactivo</span>
                            )}
                            <button
                              disabled={renovando !== null}
                              className="text-xs text-indigo-600 font-semibold hover:underline"
                              onClick={() => renovar(h.id)}
                            >
                              {renovando === h.id ? "..." : "Renovar"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
