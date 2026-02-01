"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import { showSuccess, showError } from "@/lib/toast";
import { UniversalExportButton } from "@/components/shared/UniversalExportButton";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

type ParteItem = {
  empleado_id: string;
  empleado_nombre: string;
  fecha: string;
  estado: string;
  resumen: string;
  horas_trabajadas: number | null;
  cliente_nombre: string | null;
  validado?: boolean;
  validado_at?: string | null;
};
function estadoLabel(estado: string) {
  switch (estado) {
    case "completo":
      return "Completado";
    case "abierto":
      return "En curso";
    case "incidencia":
      return "Incidencia";
    case "incompleto":
      return "Incompleto";
    case "ausente":
      return "Ausencia";
    case "solo_trabajo":
      return "Trabajo sin fichaje";
    default:
      return estado;
  }
}
function revisionLabel(it: ParteItem) {
  if (it.validado === true) return "Validado";
  if (it.validado === false) return "Incidencia";
  return "Pendiente";
}

function revisionClass(it: ParteItem) {
  if (it.validado === true) return "text-green-700";
  if (it.validado === false) return "text-red-700";
  return "text-gray-600";
}

export default function AdminPartesDiaPage() {
  const [fecha, setFecha] = useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ParteItem | null>(null);
  const [nota, setNota] = useState("");
  const [saving, setSaving] = useState(false);

  const [items, setItems] = useState<ParteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const orderedItems = [...items].sort((a, b) => {
    const rank = (x: ParteItem) =>
      x.validado === null ? 0 : x.validado === false ? 1 : 2;
    return rank(a) - rank(b);
  });

  async function load(f = fecha) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/admin/partes-dia", { params: { fecha: f } });
      const data = res.data;
      setItems(Array.isArray(res.data?.items) ? res.data.items : []);
    } catch (e) {
      console.error(e);
      setError("No se han podido cargar los partes del día");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }
  async function validarParte(validado: boolean) {
    if (!selected) return;

    if (!validado && nota.trim().length === 0) {
      showError("La nota es obligatoria para marcar incidencia");
      return;
    }

    try {
      setSaving(true);

      await api.patch("/admin/partes-dia/validar", {
        empleado_id: selected.empleado_id,
        fecha,
        validado,
        nota_admin: nota || null,
      });

      setOpen(false);
      setNota("");
      setSelected(null);
      load(fecha);
    } catch (e) {
      console.error(e);
      showError("Error validando el parte");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app-main space-y-4">
      <div className="flex items-end gap-3">
        <div>
          <h1 className="text-2xl font-bold">Partes del día</h1>
        </div>

        <div className="ml-auto flex gap-2">
          <input
            type="date"
            className="border rounded px-3 py-2"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
          <button className="btn-primary px-4 py-2" onClick={() => load(fecha)}>
            Cargar
          </button>
          <UniversalExportButton 
              module="partes-dia" 
              queryParams={{ fecha }} 
              label="Exportar"
          />
        </div>
      </div>

      {loading && <LoadingSpinner fullPage />}
      {error && <div className="p-2 text-red-600 font-semibold">{error}</div>}

      {!loading && !error && (
        <div className="bg-white border rounded">
          <table className="w-full">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-3 text-left">Empleado</th>
                <th className="p-3 text-left">Cliente</th>
                <th className="p-3 text-left">Horas</th>
                <th className="p-3 text-left">Estado</th>
                <th className="p-3 text-left">Revisión</th>
                <th className="p-3 text-left">Resumen</th>
                <th className="p-3 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td className="p-3 text-gray-500" colSpan={5}>
                    No hay partes para este día
                  </td>
                </tr>
              ) : (
                orderedItems.map((it) => (
                  <tr
                    key={`${it.empleado_id}-${it.fecha}`}
                    className="border-t"
                  >
                    <td className="p-3">{it.empleado_nombre}</td>
                    <td className="p-3">{it.cliente_nombre || "—"}</td>
                    <td className="p-3">
                      {it.horas_trabajadas != null
                        ? `${it.horas_trabajadas} h`
                        : "—"}
                    </td>
                    <td className="p-3">{estadoLabel(it.estado)}</td>
                    <td className={`p-3 font-semibold ${revisionClass(it)}`}>
                      {revisionLabel(it)}
                    </td>
                    <td className="p-3">{it.resumen}</td>
                    <td className="p-3">
                      <button
                        disabled={it.validado === true}
                        className={`btn-primary text-sm px-3 py-1 ${
                          it.validado === true
                            ? "opacity-50 cursor-not-allowed"
                            : ""
                        }`}
                        onClick={() => {
                          setSelected(it);
                          setOpen(true);
                        }}
                      >
                        Revisar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {open && selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded p-6 w-full max-w-lg space-y-4">
            <h2 className="text-lg font-bold">
              Parte de {selected.empleado_nombre}
            </h2>

            <p className="text-sm text-gray-600">{selected.resumen}</p>

            <textarea
              className="w-full border rounded p-2"
              rows={4}
              placeholder="Nota administrativa (obligatoria si hay incidencia)"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
            />

            <div className="flex justify-end gap-2">
              <button
                className="px-4 py-2 border rounded"
                onClick={() => {
                  setOpen(false);
                  setNota("");
                  setSelected(null);
                }}
              >
                Cancelar
              </button>

              <button
                disabled={saving}
                className="btn-danger px-4 py-2"
                onClick={() => validarParte(false)}
              >
                Incidencia
              </button>

              <button
                disabled={saving}
                className="btn-primary px-4 py-2"
                onClick={() => validarParte(true)}
              >
                Validar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
