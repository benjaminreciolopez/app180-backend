"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import { useRouter } from "next/navigation";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

export default function ReportarPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [resumen, setResumen] = useState("");
  const [horas, setHoras] = useState<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function load() {
    try {
      const res = await api.get("/reports/mine/today");
      if (res.data) {
        setResumen(res.data.resumen || "");
        setHoras(
          typeof res.data.horas_trabajadas === "number"
            ? res.data.horas_trabajadas
            : null
        );
      }
    } catch {
      // silencioso: si no hay reporte aún, está ok
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;

    setSaving(true);
    setError(null);
    setOk(false);

    try {
      // validación mínima (opcional)
      if (horas !== null && horas < 0) {
        setError("Las horas no pueden ser negativas.");
        return;
      }

      await api.post("/reports", {
        resumen,
        horas_trabajadas: horas,
      });

      setOk(true);

      // redirige al dashboard
      router.push("/empleado/dashboard");
    } catch (err: any) {
      console.error(err);
      setError(err?.response?.data?.error || "No se pudo guardar el reporte.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="app-main max-w-xl space-y-4">
      <h1 className="text-xl font-bold">Reporte del día</h1>

      <form onSubmit={guardar} className="card space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {ok && (
          <p className="text-sm text-green-600">
            Reporte guardado correctamente.
          </p>
        )}

        <div className="space-y-1">
          <label className="block text-sm font-medium">
            Resumen del trabajo
          </label>
          <textarea
            className="input h-32 resize-none"
            value={resumen}
            onChange={(e) => setResumen(e.target.value)}
            required
            placeholder="Describe brevemente lo realizado hoy..."
          />
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium">Horas trabajadas</label>
          <input
            type="number"
            step="0.25"
            min="0"
            className="input"
            value={horas ?? ""}
            onChange={(e) =>
              setHoras(e.target.value ? parseFloat(e.target.value) : null)
            }
            placeholder="Ej. 8"
          />
          <p className="text-xs text-muted-foreground">
            Opcional. Puedes dejarlo vacío si no aplica.
          </p>
        </div>

        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Guardando..." : "Guardar"}
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => router.back()}
            disabled={saving}
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
