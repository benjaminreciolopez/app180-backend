"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";

const API_ENDPOINTS = {
  solicitar: "/empleado/ausencias",
  subirAdjunto: "/empleado/ausencias/adjuntos", // todavía no existe
};

type AdjuntoTemp = { file: File; url: string };

function ymd(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function DrawerSolicitarAusencia({
  tipoInicial,
  onDone,
}: {
  tipoInicial: "vacaciones" | "baja_medica";
  onDone: () => void;
}) {
  const tipo = tipoInicial;

  const [fechaInicio, setFechaInicio] = useState(ymd());
  const [fechaFin, setFechaFin] = useState(ymd());
  const [comentario, setComentario] = useState("");
  const [saving, setSaving] = useState(false);

  const [adjuntos, setAdjuntos] = useState<AdjuntoTemp[]>([]);
  const [ausenciaId, setAusenciaId] = useState<string | null>(null);

  function onFilesSelected(files: FileList | null) {
    if (!files) return;
    const nuevos: AdjuntoTemp[] = Array.from(files).map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    setAdjuntos((prev) => [...prev, ...nuevos]);
  }

  function removeAdjunto(i: number) {
    setAdjuntos((prev) => {
      const copy = [...prev];
      URL.revokeObjectURL(copy[i].url);
      copy.splice(i, 1);
      return copy;
    });
  }

  async function crearAusenciaSiNoExiste() {
    if (ausenciaId) return ausenciaId;

    const res = await api.post(API_ENDPOINTS.solicitar, {
      tipo,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      comentario,
    });

    const id = res.data?.id as string | undefined;
    if (!id) throw new Error("El backend no devolvió id de ausencia");
    setAusenciaId(id);
    return id;
  }

  async function subirAdjuntosSiHay(id: string) {
    if (!adjuntos.length) return;

    try {
      const fd = new FormData();
      adjuntos.forEach((a) => fd.append("file", a.file));

      await api.post(`/empleado/ausencias/${id}/adjuntos`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
    } catch (e: any) {
      console.error("Error subiendo adjuntos", e);
      alert(
        e?.response?.data?.error ||
          "La solicitud se ha guardado, pero la subida de adjuntos falló. Puedes intentarlo más tarde."
      );
    }
  }

  async function enviar() {
    if (!fechaInicio || !fechaFin) {
      alert("Fechas obligatorias");
      return;
    }

    if (fechaInicio > fechaFin) {
      alert("La fecha de inicio no puede ser mayor que la de fin");
      return;
    }

    setSaving(true);

    try {
      const id = await crearAusenciaSiNoExiste();
      await subirAdjuntosSiHay(id);

      alert("Solicitud enviada correctamente");
      onDone();
    } catch (e: any) {
      console.error("Error enviando solicitud:", e);
      alert(
        e?.response?.data?.error || e?.message || "Error enviando solicitud"
      );
    } finally {
      setSaving(false);
    }
  }

  // Limpieza de objectURL al desmontar
  useEffect(() => {
    return () => {
      adjuntos.forEach((a) => URL.revokeObjectURL(a.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subtitle =
    tipo === "vacaciones"
      ? "Solicita tus días de descanso"
      : ausenciaId
      ? "Solicitud creada. Puedes adjuntar partes ahora o más tarde."
      : "Adjunta el parte médico si lo tienes";

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-2xl border border-black/10 bg-white p-4 space-y-3 shadow-sm">
        <div className="text-[15px] font-semibold text-gray-900">
          {tipo === "vacaciones"
            ? "Solicitar vacaciones"
            : "Solicitar baja médica"}
        </div>

        <div className="text-xs text-gray-500">{subtitle}</div>

        <div className="grid grid-cols-1 gap-3">
          <div className="flex gap-3">
            <label className="flex-1 flex flex-col text-[13px] font-medium text-gray-600">
              Inicio
              <input
                type="date"
                className="mt-1 w-full border rounded-xl px-3 py-2"
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
              />
            </label>

            <label className="flex-1 flex flex-col text-[13px] font-medium text-gray-600">
              Fin
              <input
                type="date"
                min={fechaInicio}
                className="mt-1 w-full border rounded-xl px-3 py-2"
                value={fechaFin}
                onChange={(e) => setFechaFin(e.target.value)}
              />
            </label>
          </div>

          <label className="text-sm text-gray-700">
            Comentario (opcional)
            <textarea
              className="mt-1 w-full border rounded-xl px-3 py-2"
              rows={3}
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Ej: cita médica, etc."
            />
          </label>
        </div>
      </div>

      {tipo === "baja_medica" ? (
        <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm space-y-3">
          <div className="text-sm font-semibold">
            Partes/justificantes (opcional)
          </div>

          <label className="block">
            <input
              type="file"
              multiple
              accept="application/pdf,image/png,image/jpeg"
              className="hidden"
              onChange={(e) => onFilesSelected(e.target.files)}
            />
            <div className="w-full py-3 rounded-xl border border-dashed border-black/20 text-center text-sm text-gray-500 cursor-pointer">
              Toca para adjuntar PDF o imagen
            </div>
          </label>

          {adjuntos.length > 0 && (
            <div className="space-y-2">
              {adjuntos.map((a, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <div className="truncate">{a.file.name}</div>
                  <button
                    onClick={() => removeAdjunto(i)}
                    className="px-2 py-1 rounded-lg border text-xs"
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <button
        disabled={saving}
        onClick={enviar}
        className="w-full py-3 rounded-2xl bg-black text-white font-semibold disabled:opacity-60"
      >
        {saving ? "Enviando…" : "Enviar solicitud"}
      </button>
    </div>
  );
}
