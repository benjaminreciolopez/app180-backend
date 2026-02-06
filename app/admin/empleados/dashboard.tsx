"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import Link from "next/link";

interface Reporte {
  fecha: string;
  estado: "pendiente" | "aprobado" | "rechazado";
  resumen: string;
}

export default function EmpleadoDashboard() {
  const [loading, setLoading] = useState(true);
  const [reporte, setReporte] = useState<Reporte | null>(null);

  async function load() {
    try {
      const res = await api.get("/reports/mine/today");
      setReporte(res.data || null);
    } catch (e) {
      console.error("Error cargando reporte", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) return <p className="app-main">Cargando…</p>;

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
      <h1 className="text-2xl font-bold">Mi día</h1>

      {reporte ? (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">
              {new Date(reporte.fecha).toLocaleDateString("es-ES")}
            </div>

            {badgeEstado(reporte.estado)}
          </div>

          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {reporte.resumen}
          </p>

          {reporte.estado === "pendiente" && (
            <Link href="/empleado/reportar" className="btn-primary w-fit">
              Editar reporte
            </Link>
          )}
        </div>
      ) : (
        <div className="card space-y-3">
          <p className="text-muted-foreground">
            No has enviado tu reporte de hoy.
          </p>

          <Link href="/empleado/reportar" className="btn-primary w-fit">
            Crear reporte del día
          </Link>
        </div>
      )}

      <div>
        <Link href="/empleado/reportes" className="btn-outline">
          Ver historial de reportes
        </Link>
      </div>
    </div>
  );
}
