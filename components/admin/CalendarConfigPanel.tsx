"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import { showSuccess, showError } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { Calendar, Check, X, RefreshCw, Settings, Trash2 } from "lucide-react";

type CalendarConfig = {
  configured: boolean;
  oauth2_provider?: string;
  oauth2_email?: string;
  oauth2_connected_at?: string;
  calendar_id?: string;
  last_sync_at?: string;
  sync_enabled?: boolean;
  sync_direction?: "bidirectional" | "to_google" | "from_google";
  sync_types?: {
    festivos?: boolean;
    cierres?: boolean;
    ausencias?: boolean;
  };
  sync_range_months?: number;
};

export default function CalendarConfigPanel() {
  const [config, setConfig] = useState<CalendarConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Settings state
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [syncDirection, setSyncDirection] = useState<"bidirectional" | "to_google" | "from_google">("bidirectional");
  const [syncTypes, setSyncTypes] = useState({
    festivos: true,
    cierres: true,
    ausencias: false
  });

  async function loadConfig() {
    try {
      const res = await api.get("/admin/calendar-config");
      setConfig(res.data);

      if (res.data.configured) {
        setSyncEnabled(res.data.sync_enabled ?? true);
        setSyncDirection(res.data.sync_direction ?? "bidirectional");
        setSyncTypes(res.data.sync_types ?? { festivos: true, cierres: true, ausencias: false });
      }
    } catch (err) {
      console.error("Error cargando config:", err);
      showError("No se pudo cargar la configuración");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConfig();
  }, []);

  async function handleConnect() {
    setConnecting(true);
    try {
      const res = await api.post("/admin/calendar-config/oauth2/start", {
        provider: "google"
      });

      const { authUrl } = res.data;

      // Abrir popup OAuth2
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      const popup = window.open(
        authUrl,
        "Google Calendar OAuth",
        `width=${width},height=${height},left=${left},top=${top}`
      );

      // Polling para detectar cuando se cierra el popup
      const interval = setInterval(() => {
        if (popup?.closed) {
          clearInterval(interval);
          setConnecting(false);
          loadConfig(); // Recargar config
          showSuccess("Google Calendar conectado correctamente");
        }
      }, 500);
    } catch (err: any) {
      console.error("Error conectando:", err);
      showError(err.response?.data?.error || "Error al conectar con Google Calendar");
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("¿Estás seguro de desconectar Google Calendar?")) return;

    try {
      await api.post("/admin/calendar-config/oauth2/disconnect");
      showSuccess("Google Calendar desconectado");
      loadConfig();
    } catch (err: any) {
      console.error("Error desconectando:", err);
      showError(err.response?.data?.error || "Error al desconectar");
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await api.post("/admin/calendar-sync/bidirectional");
      showSuccess(res.data.message);
      loadConfig(); // Actualizar last_sync_at
    } catch (err: any) {
      console.error("Error sincronizando:", err);
      showError(err.response?.data?.error || "Error al sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  async function handleSaveSettings() {
    try {
      await api.put("/admin/calendar-config/settings", {
        sync_enabled: syncEnabled,
        sync_direction: syncDirection,
        sync_types: syncTypes
      });
      showSuccess("Configuración guardada");
      setShowSettings(false);
      loadConfig();
    } catch (err: any) {
      console.error("Error guardando settings:", err);
      showError(err.response?.data?.error || "Error al guardar configuración");
    }
  }

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-4">
      {/* Status Card */}
      <div className="card">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg ${config?.configured ? "bg-green-100" : "bg-gray-100"}`}>
              <Calendar className={`w-6 h-6 ${config?.configured ? "text-green-600" : "text-gray-400"}`} />
            </div>

            <div>
              <h3 className="font-semibold text-lg">
                {config?.configured ? "Google Calendar Conectado" : "Google Calendar"}
              </h3>

              {config?.configured ? (
                <div className="text-sm text-gray-600 space-y-1 mt-1">
                  <p>📧 {config.oauth2_email}</p>
                  {config.last_sync_at && (
                    <p className="text-xs">
                      Última sync: {new Date(config.last_sync_at).toLocaleString("es-ES")}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`px-2 py-1 rounded text-xs ${config.sync_enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                      {config.sync_enabled ? "Habilitado" : "Deshabilitado"}
                    </span>
                    <span className="px-2 py-1 rounded text-xs bg-blue-100 text-blue-700">
                      {syncDirection === "bidirectional" ? "↔️ Bidireccional" : syncDirection === "to_google" ? "→ A Google" : "← Desde Google"}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-600 mt-1">
                  Conecta tu cuenta de Google para sincronizar eventos automáticamente
                </p>
              )}
            </div>
          </div>

          {config?.configured && (
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
              title="Configuración"
            >
              <Settings className="w-5 h-5 text-gray-600" />
            </button>
          )}
        </div>

        {/* Settings Panel */}
        {showSettings && config?.configured && (
          <div className="mt-4 pt-4 border-t space-y-4">
            <h4 className="font-semibold">Configuración de Sincronización</h4>

            {/* Sync Enabled */}
            <label className="flex items-center justify-between">
              <span className="text-sm">Sincronización automática</span>
              <input
                type="checkbox"
                checked={syncEnabled}
                onChange={(e) => setSyncEnabled(e.target.checked)}
                className="w-5 h-5"
              />
            </label>

            {/* Sync Direction */}
            <div>
              <label className="text-sm font-medium">Dirección</label>
              <select
                value={syncDirection}
                onChange={(e) => setSyncDirection(e.target.value as any)}
                className="w-full mt-1 p-2 border rounded"
              >
                <option value="bidirectional">↔️ Bidireccional (recomendado)</option>
                <option value="to_google">→ Solo a Google Calendar</option>
                <option value="from_google">← Solo desde Google Calendar</option>
              </select>
            </div>

            {/* Sync Types */}
            <div>
              <label className="text-sm font-medium">Tipos de eventos a sincronizar</label>
              <div className="mt-2 space-y-2">
                <label className="flex items-center justify-between">
                  <span className="text-sm">Festivos</span>
                  <input
                    type="checkbox"
                    checked={syncTypes.festivos ?? true}
                    onChange={(e) => setSyncTypes({ ...syncTypes, festivos: e.target.checked })}
                    className="w-5 h-5"
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span className="text-sm">Cierres de empresa</span>
                  <input
                    type="checkbox"
                    checked={syncTypes.cierres ?? true}
                    onChange={(e) => setSyncTypes({ ...syncTypes, cierres: e.target.checked })}
                    className="w-5 h-5"
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span className="text-sm">Ausencias (sensible - RGPD)</span>
                  <input
                    type="checkbox"
                    checked={syncTypes.ausencias ?? false}
                    onChange={(e) => setSyncTypes({ ...syncTypes, ausencias: e.target.checked })}
                    className="w-5 h-5"
                  />
                </label>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleSaveSettings} className="flex-1">
                Guardar cambios
              </Button>
              <Button
                onClick={() => setShowSettings(false)}
                variant="outline"
                className="flex-1"
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-4">
          {!config?.configured ? (
            <Button
              onClick={handleConnect}
              disabled={connecting}
              className="w-full py-6 font-bold shadow-md"
            >
              {connecting ? "Conectando..." : "Conectar con Google Calendar"}
            </Button>
          ) : (
            <>
              <Button
                onClick={handleSync}
                disabled={syncing || !config.sync_enabled}
                className="flex-1 py-6 font-bold shadow-md"
              >
                {syncing ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Sincronizando...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4" />
                    Sincronizar ahora
                  </span>
                )}
              </Button>

              <Button
                onClick={handleDisconnect}
                variant="outline"
                className="px-6 py-6"
                title="Desconectar"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
