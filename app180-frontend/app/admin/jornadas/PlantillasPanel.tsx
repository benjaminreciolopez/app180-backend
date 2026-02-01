"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/services/api";
import type { Bloque, Excepcion, Plantilla, PlantillaDia } from "./types";
import BloquesEditor from "./BloquesEditor";
import RenamePlantillaModal from "./RenamePlantillaModal";
import DeletePlantillaModal from "./DeletePlantillaModal";
import CopyDiasModal from "./CopyDiasModal";
import { showSuccess, showError } from "@/lib/toast";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

const DIAS = [
  { n: 1, label: "Lunes" },
  { n: 2, label: "Martes" },
  { n: 3, label: "Miércoles" },
  { n: 4, label: "Jueves" },
  { n: 5, label: "Viernes" },
  { n: 6, label: "Sábado" },
  { n: 7, label: "Domingo" },
];

function toHHMMSS(v: string) {
  if (!v) return v;
  return v.length === 5 ? `${v}:00` : v;
}

function fromHHMMSS(v?: string | null) {
  // para input type=time (HH:MM)
  if (!v) return "";
  return v.slice(0, 5);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function apiErrorMessage(e: any) {
  return e?.response?.data?.error || e?.message || "Error inesperado";
}

export default function PlantillasPanel() {
  const [loading, setLoading] = useState(true);
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>([]);
  const [sel, setSel] = useState<Plantilla | null>(null);
  const [showRename, setShowRename] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const [detalle, setDetalle] = useState<{
    plantilla: Plantilla;
    dias: PlantillaDia[];
    excepciones: Excepcion[];
  } | null>(null);

  const [error, setError] = useState<string | null>(null);

  // -----------------------
  // Día semanal seleccionado
  // -----------------------
  const [diaSemanaSel, setDiaSemanaSel] = useState<number>(1);

  const diaSel = useMemo(() => {
    if (!detalle) return null;
    return detalle.dias.find((d) => d.dia_semana === diaSemanaSel) ?? null;
  }, [detalle, diaSemanaSel]);

  // Editor del rango del día (semana)
  const [diaHoraInicio, setDiaHoraInicio] = useState<string>("08:00");
  const [diaHoraFin, setDiaHoraFin] = useState<string>("18:00");
  const [diaActivo, setDiaActivo] = useState<boolean>(true);
  const [savingDia, setSavingDia] = useState(false);

  // Bloques del día
  const [bloquesDia, setBloquesDia] = useState<Bloque[]>([]);
  const [cargandoBloquesDia, setCargandoBloquesDia] = useState(false);
  const [savingBloquesDia, setSavingBloquesDia] = useState(false);

  // -----------------------
  // Excepción seleccionada
  // -----------------------
  const [exSel, setExSel] = useState<Excepcion | null>(null);

  // Editor excepción
  const [exFecha, setExFecha] = useState<string>(todayISO());
  const [exActivo, setExActivo] = useState<boolean>(true);
  const [exHoraInicio, setExHoraInicio] = useState<string>("");
  const [exHoraFin, setExHoraFin] = useState<string>("");
  const [exNota, setExNota] = useState<string>("");
  const [savingEx, setSavingEx] = useState(false);

  // Bloques excepción
  const [bloquesEx, setBloquesEx] = useState<Bloque[]>([]);
  const [cargandoBloquesEx, setCargandoBloquesEx] = useState(false);
  const [savingBloquesEx, setSavingBloquesEx] = useState(false);
  const [savingRename, setSavingRename] = useState(false);
  const [savingDelete, setSavingDelete] = useState(false);
  const [showCopy, setShowCopy] = useState(false);
  const [resettingDay, setResettingDay] = useState(false);
  const origenLabel = useMemo(() => {
    return DIAS.find((d) => d.n === diaSemanaSel)?.label || "";
  }, [diaSemanaSel]);
  const [copying, setCopying] = useState(false);

  // -----------------------
  // Loads
  // -----------------------
  async function loadPlantillas() {
    setLoading(true);
    setError(null);
    try {
      const [rp, rc] = await Promise.all([
         api.get("/admin/plantillas"),
         api.get("/admin/clientes")
      ]);
      setPlantillas(Array.isArray(rp.data) ? rp.data : []);
      setClientes(Array.isArray(rc.data) ? rc.data : []);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadDetalle(plantillaId: string) {
    setError(null);
    const r = await api.get(`/admin/plantillas/${plantillaId}`);
    setDetalle(r.data);
  }

  // init
  useEffect(() => {
    loadPlantillas();
  }, []);

  // cuando eliges plantilla
  useEffect(() => {
    (async () => {
      if (!sel) {
        setDetalle(null);
        setError(null);
        return;
      }

      // reset UI dependiente
      setDiaSemanaSel(1);
      setBloquesDia([]);
      setExSel(null);
      setBloquesEx([]);
      setError(null);

      try {
        await loadDetalle(sel.id);
      } catch (e) {
        setError(apiErrorMessage(e));
      }
    })();
  }, [sel?.id]);

  // cuando cambia diaSel: precargar el editor del rango
  useEffect(() => {
    // si existe en DB, usa sus valores; si no, defaults
    if (diaSel?.hora_inicio) setDiaHoraInicio(fromHHMMSS(diaSel.hora_inicio));
    else setDiaHoraInicio("08:00");

    if (diaSel?.hora_fin) setDiaHoraFin(fromHHMMSS(diaSel.hora_fin));
    else setDiaHoraFin("18:00");

    setDiaActivo(diaSel?.activo ?? true);
  }, [diaSel?.id]);

  // cuando cambias de día semanal -> cargar bloques del día
  useEffect(() => {
    (async () => {
      setError(null);

      if (!diaSel?.id) {
        setBloquesDia([]);
        return;
      }

      setCargandoBloquesDia(true);
      try {
        const r = await api.get(`/admin/plantillas/dias/${diaSel.id}/bloques`);
        setBloquesDia(Array.isArray(r.data) ? r.data : []);
      } catch (e) {
        setError(apiErrorMessage(e));
      } finally {
        setCargandoBloquesDia(false);
      }
    })();
  }, [diaSel?.id]);

  // cuando eliges excepción -> precargar editor + cargar bloques
  useEffect(() => {
    (async () => {
      setError(null);

      if (!exSel?.id) {
        // reset editor
        setExFecha(todayISO());
        setExActivo(true);
        setExHoraInicio("");
        setExHoraFin("");
        setExNota("");
        setBloquesEx([]);
        return;
      }

      setExFecha(exSel.fecha);
      setExActivo(exSel.activo);
      setExHoraInicio(fromHHMMSS(exSel.hora_inicio));
      setExHoraFin(fromHHMMSS(exSel.hora_fin));
      setExNota(exSel.nota ?? "");

      setCargandoBloquesEx(true);
      try {
        const r = await api.get(
          `/admin/plantillas/excepciones/${exSel.id}/bloques`,
        );
        setBloquesEx(Array.isArray(r.data) ? r.data : []);
      } catch (e) {
        setError(apiErrorMessage(e));
      } finally {
        setCargandoBloquesEx(false);
      }
    })();
  }, [exSel?.id]);

  // -----------------------
  // Actions
  // -----------------------
  async function crearPlantilla() {
    const nombre = window.prompt("Nombre de plantilla:");
    if (!nombre?.trim()) return;

    setError(null);
    try {
      const r = await api.post("/admin/plantillas", {
        nombre: nombre.trim(),
        descripcion: null,
        tipo: "semanal",
      });

      await loadPlantillas();
      setSel(r.data);
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  }

  async function guardarDiaSemana() {
    if (!detalle?.plantilla?.id) return;

    if (!diaHoraInicio || !diaHoraFin) {
      setError("hora_inicio y hora_fin son obligatorias");
      return;
    }
    if (diaHoraInicio >= diaHoraFin) {
      setError("hora_fin debe ser posterior a hora_inicio");
      return;
    }

    const hayBloques = bloquesDia.length > 0;

    if (hayBloques) {
      const ok = window.confirm(
        "Has cambiado el rango del día. Los bloques actuales pueden quedar fuera de rango o no ser contiguos.\n\n¿Quieres resetear los bloques y continuar?",
      );
      if (!ok) return;
    }

    setSavingDia(true);
    setError(null);

    try {
      await api.put(
        `/admin/plantillas/${detalle.plantilla.id}/dias/${diaSemanaSel}`,
        {
          hora_inicio: toHHMMSS(diaHoraInicio),
          hora_fin: toHHMMSS(diaHoraFin),
          activo: diaActivo,
        },
      );

      // Si había bloques y el usuario aceptó, los borramos
      if (hayBloques && diaSel?.id) {
        await api.put(`/admin/plantillas/dias/${diaSel.id}/bloques`, {
          bloques: [],
        });
        setBloquesDia([]);
      }

      await loadDetalle(detalle.plantilla.id);
      showSuccess('Rango guardado correctamente');
    } catch (e) {
      const msg = apiErrorMessage(e);
      setError(msg);
      showError(msg);
    } finally {
      setSavingDia(false);
    }
  }

  async function guardarBloquesDia(next: Bloque[]) {
    if (!diaSel?.id) {
      setError("Primero define el rango del día (hora inicio/fin).");
      return;
    }

    setSavingBloquesDia(true);
    setError(null);
    try {
      await api.put(`/admin/plantillas/dias/${diaSel.id}/bloques`, {
        bloques: next,
      });

      const r = await api.get(`/admin/plantillas/dias/${diaSel.id}/bloques`);
      setBloquesDia(Array.isArray(r.data) ? r.data : []);
      showSuccess('Bloques guardados correctamente');
    } catch (e) {
      const msg = apiErrorMessage(e);
      setError(msg);
      showError(msg);
    } finally {
      setSavingBloquesDia(false);
    }
  }

  async function upsertExcepcion() {
    if (!detalle?.plantilla?.id) return;

    if (!exFecha) {
      setError("fecha es obligatoria");
      return;
    }
    if (exHoraInicio && exHoraFin && exHoraInicio >= exHoraFin) {
      setError("En excepción: hora_fin debe ser posterior a hora_inicio");
      return;
    }

    setSavingEx(true);
    setError(null);
    try {
      const r = await api.put(
        `/admin/plantillas/${detalle.plantilla.id}/excepciones/${exFecha}`,
        {
          activo: exActivo,
          hora_inicio: exHoraInicio ? toHHMMSS(exHoraInicio) : null,
          hora_fin: exHoraFin ? toHHMMSS(exHoraFin) : null,
          nota: exNota?.trim() || null,
        },
      );

      await loadDetalle(detalle.plantilla.id);

      // Selecciona la excepción retornada por backend
      setExSel(r.data);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSavingEx(false);
    }
  }
  async function renombrarPlantilla(newName: string) {
    if (!detalle?.plantilla?.id) return;
    if (!newName?.trim()) return;

    setSavingRename(true);
    setError(null);

    try {
      await api.patch(`/admin/plantillas/${detalle.plantilla.id}`, {
        nombre: newName.trim(),
      });

      await loadPlantillas();
      await loadDetalle(detalle.plantilla.id);

      setShowRename(false);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSavingRename(false);
    }
  }

  async function eliminarPlantilla() {
    if (!detalle?.plantilla?.id) return;

    setSavingDelete(true);
    setError(null);

    try {
      await api.delete(`/admin/plantillas/${detalle.plantilla.id}`);

      setSel(null);
      setDetalle(null);
      setShowDelete(false);

      await loadPlantillas();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSavingDelete(false);
    }
  }

  async function guardarBloquesEx(next: Bloque[]) {
    if (!exSel?.id) {
      setError("Primero crea/selecciona una excepción.");
      return;
    }

    // si has definido rango, backend exige dentro del rango; si no, lo permite.
    // aquí no bloqueamos; dejamos que el backend sea la fuente de verdad.

    setSavingBloquesEx(true);
    setError(null);
    try {
      await api.put(`/admin/plantillas/excepciones/${exSel.id}/bloques`, {
        bloques: next,
      });

      const r = await api.get(
        `/admin/plantillas/excepciones/${exSel.id}/bloques`,
      );
      setBloquesEx(Array.isArray(r.data) ? r.data : []);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSavingBloquesEx(false);
    }
  }

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
      {/* LISTA PLANTILLAS */}
      <div className="bg-white border rounded p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Plantillas</h2>
          <button
            className="px-3 py-2 rounded bg-green-600 text-white"
            onClick={crearPlantilla}
          >
            + Nueva
          </button>
        </div>

        <div className="space-y-2">
          {plantillas.map((p) => (
            <button
              key={p.id}
              className={`w-full text-left px-3 py-2 rounded border ${
                sel?.id === p.id
                  ? "bg-blue-50 border-blue-300"
                  : "hover:bg-gray-50"
              }`}
              onClick={() => setSel(p)}
            >
              <div className="font-semibold">{p.nombre}</div>
              <div className="text-xs text-gray-600">
                Tipo: {p.tipo} · {p.activo ? "Activa" : "Inactiva"}
              </div>
            </button>
          ))}

          {plantillas.length === 0 && (
            <div className="text-sm text-gray-600">
              No hay plantillas todavía.
            </div>
          )}
        </div>
      </div>

      {/* DETALLE PLANTILLA */}
      <div className="bg-white border rounded p-4 space-y-4">
        {!detalle ? (
          <div className="text-gray-600">
            Selecciona una plantilla para editarla.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-xl font-bold">
                  {detalle.plantilla.nombre}
                </h2>
                <div className="text-sm text-gray-600">
                  Editor semanal + bloques + excepciones
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  className="px-3 py-2 rounded bg-gray-200"
                  onClick={() => setShowRename(true)}
                >
                  Renombrar
                </button>

                <button
                  className="px-3 py-2 rounded bg-red-600 text-white"
                  onClick={() => setShowDelete(true)}
                >
                  Eliminar
                </button>

                <button
                  className="px-3 py-2 rounded bg-gray-200"
                  onClick={() => loadDetalle(detalle.plantilla.id)}
                >
                  Refrescar
                </button>
              </div>
            </div>

            {error ? (
              <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded text-sm">
                {error}
              </div>
            ) : null}

            {/* Semana */}
            <div className="border rounded p-3 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="font-semibold">Semana</div>

                <div className="flex gap-2 flex-wrap">
                  <button
                    className="px-3 py-2 rounded bg-gray-200"
                    onClick={() => setShowCopy(true)}
                  >
                    Copiar a otros días
                  </button>
                  <button
                    disabled={resettingDay}
                    className="
                      px-3 py-2 rounded
                      bg-yellow-500 text-white
                      disabled:opacity-50
                      disabled:cursor-not-allowed

                    "
                    onClick={async () => {
                      if (!diaSel?.id || resettingDay) return;

                      const ok = confirm("¿Resetear este día completamente?");
                      if (!ok) return;

                      try {
                        setResettingDay(true);

                        await api.put(
                          `/admin/plantillas/dias/${diaSel.id}/reset`,
                        );

                        // FIX: Actualizar UI localmente porque el ID del día no cambia
                        setBloquesDia([]); // Limpiar bloques en vista

                        await loadDetalle(detalle.plantilla.id);
                        showSuccess('Día reseteado correctamente');
                      } catch (e) {
                        const msg = apiErrorMessage(e);
                        setError(msg);
                        showError(msg);
                      } finally {
                        setResettingDay(false);
                      }
                    }}
                  >
                    {resettingDay ? "Reseteando..." : "Resetear día"}
                  </button>

                  <button
                    className="px-3 py-2 rounded bg-black text-white disabled:opacity-60"
                    disabled={savingDia}
                    onClick={guardarDiaSemana}
                  >
                    {savingDia ? "Guardando..." : "Guardar rango día"}
                  </button>
                </div>
              </div>

              <div className="flex gap-2 flex-wrap">
                {DIAS.map((d) => (
                  <button
                    key={d.n}
                    className={`px-3 py-2 rounded ${
                      diaSemanaSel === d.n
                        ? "bg-blue-600 text-white"
                        : "bg-gray-200"
                    }`}
                    onClick={() => setDiaSemanaSel(d.n)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              {detalle && (
                <>
                  <RenamePlantillaModal
                    open={showRename}
                    loading={savingRename}
                    onClose={() => !savingRename && setShowRename(false)}
                    currentName={detalle.plantilla.nombre}
                    onConfirm={renombrarPlantilla}
                  />

                  <DeletePlantillaModal
                    open={showDelete}
                    loading={savingDelete}
                    onClose={() => !savingDelete && setShowDelete(false)}
                    name={detalle.plantilla.nombre}
                    onConfirm={eliminarPlantilla}
                  />
                  <CopyDiasModal
                    open={showCopy}
                    origen={diaSemanaSel}
                    origenLabel={origenLabel}
                    loading={copying}
                    onClose={() => setShowCopy(false)}
                    onConfirm={async (dias: number[], reset: boolean) => {
                      if (copying) return;

                      if (!dias.length) {
                        setError("Selecciona al menos un día");
                        return;
                      }

                      try {
                        setCopying(true);

                        await api.post(
                          `/admin/plantillas/${detalle.plantilla.id}/replicar-dia-base`,
                          {
                            dia_origen: diaSemanaSel,
                            dias_destino: dias,
                            sobrescribir: reset,
                          },
                        );

                        await loadDetalle(detalle.plantilla.id);
                        setShowCopy(false);
                        showSuccess(`Configuración copiada a ${dias.length} día${dias.length > 1 ? 's' : ''}`);
                      } catch (e) {
                        const msg = apiErrorMessage(e);
                        setError(msg);
                        showError(msg);
                      } finally {
                        setCopying(false);
                      }
                    }}
                  />
                </>
              )}

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-gray-600">Hora inicio</label>
                  <input
                    type="time"
                    className="border p-2 rounded w-full"
                    value={diaHoraInicio}
                    onChange={(e) => setDiaHoraInicio(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600">Hora fin</label>
                  <input
                    type="time"
                    className="border p-2 rounded w-full"
                    value={diaHoraFin}
                    onChange={(e) => setDiaHoraFin(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600">Activo</label>
                  <select
                    className="border p-2 rounded w-full"
                    value={diaActivo ? "1" : "0"}
                    onChange={(e) => setDiaActivo(e.target.value === "1")}
                  >
                    <option value="1">Sí</option>
                    <option value="0">No</option>
                  </select>
                </div>

                <div className="text-sm text-gray-700 flex items-end">
                  <div>
                    <b>Día:</b> {DIAS.find((x) => x.n === diaSemanaSel)?.label}
                    <div>
                      <b>Rango actual:</b>{" "}
                      {diaSel?.hora_inicio && diaSel?.hora_fin
                        ? `${diaSel.hora_inicio} - ${diaSel.hora_fin}`
                        : "No definido"}
                    </div>
                  </div>
                </div>
              </div>

              {cargandoBloquesDia ? (
                <div className="p-4">
                    <LoadingSpinner showText={false} />
                </div>
              ) : (
                <div
                  className={
                    savingBloquesDia ? "opacity-60 pointer-events-none" : ""
                  }
                >
                  <BloquesEditor
                    title="Bloques del día"
                    bloques={bloquesDia}
                    onChange={setBloquesDia}
                    onSave={() => guardarBloquesDia(bloquesDia)}
                    rangoInicio={diaHoraInicio}
                    rangoFin={diaHoraFin}
                    clientes={clientes}
                  />
                  {savingBloquesDia ? (
                    <div className="text-xs text-gray-600">
                      Guardando bloques...
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* Excepciones */}
            <div className="border rounded p-3 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="font-semibold">Excepciones por fecha</div>
                <button
                  className="px-3 py-2 rounded bg-black text-white disabled:opacity-60"
                  disabled={savingEx}
                  onClick={upsertExcepcion}
                >
                  {savingEx ? "Guardando..." : "Guardar excepción"}
                </button>
              </div>

              {/* Selector/lista de excepciones existentes */}
              <div className="flex gap-2 flex-wrap">
                {(detalle.excepciones || []).map((ex) => (
                  <button
                    key={ex.id}
                    className={`px-3 py-2 rounded border ${
                      exSel?.id === ex.id
                        ? "bg-blue-50 border-blue-300"
                        : "bg-gray-100"
                    }`}
                    onClick={() => setExSel(ex)}
                  >
                    {ex.fecha}
                  </button>
                ))}
                {(!detalle.excepciones || detalle.excepciones.length === 0) && (
                  <div className="text-sm text-gray-600">
                    No hay excepciones.
                  </div>
                )}
              </div>

              {/* Editor excepción */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <div>
                  <label className="text-xs text-gray-600">Fecha</label>
                  <input
                    className="border p-2 rounded w-full"
                    type="date"
                    value={exFecha}
                    onChange={(e) => setExFecha(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600">
                    Hora inicio (opcional)
                  </label>
                  <input
                    type="time"
                    className="border p-2 rounded w-full"
                    value={exHoraInicio}
                    onChange={(e) => setExHoraInicio(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600">
                    Hora fin (opcional)
                  </label>
                  <input
                    type="time"
                    className="border p-2 rounded w-full"
                    value={exHoraFin}
                    onChange={(e) => setExHoraFin(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600">Activo</label>
                  <select
                    className="border p-2 rounded w-full"
                    value={exActivo ? "1" : "0"}
                    onChange={(e) => setExActivo(e.target.value === "1")}
                  >
                    <option value="1">Sí</option>
                    <option value="0">No</option>
                  </select>
                </div>

                <div className="md:col-span-5">
                  <label className="text-xs text-gray-600">
                    Nota (opcional)
                  </label>
                  <input
                    className="border p-2 rounded w-full"
                    value={exNota}
                    onChange={(e) => setExNota(e.target.value)}
                    placeholder="Ej: horario reducido por evento, turno especial..."
                  />
                </div>
              </div>

              {/* Bloques excepción */}
              {exSel ? (
                cargandoBloquesEx ? (
                  <div className="text-sm text-gray-600">
                    Cargando bloques excepción...
                  </div>
                ) : (
                  <div
                    className={
                      savingBloquesEx ? "opacity-60 pointer-events-none" : ""
                    }
                  >
                    <BloquesEditor
                      title={`Bloques excepción (${exSel.fecha})`}
                      bloques={bloquesEx}
                      onChange={setBloquesEx}
                      onSave={() => guardarBloquesEx(bloquesEx)}
                    />
                    {savingBloquesEx ? (
                      <div className="text-xs text-gray-600">
                        Guardando bloques...
                      </div>
                    ) : null}
                  </div>
                )
              ) : (
                <div className="text-sm text-gray-600">
                  Selecciona una excepción existente o crea una nueva con la
                  fecha y “Guardar excepción”.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
