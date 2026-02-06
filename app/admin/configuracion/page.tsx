"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import { showSuccess, showError } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import CalendarConfigPanel from "@/components/admin/CalendarConfigPanel";
import CalendarSyncHistory from "@/components/admin/CalendarSyncHistory";

type Modulos = {
  fichajes?: boolean;
  worklogs?: boolean;
  empleados?: boolean;
  facturacion?: boolean;
  pagos?: boolean;
};

const DEFAULTS: Modulos = {
  fichajes: true,
  worklogs: true,
  empleados: true,
  facturacion: false,
  pagos: false,
};

export default function AdminConfiguracionPage() {
  const [modulos, setModulos] = useState<Modulos | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const r = await api.get("/admin/configuracion");

      setModulos({
        ...DEFAULTS,
        ...r.data,
      });
    } catch (e) {
      console.error("Error cargando config", e);
      showError("No se pudo cargar la configuración");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!modulos) return;

    setSaving(true);

    try {
      await api.put("/admin/configuracion", { modulos });

      const me = await api.get("/auth/me");
      localStorage.setItem("user", JSON.stringify(me.data));

      // 🔔 Notificar layout
      window.dispatchEvent(new Event("session-updated"));

      showSuccess("Configuración guardada");
    } finally {
      setSaving(false);
    }
  }

  function toggle(k: keyof Modulos) {
    setModulos((prev) => ({
      ...prev!,
      [k]: prev?.[k] === false ? true : false,
    }));
  }

  if (!modulos) return <LoadingSpinner fullPage />;

  return (
    <div className="app-main max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Configuración del sistema</h1>

      {/* Módulos */}
      <div>
        <h2 className="text-xl font-semibold mb-3">Módulos</h2>
        <div className="card space-y-3">
        <Toggle
          label="Fichajes"
          value={modulos.fichajes}
          onChange={() => toggle("fichajes")}
        />

        <Toggle
          label="Trabajos / Partes"
          value={modulos.worklogs}
          onChange={() => toggle("worklogs")}
        />

        <Toggle
          label="Empleados (incluye Ausencias)"
          value={modulos.empleados}
          onChange={() => toggle("empleados")}
        />

        <Toggle
          label="Facturación"
          value={modulos.facturacion}
          onChange={() => toggle("facturacion")}
        />

        <Toggle
          label="Cobros y Pagos"
          value={modulos.pagos}
          onChange={() => toggle("pagos")}
        />
        </div>

        <Button onClick={save} disabled={saving} className="mt-4 py-6 font-bold shadow-md">
          {saving ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>

      {/* Google Calendar */}
      <div>
        <h2 className="text-xl font-semibold mb-3">Sincronización con Google Calendar</h2>
        <CalendarConfigPanel />
      </div>

      {/* Historial */}
      <div>
        <CalendarSyncHistory />
      </div>
    </div>
  );
}

/* ========================
   Toggle reutilizable
======================== */

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center justify-between">
      <span>{label}</span>

      <input
        type="checkbox"
        checked={value !== false}
        onChange={onChange}
        className="w-5 h-5"
      />
    </label>
  );
}
