"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import { showSuccess, showError } from "@/lib/toast";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

type EmpleadoLite = { id: string; nombre: string };
type ClienteLite = { id: string; nombre: string; codigo?: string };
type AsignacionCliente = {
  id: string;
  cliente_id: string;
  cliente_nombre: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  activo: boolean;
};

export default function ClientesAsignacionPanel() {
  const [empleados, setEmpleados] = useState<EmpleadoLite[]>([]);
  const [clientes, setClientes] = useState<ClienteLite[]>([]);
  
  const [loading, setLoading] = useState(true);
  
  // Selección
  const [empleadoSel, setEmpleadoSel] = useState<string>("");
  const [hist, setHist] = useState<AsignacionCliente[]>([]);
  
  // Formulario
  const [clienteSel, setClienteSel] = useState<string>("");
  const [fechaInicio, setFechaInicio] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [fechaFin, setFechaFin] = useState<string>("");
  const [asignando, setAsignando] = useState(false);
  const [reseteando, setReseteando] = useState(false);

  async function loadBase() {
    setLoading(true);
    try {
      const [e, c] = await Promise.all([
        api.get("/employees"),
        api.get("/admin/clientes"),
      ]);
      
      setEmpleados(
        (e.data || []).map((x: any) => ({ id: x.id, nombre: x.nombre })),
      );
      
      setClientes(
        (c.data || []).map((x: any) => ({
          id: x.id,
          nombre: x.nombre,
          codigo: x.codigo,
        })),
      );
    } catch(e) {
      console.error(e);
      showError("Error cargando datos base");
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
      const r = await api.get(`/admin/clientes/asignaciones/${empleado_id}`);
      setHist(Array.isArray(r.data) ? r.data : []);
    } catch(e) {
      console.error(e);
      showError("Error cargando historial");
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
    if (!empleadoSel || !clienteSel || !fechaInicio) {
      showError("Empleado, cliente y fecha inicio son obligatorios");
      return;
    }
    try {
      setAsignando(true);
      await api.post("/admin/clientes/asignar", {
        empleado_id: empleadoSel,
        cliente_id: clienteSel,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin || null,
      });
      
      await loadHist(empleadoSel);
      showSuccess('Cliente asignado correctamente');
      
      // Reset form parcial?
      // setClienteSel(""); 
    } catch (e: any) {
      console.error(e);
      showError(e.response?.data?.error || 'Error al asignar cliente');
    } finally {
      setAsignando(false);
    }
  }

  async function resetear() {
    if (!empleadoSel) {
      showError("Selecciona un empleado primero");
      return;
    }

    const ok = confirm("¿Seguro que quieres quitar el cliente actual de este empleado?");
    if (!ok) return;

    try {
      setReseteando(true);
      await api.post("/admin/clientes/desasignar", {
        empleado_id: empleadoSel,
      });
      await loadHist(empleadoSel);
      showSuccess('Cliente eliminado correctamente');
    } catch (e: any) {
      console.error(e);
      showError(e.response?.data?.error || 'Error al eliminar cliente');
    } finally {
      setReseteando(false);
    }
  }

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="space-y-6">
      <div className="bg-white border rounded p-4 space-y-4 shadow-sm">
        <h2 className="text-lg font-bold border-b pb-2">Asignar Cliente a Empleado</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Columna Izquierda: Formulario */}
          <div className="space-y-3">
             <div>
              <label className="block text-sm font-semibold mb-1">Empleado</label>
              <select
                className="border p-2 rounded w-full bg-gray-50"
                value={empleadoSel}
                onChange={(e) => setEmpleadoSel(e.target.value)}
              >
                <option value="">-- Selecciona empleado --</option>
                {empleados.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">Cliente</label>
              <select
                className="border p-2 rounded w-full"
                value={clienteSel}
                onChange={(e) => setClienteSel(e.target.value)}
              >
                <option value="">-- Selecciona cliente --</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.codigo ? `${c.codigo} · ` : ""}
                    {c.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm font-semibold mb-1">Fecha Inicio</label>
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
                className="px-4 py-2 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={asignar}
                disabled={asignando || reseteando}
              >
                {asignando ? 'Asignando...' : 'Asignar Cliente'}
              </button>
              <button
                className="px-4 py-2 rounded bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={resetear}
                disabled={!empleadoSel || asignando || reseteando}
              >
                {reseteando ? 'Eliminando...' : 'Quitar Cliente'}
              </button>
              <p className="text-xs text-gray-500 mt-2 w-full">
                Esto cerrará automáticamente la asignación anterior.
              </p>
            </div>
          </div>

          {/* Columna Derecha: Historial */}
          <div className="bg-gray-50 rounded p-3 border">
            <h3 className="font-bold text-sm mb-2 text-gray-700">Historial de Clientes</h3>
            {!empleadoSel ? (
              <div className="text-gray-500 text-sm italic">Selecciona un empleado</div>
            ) : hist.length === 0 ? (
              <div className="text-gray-500 text-sm">Sin historial de clientes.</div>
            ) : (
              <div className="overflow-x-auto max-h-[300px]">
                <table className="w-full text-sm">
                  <thead className="text-left text-gray-600 sticky top-0 bg-gray-50">
                    <tr>
                      <th className="pb-2">Cliente</th>
                      <th className="pb-2">Inicio</th>
                      <th className="pb-2">Fin</th>
                      <th className="pb-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {hist.map((h) => (
                      <tr key={h.id}>
                        <td className="py-2 pr-2 font-medium">{h.cliente_nombre}</td>
                        <td className="py-2 pr-2 whitespace-nowrap">{h.fecha_inicio}</td>
                        <td className="py-2 pr-2 whitespace-nowrap">{h.fecha_fin || "-"}</td>
                        <td className="py-2">
                          {h.activo ? (
                            <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded-full text-xs">Activo</span>
                          ) : (
                            <span className="text-gray-500 text-xs">Inactivo</span>
                          )}
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
