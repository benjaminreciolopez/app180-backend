"use client";

import { useEffect, useState } from "react";
import { api, setAuthToken } from "@/services/api";
import { showSuccess, showError } from "@/lib/toast";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

interface FichajeRechazado {
  id: string;
  fecha: string;
  tipo: string;
  nombre_empleado: string;
  nombre_cliente: string | null;
  geo_direccion: {
    direccion: string | null;
    ciudad: string | null;
    pais: string | null;
    lat: number;
    lng: number;
  } | null;
  fecha_rechazo: string;
  motivo_rechazo: string | null;
  rechazado_por: string;
  nota: string | null;
}

export default function FichajesRechazadosPage() {
  const [fichajes, setFichajes] = useState<FichajeRechazado[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFichaje, setSelectedFichaje] = useState<FichajeRechazado | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    setAuthToken(token);
    loadFichajes();
  }, []);

  async function loadFichajes() {
    setLoading(true);
    try {
      const res = await api.get("/admin/auditoria/fichajes-rechazados");
      setFichajes(res.data || []);
    } catch (error) {
      console.error("Error cargando fichajes rechazados:", error);
    } finally {
      setLoading(false);
    }
  }

  async function eliminarFichaje(id: string) {
    if (!confirm("¿Eliminar este fichaje permanentemente? Esta acción no se puede deshacer.")) {
      return;
    }

    try {
      await api.delete(`/admin/auditoria/fichajes-rechazados/${id}`);
      setFichajes(prev => prev.filter(f => f.id !== id));
      showSuccess("Fichaje eliminado permanentemente");
      loadFichajes();
      setSelectedFichaje(null);
    } catch (error) {
      console.error("Error eliminando fichaje:", error);
      showError("Error al eliminar fichaje");
    }
  }

  const renderDireccion = (f: FichajeRechazado) => {
    if (!f.geo_direccion) return "Sin ubicación";
    
    const { direccion, ciudad, pais, lat, lng } = f.geo_direccion;
    const parts = [direccion, ciudad, pais].filter(Boolean);
    
    if (parts.length > 0) return parts.join(", ");
    if (lat && lng) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    
    return "Ubicación desconocida";
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-red-600">🚫 Fichajes Rechazados</h1>
        <p className="text-gray-600 mt-1">
          Fichajes marcados como fraudulentos o inválidos
        </p>
      </div>

      {/* Estadísticas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg shadow border">
          <div className="text-sm font-semibold text-gray-500 uppercase">
            Total Rechazados
          </div>
          <div className="text-3xl font-bold text-red-600 mt-2">
            {fichajes.length}
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow border">
          <div className="text-sm font-semibold text-gray-500 uppercase">
            Empleados Afectados
          </div>
          <div className="text-3xl font-bold text-gray-900 mt-2">
            {new Set(fichajes.map((f) => f.nombre_empleado)).size}
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow border">
          <div className="text-sm font-semibold text-gray-500 uppercase">
            Último Rechazo
          </div>
          <div className="text-sm font-medium text-gray-900 mt-2">
            {fichajes.length > 0
              ? new Date(fichajes[0].fecha_rechazo).toLocaleDateString("es-ES")
              : "-"}
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-lg shadow border overflow-hidden">
        {loading ? (
          <div className="p-8">
            <LoadingSpinner />
          </div>
        ) : fichajes.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No hay fichajes rechazados
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Empleado
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Fecha Fichaje
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Tipo
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Ubicación
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Rechazado Por
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Fecha Rechazo
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {fichajes.map((f) => (
                  <tr key={f.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {f.nombre_empleado}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {new Date(f.fecha).toLocaleString("es-ES")}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 bg-gray-100 text-gray-800 text-xs rounded border capitalize">
                        {f.tipo}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">
                      {renderDireccion(f)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {f.rechazado_por || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {new Date(f.fecha_rechazo).toLocaleDateString("es-ES")}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setSelectedFichaje(f)}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium mr-3"
                      >
                        Ver
                      </button>
                      <button
                        onClick={() => eliminarFichaje(f.id)}
                        className="text-red-600 hover:text-red-800 text-sm font-medium"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de Detalles */}
      {selectedFichaje && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b flex justify-between items-center bg-red-50">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  Fichaje Rechazado
                </h2>
                <p className="text-sm text-gray-600">ID: {selectedFichaje.id}</p>
              </div>
              <button
                onClick={() => setSelectedFichaje(null)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-semibold text-gray-500">
                      Empleado
                    </label>
                    <p className="text-gray-900 font-medium">
                      {selectedFichaje.nombre_empleado}
                    </p>
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-gray-500">
                      Cliente
                    </label>
                    <p className="text-gray-900">
                      {selectedFichaje.nombre_cliente || "Sin cliente"}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-semibold text-gray-500">
                      Fecha Fichaje
                    </label>
                    <p className="text-gray-900">
                      {new Date(selectedFichaje.fecha).toLocaleString("es-ES")}
                    </p>
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-gray-500">
                      Tipo
                    </label>
                    <p className="text-gray-900 capitalize">
                      {selectedFichaje.tipo}
                    </p>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-semibold text-gray-500">
                    Ubicación
                  </label>
                  <p className="text-gray-900">{renderDireccion(selectedFichaje)}</p>
                </div>

                <div className="border-t pt-4">
                  <label className="text-sm font-semibold text-red-600">
                    Información del Rechazo
                  </label>
                  
                  <div className="mt-2 space-y-2">
                    <div>
                      <span className="text-sm text-gray-500">Rechazado por:</span>
                      <p className="text-gray-900">
                        {selectedFichaje.rechazado_por || "Desconocido"}
                      </p>
                    </div>

                    <div>
                      <span className="text-sm text-gray-500">Fecha de rechazo:</span>
                      <p className="text-gray-900">
                        {new Date(selectedFichaje.fecha_rechazo).toLocaleString("es-ES")}
                      </p>
                    </div>

                    {selectedFichaje.motivo_rechazo && (
                      <div>
                        <span className="text-sm text-gray-500">Motivo:</span>
                        <p className="text-gray-900 bg-red-50 p-2 rounded border border-red-200">
                          {selectedFichaje.motivo_rechazo}
                        </p>
                      </div>
                    )}

                    {selectedFichaje.nota && (
                      <div>
                        <span className="text-sm text-gray-500">Notas:</span>
                        <p className="text-gray-900 bg-gray-50 p-2 rounded border">
                          {selectedFichaje.nota}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 border-t flex justify-between">
              <button
                onClick={() => eliminarFichaje(selectedFichaje.id)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-medium"
              >
                Eliminar Permanentemente
              </button>
              <button
                onClick={() => setSelectedFichaje(null)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
