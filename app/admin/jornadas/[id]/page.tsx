"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api } from "@/services/api";

type Plantilla = {
  id: string;
  empresa_id: string;
  nombre: string;
  descripcion?: string | null;
  tipo?: string | null;
  activo?: boolean;
};

type PlantillaDia = {
  id: string;
  plantilla_id: string;
  dia_semana: number; // 1..7
  hora_inicio: string | null; // "HH:MM:SS"
  hora_fin: string | null;
  activo?: boolean;
};

type Bloque = {
  id?: string;
  plantilla_dia_id?: string;
  tipo: string; // "trabajo" | "descanso" | ...
  hora_inicio: string; // "HH:MM:SS"
  hora_fin: string;
  obligatorio?: boolean;
};

type Excepcion = {
  id: string;
  plantilla_id: string;
  fecha: string; // YYYY-MM-DD
  activo: boolean;
  hora_inicio: string | null;
  hora_fin: string | null;
  nota: string | null;
};

function diaLabel(d: number) {
  const map: Record<number, string> = {
    1: "Lunes",
    2: "Martes",
    3: "Miércoles",
    4: "Jueves",
    5: "Viernes",
    6: "Sábado",
    7: "Domingo",
  };
  return map[d] ?? `Día ${d}`;
}

function ymdLocal(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function EditarPlantillaPage() {
  const params = useParams();
  const search = useSearchParams();
  const id = String(params.id);

  const tab = search.get("tab") || "editor"; // "editor" | "asignaciones" | "preview"

  const [loading, setLoading] = useState(true);
  const [savingMeta, setSavingMeta] = useState(false);

  const [plantilla, setPlantilla] = useState<Plantilla | null>(null);
  const [dias, setDias] = useState<PlantillaDia[]>([]);
  const [excepciones, setExcepciones] = useState<Excepcion[]>([]);

  // editor meta
  const [meta, setMeta] = useState({
    nombre: "",
    descripcion: "",
    tipo: "semanal",
    activo: true,
  });

  // seleccion día
  const [diaSel, setDiaSel] = useState<number>(1);
  const diaObj = useMemo(
    () => dias.find((d) => d.dia_semana === diaSel) || null,
    [dias, diaSel]
  );

  // bloques día
  const [bloques, setBloques] = useState<Bloque[]>([]);
  const [loadingBloques, setLoadingBloques] = useState(false);

  // asignaciones
  const [empleados, setEmpleados] = useState<any[]>([]);
  const [empleadoSel, setEmpleadoSel] = useState<string>("");
  const [asig, setAsig] = useState<any[]>([]);
  const [asigForm, setAsigForm] = useState({
    fecha_inicio: ymdLocal(),
    fecha_fin: "",
  });

  // preview
  const [previewFecha, setPreviewFecha] = useState<string>(ymdLocal());
  const [previewEmpleado, setPreviewEmpleado] = useState<string>("");
  const [preview, setPreview] = useState<any>(null);

  async function loadDetalle() {
    setLoading(true);
    try {
      const res = await api.get(`/admin/plantillas/${id}`);
      const p = res.data?.plantilla;
      const d = res.data?.dias || [];
      const ex = res.data?.excepciones || [];

      setPlantilla(p);
      setDias(d);
      setExcepciones(ex);

      setMeta({
        nombre: p?.nombre ?? "",
        descripcion: p?.descripcion ?? "",
        tipo: p?.tipo ?? "semanal",
        activo: p?.activo ?? true,
      });

      // set día seleccionado al primero existente
      const firstDia = (
        Array.isArray(d) && d.length ? d[0].dia_semana : 1
      ) as number;
      setDiaSel(firstDia);
    } catch (e) {
      console.error(e);
      setPlantilla(null);
      setDias([]);
      setExcepciones([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadEmpleados() {
    try {
      const res = await api.get("/employees");
      setEmpleados(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      console.error(e);
      setEmpleados([]);
    }
  }

  useEffect(() => {
    loadDetalle();
    loadEmpleados();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ---- BLOQUES (día seleccionado) ----
  async function loadBloquesDia(plantillaDiaId: string) {
    // No existe endpoint "get bloques" en tu controller; por eso:
    // estrategia: los bloques los gestionamos con "upsertBloquesDia" (borrar+insertar).
    // Para poder cargarlos, NECESITAMOS endpoint GET.
    //
    // Para no frenarte: implemento modo "solo edición" (empieza vacío) hasta que añadas:
    // GET /admin/plantillas/dias/:plantilla_dia_id/bloques
    //
    // Si ya lo tienes, cámbialo aquí.
    setLoadingBloques(true);
    try {
      // si tienes endpoint:
      // const res = await api.get(`/admin/plantillas/dias/${plantillaDiaId}/bloques`);
      // setBloques(res.data || []);
      setBloques([]); // fallback
    } finally {
      setLoadingBloques(false);
    }
  }

  useEffect(() => {
    if (!diaObj?.id) {
      setBloques([]);
      return;
    }
    loadBloquesDia(diaObj.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diaObj?.id]);

  async function guardarMeta() {
    if (!meta.nombre.trim()) return alert("Nombre obligatorio");
    setSavingMeta(true);
    try {
      await api.patch(`/admin/plantillas/${id}`, {
        nombre: meta.nombre.trim(),
        descripcion: meta.descripcion.trim() || null,
        tipo: meta.tipo,
        activo: meta.activo,
      });
      await loadDetalle();
      alert("Guardado");
    } catch (e) {
      console.error(e);
      alert("No se pudo guardar");
    } finally {
      setSavingMeta(false);
    }
  }

  async function upsertDiaSemana() {
    // crea o actualiza el día (y nos devuelve el registro con id)
    try {
      const res = await api.put(`/admin/plantillas/${id}/dias/${diaSel}`, {
        hora_inicio: diaObj?.hora_inicio ?? "08:00:00",
        hora_fin: diaObj?.hora_fin ?? "15:00:00",
        activo: diaObj?.activo ?? true,
      });
      // refresca días
      await loadDetalle();

      // si tu backend devuelve el día actualizado, puedes hacer:
      // const dia = res.data; ...
    } catch (e) {
      console.error(e);
      alert("No se pudo guardar el día");
    }
  }

  async function guardarBloquesDia() {
    if (!diaObj?.id) {
      alert("Primero guarda el día (para obtener plantilla_dia_id).");
      return;
    }

    // validación básica
    for (const b of bloques) {
      if (!b.tipo || !b.hora_inicio || !b.hora_fin) {
        alert("Todos los bloques deben tener tipo e inicio/fin.");
        return;
      }
      if (b.hora_inicio >= b.hora_fin) {
        alert("En un bloque, la hora inicio debe ser anterior a fin.");
        return;
      }
    }

    try {
      const res = await api.put(`/admin/plantillas/dias/${diaObj.id}/bloques`, {
        bloques: bloques.map((b) => ({
          tipo: b.tipo,
          hora_inicio: b.hora_inicio,
          hora_fin: b.hora_fin,
          obligatorio: b.obligatorio ?? true,
        })),
      });
      setBloques(Array.isArray(res.data) ? res.data : bloques);
      alert("Bloques guardados");
    } catch (e) {
      console.error(e);
      alert("No se pudieron guardar los bloques");
    }
  }

  // ---- EXCEPCIONES ----
  const [exForm, setExForm] = useState({
    fecha: ymdLocal(),
    activo: true,
    hora_inicio: "",
    hora_fin: "",
    nota: "",
  });

  async function upsertExcepcion() {
    try {
      const r = await api.put(
        `/admin/plantillas/${id}/excepciones/${exForm.fecha}`,
        {
          activo: exForm.activo,
          hora_inicio: exForm.hora_inicio || null,
          hora_fin: exForm.hora_fin || null,
          nota: exForm.nota || null,
        }
      );
      // r.data es la excepción (con id)
      await loadDetalle();
      alert("Excepción guardada");
    } catch (e) {
      console.error(e);
      alert("No se pudo guardar la excepción");
    }
  }

  // ---- ASIGNACIONES ----
  async function loadAsignacionesEmpleado(empleadoId: string) {
    try {
      const res = await api.get(`/admin/plantillas/asignaciones/${empleadoId}`);
      setAsig(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      console.error(e);
      setAsig([]);
    }
  }

  async function asignar() {
    if (!empleadoSel) return alert("Selecciona empleado");
    if (!asigForm.fecha_inicio) return alert("fecha_inicio obligatoria");

    try {
      await api.post("/admin/plantillas/asignar", {
        empleado_id: empleadoSel,
        plantilla_id: id,
        fecha_inicio: asigForm.fecha_inicio,
        fecha_fin: asigForm.fecha_fin || null,
      });
      await loadAsignacionesEmpleado(empleadoSel);
      alert("Asignación creada");
    } catch (e) {
      console.error(e);
      alert("No se pudo asignar");
    }
  }

  // ---- PREVIEW ----
  async function loadPreview() {
    if (!previewEmpleado) return alert("Selecciona empleado");
    try {
      const res = await api.get(
        `/admin/plantillas/plan-dia/${previewEmpleado}?fecha=${encodeURIComponent(
          previewFecha
        )}`
      );
      setPreview(res.data);
    } catch (e) {
      console.error(e);
      setPreview(null);
      alert("No se pudo cargar preview");
    }
  }

  if (loading) return <div className="p-4">Cargando…</div>;
  if (!plantilla) return <div className="p-4 text-red-600">No encontrada.</div>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Plantilla: {plantilla.nombre}</h1>
          <div className="text-sm text-gray-600">ID: {plantilla.id}</div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <a
            className={`px-3 py-2 rounded ${
              tab === "editor" ? "bg-blue-600 text-white" : "bg-gray-200"
            }`}
            href={`/admin/jornadas/${id}?tab=editor`}
          >
            Editor
          </a>
          <a
            className={`px-3 py-2 rounded ${
              tab === "asignaciones" ? "bg-blue-600 text-white" : "bg-gray-200"
            }`}
            href={`/admin/jornadas/${id}?tab=asignaciones`}
          >
            Asignaciones
          </a>
          <a
            className={`px-3 py-2 rounded ${
              tab === "preview" ? "bg-blue-600 text-white" : "bg-gray-200"
            }`}
            href={`/admin/jornadas/${id}?tab=preview`}
          >
            Vista previa
          </a>
          <a
            className="px-3 py-2 rounded bg-black text-white"
            href="/admin/jornadas"
          >
            Volver
          </a>
        </div>
      </div>

      {/* ====================== */}
      {/* TAB: EDITOR            */}
      {/* ====================== */}
      {tab === "editor" && (
        <div className="space-y-4">
          {/* Meta */}
          <div className="bg-white border rounded p-4 space-y-3">
            <h2 className="text-lg font-semibold">Datos generales</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-semibold">Nombre</label>
                <input
                  className="border rounded p-2 w-full"
                  value={meta.nombre}
                  onChange={(e) => setMeta({ ...meta, nombre: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-semibold">Tipo</label>
                <select
                  className="border rounded p-2 w-full"
                  value={meta.tipo}
                  onChange={(e) => setMeta({ ...meta, tipo: e.target.value })}
                >
                  <option value="diaria">Diaria</option>
                  <option value="semanal">Semanal</option>
                  <option value="mensual">Mensual</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="text-sm font-semibold">Descripción</label>
                <input
                  className="border rounded p-2 w-full"
                  value={meta.descripcion}
                  onChange={(e) =>
                    setMeta({ ...meta, descripcion: e.target.value })
                  }
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="activo"
                  type="checkbox"
                  checked={meta.activo}
                  onChange={(e) =>
                    setMeta({ ...meta, activo: e.target.checked })
                  }
                />
                <label htmlFor="activo" className="text-sm font-semibold">
                  Activa
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                disabled={savingMeta}
                className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-60"
                onClick={guardarMeta}
              >
                {savingMeta ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>

          {/* Días y bloques */}
          <div className="bg-white border rounded p-4 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-lg font-semibold">Semana (días y bloques)</h2>

              <div className="flex gap-2 flex-wrap">
                <select
                  className="border rounded p-2"
                  value={diaSel}
                  onChange={(e) => setDiaSel(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <option value={d} key={d}>
                      {diaLabel(d)}
                    </option>
                  ))}
                </select>

                <button
                  className="px-3 py-2 rounded bg-gray-200"
                  onClick={upsertDiaSemana}
                >
                  Guardar día
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-sm font-semibold">Activo</label>
                <select
                  className="border rounded p-2 w-full"
                  value={String(diaObj?.activo ?? true)}
                  onChange={(e) => {
                    const v = e.target.value === "true";
                    setDias((prev) =>
                      prev.map((x) =>
                        x.dia_semana === diaSel ? { ...x, activo: v } : x
                      )
                    );
                  }}
                >
                  <option value="true">Sí</option>
                  <option value="false">No</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-semibold">Hora inicio</label>
                <input
                  type="time"
                  className="border rounded p-2 w-full"
                  value={(diaObj?.hora_inicio ?? "08:00:00").slice(0, 5)}
                  onChange={(e) => {
                    const v = `${e.target.value}:00`;
                    setDias((prev) =>
                      prev.map((x) =>
                        x.dia_semana === diaSel ? { ...x, hora_inicio: v } : x
                      )
                    );
                  }}
                />
              </div>

              <div>
                <label className="text-sm font-semibold">Hora fin</label>
                <input
                  type="time"
                  className="border rounded p-2 w-full"
                  value={(diaObj?.hora_fin ?? "15:00:00").slice(0, 5)}
                  onChange={(e) => {
                    const v = `${e.target.value}:00`;
                    setDias((prev) =>
                      prev.map((x) =>
                        x.dia_semana === diaSel ? { ...x, hora_fin: v } : x
                      )
                    );
                  }}
                />
              </div>
            </div>

            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="font-semibold">Bloques ({diaLabel(diaSel)})</h3>

                <button
                  className="px-3 py-2 rounded bg-green-600 text-white"
                  onClick={() =>
                    setBloques((prev) => [
                      ...prev,
                      {
                        tipo: "trabajo",
                        hora_inicio: "08:00:00",
                        hora_fin: "10:00:00",
                        obligatorio: true,
                      },
                    ])
                  }
                >
                  + Añadir bloque
                </button>
              </div>

              {loadingBloques ? (
                <div className="text-gray-600">Cargando bloques…</div>
              ) : bloques.length === 0 ? (
                <div className="text-gray-600">
                  No hay bloques cargados. Añade y guarda.
                  <div className="text-xs text-gray-500 mt-1">
                    (Para poder “cargar” bloques existentes, necesitas un GET de
                    bloques por plantilla_dia_id.)
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {bloques.map((b, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end bg-gray-50 border rounded p-3"
                    >
                      <div>
                        <label className="text-xs font-semibold">Tipo</label>
                        <input
                          className="border rounded p-2 w-full"
                          value={b.tipo}
                          onChange={(e) => {
                            const v = e.target.value;
                            setBloques((prev) =>
                              prev.map((x, i) =>
                                i === idx ? { ...x, tipo: v } : x
                              )
                            );
                          }}
                        />
                      </div>

                      <div>
                        <label className="text-xs font-semibold">Inicio</label>
                        <input
                          type="time"
                          className="border rounded p-2 w-full"
                          value={b.hora_inicio.slice(0, 5)}
                          onChange={(e) => {
                            const v = `${e.target.value}:00`;
                            setBloques((prev) =>
                              prev.map((x, i) =>
                                i === idx ? { ...x, hora_inicio: v } : x
                              )
                            );
                          }}
                        />
                      </div>

                      <div>
                        <label className="text-xs font-semibold">Fin</label>
                        <input
                          type="time"
                          className="border rounded p-2 w-full"
                          value={b.hora_fin.slice(0, 5)}
                          onChange={(e) => {
                            const v = `${e.target.value}:00`;
                            setBloques((prev) =>
                              prev.map((x, i) =>
                                i === idx ? { ...x, hora_fin: v } : x
                              )
                            );
                          }}
                        />
                      </div>

                      <div>
                        <label className="text-xs font-semibold">
                          Obligatorio
                        </label>
                        <select
                          className="border rounded p-2 w-full"
                          value={String(b.obligatorio ?? true)}
                          onChange={(e) => {
                            const v = e.target.value === "true";
                            setBloques((prev) =>
                              prev.map((x, i) =>
                                i === idx ? { ...x, obligatorio: v } : x
                              )
                            );
                          }}
                        >
                          <option value="true">Sí</option>
                          <option value="false">No</option>
                        </select>
                      </div>

                      <div className="flex gap-2">
                        <button
                          className="px-3 py-2 rounded bg-gray-200"
                          onClick={() => {
                            // mover arriba
                            if (idx === 0) return;
                            setBloques((prev) => {
                              const copy = [...prev];
                              const a = copy[idx - 1];
                              copy[idx - 1] = copy[idx];
                              copy[idx] = a;
                              return copy;
                            });
                          }}
                        >
                          ↑
                        </button>
                        <button
                          className="px-3 py-2 rounded bg-gray-200"
                          onClick={() => {
                            // mover abajo
                            setBloques((prev) => {
                              if (idx === prev.length - 1) return prev;
                              const copy = [...prev];
                              const a = copy[idx + 1];
                              copy[idx + 1] = copy[idx];
                              copy[idx] = a;
                              return copy;
                            });
                          }}
                        >
                          ↓
                        </button>
                        <button
                          className="px-3 py-2 rounded bg-red-600 text-white"
                          onClick={() =>
                            setBloques((prev) =>
                              prev.filter((_, i) => i !== idx)
                            )
                          }
                        >
                          Borrar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  className="px-3 py-2 rounded bg-blue-600 text-white"
                  onClick={guardarBloquesDia}
                >
                  Guardar bloques
                </button>
              </div>
            </div>
          </div>

          {/* Excepciones */}
          <div className="bg-white border rounded p-4 space-y-3">
            <h2 className="text-lg font-semibold">Excepciones por fecha</h2>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
              <div>
                <label className="text-sm font-semibold">Fecha</label>
                <input
                  type="date"
                  className="border rounded p-2 w-full"
                  value={exForm.fecha}
                  onChange={(e) =>
                    setExForm({ ...exForm, fecha: e.target.value })
                  }
                />
              </div>

              <div>
                <label className="text-sm font-semibold">Activa</label>
                <select
                  className="border rounded p-2 w-full"
                  value={String(exForm.activo)}
                  onChange={(e) =>
                    setExForm({ ...exForm, activo: e.target.value === "true" })
                  }
                >
                  <option value="true">Sí</option>
                  <option value="false">No</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-semibold">
                  Inicio (opcional)
                </label>
                <input
                  type="time"
                  className="border rounded p-2 w-full"
                  value={exForm.hora_inicio}
                  onChange={(e) =>
                    setExForm({ ...exForm, hora_inicio: e.target.value })
                  }
                />
              </div>

              <div>
                <label className="text-sm font-semibold">Fin (opcional)</label>
                <input
                  type="time"
                  className="border rounded p-2 w-full"
                  value={exForm.hora_fin}
                  onChange={(e) =>
                    setExForm({ ...exForm, hora_fin: e.target.value })
                  }
                />
              </div>

              <div>
                <button
                  className="px-3 py-2 rounded bg-blue-600 text-white w-full"
                  onClick={upsertExcepcion}
                >
                  Guardar excepción
                </button>
              </div>

              <div className="md:col-span-5">
                <label className="text-sm font-semibold">Nota</label>
                <input
                  className="border rounded p-2 w-full"
                  value={exForm.nota}
                  onChange={(e) =>
                    setExForm({ ...exForm, nota: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="text-sm text-gray-600">
              Excepciones existentes: <b>{excepciones.length}</b>
            </div>

            {excepciones.length > 0 && (
              <div className="border rounded overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="p-3 text-left">Fecha</th>
                      <th className="p-3 text-left">Activa</th>
                      <th className="p-3 text-left">Rango</th>
                      <th className="p-3 text-left">Nota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {excepciones.map((ex) => (
                      <tr key={ex.id} className="border-t">
                        <td className="p-3">{ex.fecha}</td>
                        <td className="p-3">{ex.activo ? "Sí" : "No"}</td>
                        <td className="p-3">
                          {ex.hora_inicio && ex.hora_fin
                            ? `${ex.hora_inicio} - ${ex.hora_fin}`
                            : "-"}
                        </td>
                        <td className="p-3">{ex.nota ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====================== */}
      {/* TAB: ASIGNACIONES       */}
      {/* ====================== */}
      {tab === "asignaciones" && (
        <div className="space-y-4">
          <div className="bg-white border rounded p-4 space-y-3">
            <h2 className="text-lg font-semibold">
              Asignar plantilla a empleado
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div className="md:col-span-2">
                <label className="text-sm font-semibold">Empleado</label>
                <select
                  className="border rounded p-2 w-full"
                  value={empleadoSel}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEmpleadoSel(v);
                    if (v) loadAsignacionesEmpleado(v);
                  }}
                >
                  <option value="">Seleccionar…</option>
                  {empleados.map((e) => (
                    <option value={e.id} key={e.id}>
                      {e.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm font-semibold">Desde</label>
                <input
                  type="date"
                  className="border rounded p-2 w-full"
                  value={asigForm.fecha_inicio}
                  onChange={(e) =>
                    setAsigForm({ ...asigForm, fecha_inicio: e.target.value })
                  }
                />
              </div>

              <div>
                <label className="text-sm font-semibold">
                  Hasta (opcional)
                </label>
                <input
                  type="date"
                  className="border rounded p-2 w-full"
                  value={asigForm.fecha_fin}
                  onChange={(e) =>
                    setAsigForm({ ...asigForm, fecha_fin: e.target.value })
                  }
                />
              </div>

              <div className="md:col-span-4 flex justify-end">
                <button
                  className="px-3 py-2 rounded bg-blue-600 text-white"
                  onClick={asignar}
                >
                  Asignar
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white border rounded p-4 space-y-3">
            <h3 className="font-semibold">Asignaciones del empleado</h3>
            {!empleadoSel ? (
              <div className="text-gray-600">Selecciona un empleado.</div>
            ) : asig.length === 0 ? (
              <div className="text-gray-600">No hay asignaciones.</div>
            ) : (
              <div className="border rounded overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="p-3 text-left">Plantilla</th>
                      <th className="p-3 text-left">Desde</th>
                      <th className="p-3 text-left">Hasta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {asig.map((x: any) => (
                      <tr key={x.id} className="border-t">
                        <td className="p-3">
                          {x.plantilla_nombre ?? x.plantilla_id}
                        </td>
                        <td className="p-3">{x.fecha_inicio}</td>
                        <td className="p-3">{x.fecha_fin ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====================== */}
      {/* TAB: PREVIEW            */}
      {/* ====================== */}
      {tab === "preview" && (
        <div className="space-y-4">
          <div className="bg-white border rounded p-4 space-y-3">
            <h2 className="text-lg font-semibold">
              Vista previa del plan del día
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <label className="text-sm font-semibold">Empleado</label>
                <select
                  className="border rounded p-2 w-full"
                  value={previewEmpleado}
                  onChange={(e) => setPreviewEmpleado(e.target.value)}
                >
                  <option value="">Seleccionar…</option>
                  {empleados.map((e) => (
                    <option value={e.id} key={e.id}>
                      {e.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm font-semibold">Fecha</label>
                <input
                  type="date"
                  className="border rounded p-2 w-full"
                  value={previewFecha}
                  onChange={(e) => setPreviewFecha(e.target.value)}
                />
              </div>

              <div>
                <button
                  className="px-3 py-2 rounded bg-blue-600 text-white w-full"
                  onClick={loadPreview}
                >
                  Ver plan
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white border rounded p-4 space-y-3">
            {!preview ? (
              <div className="text-gray-600">
                Selecciona empleado y fecha, y pulsa “Ver plan”.
              </div>
            ) : (
              <>
                <div className="text-sm text-gray-600">
                  <div>
                    Plantilla activa: <b>{preview.plantilla_id ?? "Ninguna"}</b>
                  </div>
                  <div>
                    Modo: <b>{preview.modo ?? "-"}</b>
                  </div>
                  <div>
                    Rango:{" "}
                    <b>
                      {preview.rango?.inicio && preview.rango?.fin
                        ? `${preview.rango.inicio} - ${preview.rango.fin}`
                        : "-"}
                    </b>
                  </div>
                  {preview.nota ? <div>Nota: {preview.nota}</div> : null}
                </div>

                <div className="border rounded overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="p-3 text-left">Tipo</th>
                        <th className="p-3 text-left">Inicio</th>
                        <th className="p-3 text-left">Fin</th>
                        <th className="p-3 text-left">Obligatorio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(preview.bloques || []).map((b: any, idx: number) => (
                        <tr key={idx} className="border-t">
                          <td className="p-3">{b.tipo}</td>
                          <td className="p-3">{b.inicio}</td>
                          <td className="p-3">{b.fin}</td>
                          <td className="p-3">{b.obligatorio ? "Sí" : "No"}</td>
                        </tr>
                      ))}
                      {(preview.bloques || []).length === 0 ? (
                        <tr>
                          <td className="p-4 text-gray-600" colSpan={4}>
                            No hay bloques definidos para ese día.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
// app/admin/jornadas/[id]/page.tsx
