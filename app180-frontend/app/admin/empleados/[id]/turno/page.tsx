"use client";

import { useEffect, useState } from "react";
import { getTurnos } from "@/services/turnos";
import { api } from "@/services/api";
import { useParams, useRouter } from "next/navigation";

interface Turno {
  id: string;
  nombre: string;
}

export default function AsignarTurnoEmpleado() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [turnoId, setTurnoId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const t = await getTurnos();
        setTurnos(t);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function asignar() {
    if (saving) return;
    setSaving(true);

    try {
      await api.put(`/employees/${id}/turno`, {
        turno_id: turnoId || null,
      });
      router.push("/admin/empleados");
    } catch {
      alert("Error al asignar turno");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p>Cargando turnos…</p>;

  return (
    <div className="app-main max-w-xl">
      <h1 className="text-xl font-bold mb-4">Asignar turno</h1>

      <div className="card space-y-4">
        <select
          className="input w-full"
          value={turnoId}
          onChange={(e) => setTurnoId(e.target.value)}
        >
          <option value="">Sin turno</option>
          {turnos.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </select>

        <div className="flex gap-2">
          <button onClick={asignar} disabled={saving} className="btn-primary">
            {saving ? "Guardando..." : "Guardar"}
          </button>

          <button onClick={() => router.back()} className="btn-secondary">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
