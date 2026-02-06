"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/services/api";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

type Importacion = {
  id: string;
  created_at: string;
  origen: "ocr" | "manual" | "mixto";
  stats: any;
  reverted_at?: string | null;
  creado_por_nombre?: string | null;
};

export default function ImportacionesPage() {
  const [rows, setRows] = useState<Importacion[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/admin/calendario/importaciones");
      setRows(res.data.importaciones || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const active = useMemo(() => rows.filter((r) => !r.reverted_at), [rows]);

  async function undo(id: string) {
    if (
      !confirm(
        "¿Deshacer esta importación? Se desactivarán los días que estén actualmente aplicados por esta importación.",
      )
    )
      return;
    setLoading(true);
    try {
      await api.post(`/admin/calendario/importaciones/${id}/deshacer`);
      await load();
      alert("Importación deshecha.");
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || "Error deshacer");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Historial de importaciones</h1>
        <p className="text-sm text-muted-foreground">
          Cada confirmación crea una importación auditable. Puedes comparar y
          deshacer.
        </p>
      </div>

      <div className="bg-card border rounded-lg overflow-auto">
        <table className="min-w-[980px] w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="p-2 border-b">Fecha</th>
              <th className="p-2 border-b">Usuario</th>
              <th className="p-2 border-b">Origen</th>
              <th className="p-2 border-b">Stats</th>
              <th className="p-2 border-b">Estado</th>
              <th className="p-2 border-b text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = r.stats || {};
              return (
                <tr key={r.id} className="odd:bg-background even:bg-muted/20">
                  <td className="p-2 align-top">
                    {new Date(r.created_at).toLocaleString("es-ES")}
                  </td>
                  <td className="p-2 align-top">
                    {r.creado_por_nombre || "—"}
                  </td>
                  <td className="p-2 align-top">{r.origen}</td>
                  <td className="p-2 align-top text-muted-foreground">
                    total:{s.total ?? "—"} · activos:{s.activos ?? "—"} ·
                    festivos:{s.festivos ?? "—"} · manual:{s.manuales ?? 0}
                  </td>
                  <td className="p-2 align-top">
                    {r.reverted_at ? (
                      <span className="text-muted-foreground">Revertida</span>
                    ) : (
                      <span className="text-foreground">Activa</span>
                    )}
                  </td>
                  <td className="p-2 align-top text-right space-x-2">
                    <Link
                      className="text-sm hover:underline"
                      href={`/admin/configuracion/calendario/importaciones/${r.id}`}
                    >
                      Ver
                    </Link>
                    <Link
                      className="text-sm hover:underline"
                      href={`/admin/configuracion/calendario/importaciones/compare`}
                    >
                      Comparar
                    </Link>
                    {!r.reverted_at && (
                      <button
                        className="text-sm text-red-600 hover:underline"
                        onClick={() => undo(r.id)}
                        disabled={loading}
                      >
                        Deshacer
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}

            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-3 text-muted-foreground">
                {loading ? (
                    <div className="flex justify-center p-4">
                        <LoadingSpinner showText={false} />
                    </div>
                ) : "No hay importaciones todavía."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
