"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/services/api";

type Importacion = {
  id: string;
  created_at: string;
  origen: string;
  reverted_at?: string | null;
};

type Row = {
  fecha: string;
  status: "igual" | "añadido" | "eliminado" | "modificado";
  a: any | null;
  b: any | null;
};

export default function CompareImportacionesPage() {
  const searchParams = useSearchParams();
  const [importaciones, setImportaciones] = useState<Importacion[]>([]);
  const [a, setA] = useState<string | null>(searchParams.get("a"));
  const [b, setB] = useState<string | null>(searchParams.get("b"));
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadImportaciones() {
    const res = await api.get("/admin/calendario/importaciones");
    setImportaciones(res.data.importaciones || []);
  }

  async function compare() {
    if (!a || !b) return;
    setLoading(true);
    try {
      const res = await api.get(
        `/admin/calendario/importaciones-compare?a=${a}&b=${b}`,
      );
      setRows(res.data.rows || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadImportaciones();
  }, []);

  useEffect(() => {
    if (a && b) compare();
  }, [a, b]);

  function badge(status: Row["status"]) {
    if (status === "igual")
      return <span className="text-muted-foreground">Igual</span>;
    if (status === "añadido")
      return <span className="text-green-600">Añadido</span>;
    if (status === "eliminado")
      return <span className="text-red-600">Eliminado</span>;
    return <span className="text-amber-600">Modificado</span>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Comparar importaciones</h1>
        <p className="text-sm text-muted-foreground">
          Selecciona dos importaciones confirmadas para ver sus diferencias.
        </p>
      </div>

      {/* Selectores */}
      <div className="bg-card border rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">Importación A</label>
          <select
            className="border rounded px-2 py-1 w-full"
            value={a || ""}
            onChange={(e) => setA(e.target.value || null)}
          >
            <option value="">— Selecciona —</option>
            {importaciones.map((i) => (
              <option key={i.id} value={i.id}>
                {new Date(i.created_at).toLocaleString("es-ES")} · {i.origen}
                {i.reverted_at ? " (revertida)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium">Importación B</label>
          <select
            className="border rounded px-2 py-1 w-full"
            value={b || ""}
            onChange={(e) => setB(e.target.value || null)}
          >
            <option value="">— Selecciona —</option>
            {importaciones.map((i) => (
              <option key={i.id} value={i.id}>
                {new Date(i.created_at).toLocaleString("es-ES")} · {i.origen}
                {i.reverted_at ? " (revertida)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-card border rounded-lg overflow-auto">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="p-2 border-b">Fecha</th>
              <th className="p-2 border-b">Estado</th>
              <th className="p-2 border-b">A</th>
              <th className="p-2 border-b">B</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="odd:bg-background even:bg-muted/20">
                <td className="p-2">{r.fecha}</td>
                <td className="p-2">{badge(r.status)}</td>
                <td className="p-2 text-xs">
                  {r.a ? JSON.stringify(r.a) : "—"}
                </td>
                <td className="p-2 text-xs">
                  {r.b ? JSON.stringify(r.b) : "—"}
                </td>
              </tr>
            ))}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="p-3 text-muted-foreground">
                  Selecciona dos importaciones para comparar.
                </td>
              </tr>
            )}

            {loading && (
              <tr>
                <td colSpan={4} className="p-3 text-muted-foreground">
                  Comparando…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
