"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import { showError } from "@/lib/toast";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { CheckCircle, XCircle, AlertCircle, ArrowRight, ArrowLeft, ArrowLeftRight, Clock } from "lucide-react";

type SyncLog = {
  id: string;
  sync_type: "manual" | "auto" | "webhook";
  sync_direction: "to_google" | "from_google" | "bidirectional";
  status: "success" | "partial" | "error";
  events_created: number;
  events_updated: number;
  events_deleted: number;
  errors_count: number;
  error_details: any;
  created_at: string;
};

export default function CalendarSyncHistory() {
  const [history, setHistory] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadHistory() {
    try {
      const res = await api.get("/admin/calendar-sync/history?limit=10");
      setHistory(res.data);
    } catch (err) {
      console.error("Error cargando historial:", err);
      showError("No se pudo cargar el historial");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  function getStatusIcon(status: string) {
    switch (status) {
      case "success":
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case "partial":
        return <AlertCircle className="w-5 h-5 text-yellow-600" />;
      case "error":
        return <XCircle className="w-5 h-5 text-red-600" />;
      default:
        return <Clock className="w-5 h-5 text-gray-400" />;
    }
  }

  function getDirectionIcon(direction: string) {
    switch (direction) {
      case "to_google":
        return <ArrowRight className="w-4 h-4 text-blue-600" />;
      case "from_google":
        return <ArrowLeft className="w-4 h-4 text-purple-600" />;
      case "bidirectional":
        return <ArrowLeftRight className="w-4 h-4 text-indigo-600" />;
      default:
        return null;
    }
  }

  function getDirectionLabel(direction: string) {
    switch (direction) {
      case "to_google":
        return "→ A Google";
      case "from_google":
        return "← Desde Google";
      case "bidirectional":
        return "↔️ Bidireccional";
      default:
        return direction;
    }
  }

  function getTypeLabel(type: string) {
    switch (type) {
      case "manual":
        return "Manual";
      case "auto":
        return "Automático";
      case "webhook":
        return "Webhook";
      default:
        return type;
    }
  }

  if (loading) {
    return <LoadingSpinner />;
  }

  if (history.length === 0) {
    return (
      <div className="card text-center py-8 text-gray-500">
        <p>No hay sincronizaciones registradas</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 className="font-semibold text-lg mb-4">Historial de Sincronizaciones</h3>

      <div className="space-y-3">
        {history.map((log) => (
          <div key={log.id} className="p-3 border rounded-lg hover:bg-gray-50 transition">
            <div className="flex items-start justify-between">
              {/* Left: Status + Info */}
              <div className="flex items-start gap-3 flex-1">
                {/* Status Icon */}
                <div className="mt-0.5">{getStatusIcon(log.status)}</div>

                {/* Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Direction */}
                    <span className="flex items-center gap-1 text-sm font-medium">
                      {getDirectionIcon(log.sync_direction)}
                      {getDirectionLabel(log.sync_direction)}
                    </span>

                    {/* Type */}
                    <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">
                      {getTypeLabel(log.sync_type)}
                    </span>

                    {/* Timestamp */}
                    <span className="text-xs text-gray-500">
                      {new Date(log.created_at).toLocaleString("es-ES", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </span>
                  </div>

                  {/* Results */}
                  <div className="flex items-center gap-3 mt-1 text-sm text-gray-600">
                    {log.events_created > 0 && (
                      <span className="text-green-600">
                        +{log.events_created} creados
                      </span>
                    )}
                    {log.events_updated > 0 && (
                      <span className="text-blue-600">
                        ~{log.events_updated} actualizados
                      </span>
                    )}
                    {log.events_deleted > 0 && (
                      <span className="text-red-600">
                        -{log.events_deleted} eliminados
                      </span>
                    )}
                    {log.errors_count > 0 && (
                      <span className="text-red-600 font-medium">
                        ⚠️ {log.errors_count} errores
                      </span>
                    )}
                  </div>

                  {/* Error Details */}
                  {log.error_details && log.errors_count > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs text-red-600 cursor-pointer hover:underline">
                        Ver errores
                      </summary>
                      <pre className="mt-1 text-xs bg-red-50 p-2 rounded overflow-x-auto">
                        {JSON.stringify(log.error_details, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
