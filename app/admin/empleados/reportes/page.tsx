"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

interface Reporte {
  id: string;
  fecha: string;
  resumen: string;
  estado: "pendiente" | "aprobado" | "rechazado";
}

export default function MisReportes() {
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<Reporte[]>([]);

  async function load() {
    try {
      const res = await api.get("/reports/mine");
      setReports(res.data || []);
    } catch (e) {
      console.error("Error cargando reportes", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) return <LoadingSpinner fullPage />;

  function badgeEstado(estado: Reporte["estado"]) {
    switch (estado) {
      case "aprobado":
        return <span className="badge-success">Aprobado</span>;
      case "rechazado":
        return <span className="badge-danger">Rechazado</span>;
      default:
        return <span className="badge-warning">Pendiente</span>;
    }
  }

  return (
    <div className="app-main max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Mis reportes</h1>

      {reports.length === 0 ? (
        <div className="card text-muted-foreground text-sm">
          No tienes reportes aún.
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <div key={r.id} className="card space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-semibold">
                  {new Date(r.fecha).toLocaleDateString("es-ES")}
                </div>

                {badgeEstado(r.estado)}
              </div>

              <p className="text-sm text-muted-foreground line-clamp-2">
                {r.resumen}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
