"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/services/api";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

export default function ImportacionDetalle() {
  const params = useParams<{ id: string }>();
  const id = params.id as string;

  const [head, setHead] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get(`/admin/calendario/importaciones/${id}`);
      setHead(res.data.importacion);
      setItems(res.data.items || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (id) load();
  }, [id]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Detalle importación</h1>
        <p className="text-sm text-muted-foreground">
          Snapshot inmutable de lo confirmado.
        </p>
      </div>

      {loading && (
        <LoadingSpinner />
      )}

      {head && (
        <div className="bg-card border rounded-lg p-4 space-y-2">
          <div className="text-sm">ID: {head.id}</div>
          <div className="text-sm">Origen: {head.origen}</div>
          <div className="text-sm">
            Creada: {new Date(head.created_at).toLocaleString("es-ES")}
          </div>
          {head.reverted_at && (
            <div className="text-sm text-red-600">
              Revertida: {new Date(head.reverted_at).toLocaleString("es-ES")}
            </div>
          )}
        </div>
      )}

      <div className="bg-card border rounded-lg overflow-auto">
        <table className="min-w-[980px] w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="p-2 border-b">Fecha</th>
              <th className="p-2 border-b">Tipo</th>
              <th className="p-2 border-b">Ámbito</th>
              <th className="p-2 border-b">Descripción</th>
              <th className="p-2 border-b text-center">Laborable</th>
              <th className="p-2 border-b text-center">Activo</th>
              <th className="p-2 border-b text-center">Origen</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="odd:bg-background even:bg-muted/20">
                <td className="p-2">{it.fecha}</td>
                <td className="p-2">{it.tipo}</td>
                <td className="p-2">{it.label || "—"}</td>
                <td className="p-2">{it.descripcion || "—"}</td>
                <td className="p-2 text-center">
                  {it.es_laborable ? "Sí" : "No"}
                </td>
                <td className="p-2 text-center">{it.activo ? "Sí" : "No"}</td>
                <td className="p-2 text-center">{it.origen}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="p-3 text-muted-foreground">
                  Sin items.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
