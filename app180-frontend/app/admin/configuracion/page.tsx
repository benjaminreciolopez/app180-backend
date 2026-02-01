"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import { showSuccess, showError } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

type Modulos = {
  fichajes?: boolean;
  ausencias?: boolean;
  worklogs?: boolean;
  empleados?: boolean;
  facturacion?: boolean;
};

const DEFAULTS: Modulos = {
  fichajes: true,
  ausencias: true,
  worklogs: true,
  empleados: true,
  facturacion: false,
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
    <div className="app-main max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">Configuración del sistema</h1>

      <div className="card space-y-3">
        <Toggle
          label="Fichajes"
          value={modulos.fichajes}
          onChange={() => toggle("fichajes")}
        />

        <Toggle
          label="Ausencias"
          value={modulos.ausencias}
          onChange={() => toggle("ausencias")}
        />

        <Toggle
          label="Trabajos / Partes"
          value={modulos.worklogs}
          onChange={() => toggle("worklogs")}
        />

        <Toggle
          label="Empleados"
          value={modulos.empleados}
          onChange={() => toggle("empleados")}
        />

        <Toggle
          label="Facturación"
          value={modulos.facturacion}
          onChange={() => toggle("facturacion")}
        />
      </div>

      <Button onClick={save} disabled={saving} className="py-6 font-bold shadow-md">
        {saving ? "Guardando…" : "Guardar cambios"}
      </Button>
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
