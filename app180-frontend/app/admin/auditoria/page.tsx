"use client";

import { useEffect, useState } from "react";
import { api, setAuthToken } from "@/services/api";
import { UniversalExportButton } from "@/components/shared/UniversalExportButton";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

interface AuditLog {
  id: string;
  accion: string;
  entidad_tipo: string;
  entidad_id: string;
  user_email: string;
  empleado_nombre: string | null;
  motivo: string | null;
  datos_anteriores: any;
  datos_nuevos: any;
  ip_address: string | null;
  created_at: string;
}

interface AuditStats {
  by_action: Array<{
    accion: string;
    total: string;
    empleados_afectados: string;
  }>;
  by_employee: Array<{
    id: string;
    nombre: string;
    total_rechazados: string;
  }>;
  daily_activity: Array<{
    fecha: string;
    total: string;
  }>;
}

export default function AuditoriaPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  // Filtros
  const [accionFilter, setAccionFilter] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token");
    setAuthToken(token);
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [logsRes, statsRes] = await Promise.all([
        api.get("/admin/auditoria/logs", {
          params: {
            accion: accionFilter || undefined,
            fecha_desde: fechaDesde || undefined,
            fecha_hasta: fechaHasta || undefined,
            limit: 50,
          },
        }),
        api.get("/admin/auditoria/stats"),
      ]);

      setLogs(logsRes.data.logs || []);
      setStats(statsRes.data);
    } catch (error) {
      console.error("Error cargando auditoría:", error);
    } finally {
      setLoading(false);
    }
  }

  const accionLabels: Record<string, string> = {
    fichaje_validado: "Fichaje Validado",
    fichaje_rechazado: "Fichaje Rechazado",
    fichaje_eliminado: "Fichaje Eliminado",
    jornada_cerrada_manual: "Jornada Cerrada",
    empleado_modificado: "Empleado Modificado",
    empleado_desactivado: "Empleado Desactivado",
  };

  const accionColors: Record<string, string> = {
    fichaje_validado: "bg-green-100 text-green-800 border-green-200",
    fichaje_rechazado: "bg-red-100 text-red-800 border-red-200",
    fichaje_eliminado: "bg-gray-100 text-gray-800 border-gray-200",
    jornada_cerrada_manual: "bg-blue-100 text-blue-800 border-blue-200",
    empleado_modificado: "bg-yellow-100 text-yellow-800 border-yellow-200",
    empleado_desactivado: "bg-orange-100 text-orange-800 border-orange-200",
  };

  // Renderizar cambios de forma legible
  function renderCambios(antes: any, despues: any, accion: string) {
    if (!antes || !despues) return null;

    // Para fichajes
    if (accion.includes("fichaje")) {
      const cambios = [];

      // Estado
      if (antes.estado !== despues.estado) {
        cambios.push(
          <div key="estado" className="bg-blue-50 p-3 rounded border border-blue-200">
            <div className="text-xs font-semibold text-blue-700 mb-1">Estado</div>
            <div className="flex items-center gap-2 text-sm">
              <span className="px-2 py-1 bg-gray-200 text-gray-700 rounded">
                {antes.estado}
              </span>
              <span>→</span>
              <span className={`px-2 py-1 rounded ${
                despues.estado === 'confirmado' ? 'bg-green-200 text-green-800' : 
                despues.estado === 'rechazado' ? 'bg-red-200 text-red-800' : 
                'bg-gray-200 text-gray-700'
              }`}>
                {despues.estado}
              </span>
            </div>
          </div>
        );
      }

      // Sospechoso
      if (antes.sospechoso !== despues.sospechoso) {
        cambios.push(
          <div key="sospechoso" className="bg-yellow-50 p-3 rounded border border-yellow-200">
            <div className="text-xs font-semibold text-yellow-700 mb-1">Sospechoso</div>
            <div className="flex items-center gap-2 text-sm">
              <span className="px-2 py-1 bg-yellow-200 text-yellow-800 rounded">
                {antes.sospechoso ? 'Sí' : 'No'}
              </span>
              <span>→</span>
              <span className="px-2 py-1 bg-green-200 text-green-800 rounded">
                {despues.sospechoso ? 'Sí' : 'No'}
              </span>
            </div>
          </div>
        );
      }

      // Motivo de sospecha
      if (antes.sospecha_motivo && !despues.sospecha_motivo) {
        cambios.push(
          <div key="motivo" className="bg-gray-50 p-3 rounded border border-gray-200">
            <div className="text-xs font-semibold text-gray-700 mb-1">Motivo de Sospecha</div>
            <div className="text-sm text-gray-600 line-through">
              {antes.sospecha_motivo}
            </div>
            <div className="text-xs text-green-600 mt-1">✓ Limpiado</div>
          </div>
        );
      }

      // Información del fichaje
      cambios.push(
        <div key="info" className="bg-gray-50 p-3 rounded border border-gray-200">
          <div className="text-xs font-semibold text-gray-700 mb-2">Información del Fichaje</div>
          <div className="space-y-1 text-sm">
            <div><span className="text-gray-500">Tipo:</span> <span className="font-medium capitalize">{antes.tipo}</span></div>
            <div><span className="text-gray-500">Fecha:</span> <span className="font-medium">{new Date(antes.fecha).toLocaleString('es-ES')}</span></div>
            {antes.direccion && (
              <div><span className="text-gray-500">Ubicación:</span> <span className="font-medium">{antes.direccion}</span></div>
            )}
            {antes.geo_direccion && typeof antes.geo_direccion === 'string' && (
              <div><span className="text-gray-500">Ubicación:</span> <span className="font-medium">{JSON.parse(antes.geo_direccion).direccion}</span></div>
            )}
            {antes.geo_direccion && typeof antes.geo_direccion === 'object' && (
              <div><span className="text-gray-500">Ubicación:</span> <span className="font-medium">{antes.geo_direccion.direccion}</span></div>
            )}
          </div>
        </div>
      );

      return <div className="space-y-3">{cambios}</div>;
    }

    // Para otros tipos, mostrar cambios genéricos
    const keys = new Set([...Object.keys(antes), ...Object.keys(despues)]);
    const cambios = [];

    for (const key of keys) {
      if (antes[key] !== despues[key] && !['id', 'created_at', 'user_id', 'empresa_id'].includes(key)) {
        cambios.push(
          <div key={key} className="bg-gray-50 p-2 rounded border">
            <div className="text-xs font-semibold text-gray-600">{key}</div>
            <div className="flex items-center gap-2 text-sm mt-1">
              <span className="text-gray-700">{String(antes[key] || '-')}</span>
              <span>→</span>
              <span className="text-gray-900 font-medium">{String(despues[key] || '-')}</span>
            </div>
          </div>
        );
      }
    }

    return <div className="space-y-2">{cambios}</div>;
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
            <h1 className="text-3xl font-bold text-gray-900">🔍 Auditoría</h1>
            <p className="text-gray-600 mt-1">
            Registro de acciones administrativas y eventos del sistema
            </p>
        </div>
        <UniversalExportButton 
            module="auditoria"
            queryParams={{ 
                accion: accionFilter, 
                fecha_desde: fechaDesde,
                fecha_hasta: fechaHasta 
            }}
            label="Exportar"
        />
      </div>

      {/* Estadísticas */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow border">
            <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2">
              Acciones (30 días)
            </h3>
            <div className="space-y-1">
              {stats.by_action.slice(0, 3).map((stat) => (
                <div key={stat.accion} className="flex justify-between text-sm">
                  <span className="text-gray-700">
                    {accionLabels[stat.accion] || stat.accion}
                  </span>
                  <span className="font-bold text-gray-900">{stat.total}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow border">
            <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2">
              Fichajes Rechazados
            </h3>
            <div className="space-y-1">
              {stats.by_employee.slice(0, 3).map((emp) => (
                <div key={emp.id} className="flex justify-between text-sm">
                  <span className="text-gray-700 truncate">{emp.nombre}</span>
                  <span className="font-bold text-red-600">
                    {emp.total_rechazados}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow border">
            <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2">
              Actividad Reciente
            </h3>
            <div className="space-y-1">
              {stats.daily_activity.slice(0, 3).map((day) => (
                <div key={day.fecha} className="flex justify-between text-sm">
                  <span className="text-gray-700">
                    {new Date(day.fecha).toLocaleDateString("es-ES")}
                  </span>
                  <span className="font-bold text-gray-900">{day.total}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="bg-white p-4 rounded-lg shadow border mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Acción
            </label>
            <select
              value={accionFilter}
              onChange={(e) => setAccionFilter(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Todas</option>
              {Object.entries(accionLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Desde
            </label>
            <input
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Hasta
            </label>
            <input
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={loadData}
              className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm font-medium"
            >
              Filtrar
            </button>
          </div>
        </div>
      </div>

      {/* Tabla de Logs */}
      <div className="bg-white rounded-lg shadow border overflow-hidden">
        {loading ? (
          <div className="p-8">
            <LoadingSpinner />
          </div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No hay registros de auditoría
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Fecha/Hora
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Acción
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Usuario
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Empleado
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Motivo
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">
                    Detalles
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {new Date(log.created_at).toLocaleString("es-ES")}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded border ${
                          accionColors[log.accion] || "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {accionLabels[log.accion] || log.accion}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {log.user_email}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {log.empleado_nombre || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">
                      {log.motivo || "-"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                      >
                        Ver
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
      {selectedLog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">
                Detalles del Log
              </h2>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-semibold text-gray-500">
                    Acción
                  </label>
                  <p className="text-gray-900">
                    {accionLabels[selectedLog.accion] || selectedLog.accion}
                  </p>
                </div>

                <div>
                  <label className="text-sm font-semibold text-gray-500">
                    Fecha/Hora
                  </label>
                  <p className="text-gray-900">
                    {new Date(selectedLog.created_at).toLocaleString("es-ES")}
                  </p>
                </div>

                <div>
                  <label className="text-sm font-semibold text-gray-500">
                    Usuario
                  </label>
                  <p className="text-gray-900">{selectedLog.user_email}</p>
                </div>

                {selectedLog.empleado_nombre && (
                  <div>
                    <label className="text-sm font-semibold text-gray-500">
                      Empleado Afectado
                    </label>
                    <p className="text-gray-900">{selectedLog.empleado_nombre}</p>
                  </div>
                )}

                {selectedLog.motivo && (
                  <div>
                    <label className="text-sm font-semibold text-gray-500">
                      Motivo
                    </label>
                    <p className="text-gray-900">{selectedLog.motivo}</p>
                  </div>
                )}

                {selectedLog.ip_address && (
                  <div>
                    <label className="text-sm font-semibold text-gray-500">
                      IP
                    </label>
                    <p className="text-gray-900 font-mono text-sm">
                      {selectedLog.ip_address}
                    </p>
                  </div>
                )}

                {/* Cambios Legibles */}
                {selectedLog.datos_anteriores && selectedLog.datos_nuevos && (
                  <div className="border-t pt-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">
                      📋 Cambios Realizados
                    </h3>
                    {renderCambios(selectedLog.datos_anteriores, selectedLog.datos_nuevos, selectedLog.accion)}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t flex justify-end">
              <button
                onClick={() => setSelectedLog(null)}
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
