"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { pdfToPngFiles } from "@/lib/pdfToImages";
import { ocrPreview, ocrReparse, ocrConfirm } from "@/services/calendarioOCR";
import { showSuccess, showError } from "@/lib/toast";

type Meta = {
  confidence?: number;
  reason?: string;
  source_line?: string;
};

type Tipo = "festivo_local" | "convenio" | "laborable_extra" | "cierre_empresa";

type Item = {
  fecha: string;
  tipo: Tipo;
  descripcion: string | null;
  es_laborable: boolean;
  activo: boolean;
  label?: string | null; // nacional/autonómico/local/convenio/etc.
  origen?: "ocr" | "manual";
  meta?: Meta;
};

function pct(n?: number) {
  if (typeof n !== "number") return "—";
  return `${Math.round(n * 100)}%`;
}

function ymdToday() {
  return new Date().toISOString().slice(0, 10);
}

function autoLaborableForTipo(tipo: Tipo) {
  return !(tipo === "festivo_local" || tipo === "cierre_empresa");
}

function confidenceClass(c?: number) {
  const v = typeof c === "number" ? c : 1;
  if (v < 0.6) return "text-red-600";
  if (v < 0.8) return "text-amber-600";
  return "text-foreground";
}

export default function ImportarCalendarioLaboralPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<string>("");

  const [rawText, setRawText] = useState<string>("");
  const [preview, setPreview] = useState<Item[]>([]);
  const [activeTab, setActiveTab] = useState<"editor" | "preview">("preview"); // móvil

  function resetWorkspace() {
    setRawText("");
    setPreview([]);
    setStage("");
    setActiveTab("preview");
  }

  function onPickFile(f: File | null) {
    setFile(f);
    // Reset total al cambiar archivo (evita mezclas y errores)
    resetWorkspace();
  }

  const stats = useMemo(() => {
    const total = preview.length;
    const activeCount = preview.filter((x) => x.activo !== false).length;
    const disabledCount = total - activeCount;

    const festivos = preview.filter((x) => x.tipo === "festivo_local").length;
    const convenios = preview.filter((x) => x.tipo === "convenio").length;
    const cierres = preview.filter((x) => x.tipo === "cierre_empresa").length;
    const extras = preview.filter((x) => x.tipo === "laborable_extra").length;

    const lowConfidence = preview.filter(
      (x) => (x.meta?.confidence ?? 1) < 0.6,
    ).length;
    const manualCount = preview.filter((x) => x.origen === "manual").length;

    return {
      total,
      activeCount,
      disabledCount,
      festivos,
      convenios,
      cierres,
      extras,
      lowConfidence,
      manualCount,
    };
  }, [preview]);

  function updateItem(idx: number, patch: Partial<Item>) {
    setPreview((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, ...patch };

        // coherencia automática: si cambia tipo a festivo/cierre → no laborable
        if (patch.tipo) {
          next.es_laborable = autoLaborableForTipo(patch.tipo);
          // si pasa a festivo y no hay label, pon local por defecto (editable)
          if (patch.tipo === "festivo_local" && !next.label)
            next.label = "local";
          // si pasa a convenio/cierre/extra, limpiamos label si era ámbito
          if (
            patch.tipo !== "festivo_local" &&
            (next.label === "nacional" ||
              next.label === "autonómico" ||
              next.label === "local")
          ) {
            next.label =
              patch.tipo === "convenio"
                ? "convenio"
                : patch.tipo === "cierre_empresa"
                  ? "cierre"
                  : "extra";
          }
        }

        // Si el usuario marca manualmente laborable en festivo, lo respetamos si viene explícito
        if (typeof patch.es_laborable === "boolean")
          next.es_laborable = patch.es_laborable;

        // Si editan la fila, mantenemos origen si ya estaba
        next.origen = next.origen || "ocr";

        return next;
      }),
    );
  }

  function removeItem(idx: number) {
    setPreview((prev) => prev.filter((_, i) => i !== idx));
  }

  function addManualRow() {
    setPreview((prev) => [
      ...prev,
      {
        fecha: ymdToday(),
        tipo: "festivo_local",
        descripcion: "",
        es_laborable: false,
        activo: true,
        label: "local",
        origen: "manual",
        meta: { confidence: 1, reason: "manual" },
      },
    ]);
    setActiveTab("preview");
  }

  async function handleAnalyze() {
    if (!file) return;

    try {
      setLoading(true);
      setStage("Preparando documento…");

      let filesToSend: File[] = [];

      if (
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf")
      ) {
        setStage("Convirtiendo PDF a imágenes…");
        filesToSend = await pdfToPngFiles(file, 12);
      } else {
        filesToSend = [file];
      }

      setStage("Ejecutando OCR…");
      const res = await ocrPreview(filesToSend);

      setRawText(res.raw_text || "");
      // Marcamos origen OCR en items por consistencia
      const items: Item[] = (res.preview || []).map((it: any) => ({
        ...it,
        origen: "ocr",
      }));
      setPreview(items);

      setActiveTab("preview");
    } catch (e: any) {
      showError(e?.response?.data?.error || e?.message || "Error OCR");
    } finally {
      setLoading(false);
      setStage("");
    }
  }

  async function handleReparse() {
    try {
      if (!rawText || rawText.trim().length < 20) {
        showError("El texto OCR está vacío o demasiado corto.");
        return;
      }
      setLoading(true);
      setStage("Re-analizando texto…");
      const res = await ocrReparse(rawText);
      const items: Item[] = (res.preview || []).map((it: any) => ({
        ...it,
        origen: "ocr",
      }));
      setPreview(items);
      setActiveTab("preview");
    } catch (e: any) {
      showError(e?.response?.data?.error || e?.message || "Error reparse");
    } finally {
      setLoading(false);
      setStage("");
    }
  }

  async function handleConfirm() {
    try {
      if (loading) return;
      if (preview.length === 0) {
        showError("No hay entradas para confirmar.");
        return;
      }

      const activeItems = preview.filter((x) => x.activo !== false);

      if (activeItems.length === 0) {
        showError(
          "Todas las entradas están desactivadas. Activa al menos una antes de confirmar.",
        );
        return;
      }

      setLoading(true);
      setStage("Guardando en calendario…");

      await ocrConfirm({
        items: activeItems.map((x) => ({
          ...x,
          origen: x.origen === "manual" ? "manual" : "ocr",
        })),
        raw_text: rawText,
      });

      showSuccess("Importación completada. El calendario ha sido actualizado.");
      setFile(null);
      resetWorkspace();

      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e: any) {
      showError(e?.response?.data?.error || e?.message || "Error al confirmar");
    } finally {
      setLoading(false);
      setStage("");
    }
  }
  const canReparse = !loading && rawText.trim().length >= 20;
  const canConfirm = !loading && preview.length > 0 && stats.activeCount > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Importar calendario laboral</h1>
        <p className="text-sm text-muted-foreground">
          Importa un calendario (PDF o imagen), revisa el resultado y confirma.
          Festivos y ajustes quedarán consistentes para Admin y Empleados.
        </p>
      </div>

      {/* Card: uploader */}
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <div className="font-medium">1) Documento</div>
            <div className="text-sm text-muted-foreground">
              PDF recomendado (nítido). Máximo 12 páginas por importación.
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*"
              onChange={(e) => onPickFile(e.target.files?.[0] || null)}
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setFile(null);
                resetWorkspace();
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              disabled={loading && !file}
            >
              Limpiar
            </Button>

            <Button onClick={handleAnalyze} disabled={!file || loading}>
              {loading ? "Procesando…" : "Analizar"}
            </Button>
          </div>
        </div>

        {loading && (
          <div className="text-sm text-muted-foreground">
            {stage || "Procesando…"}
          </div>
        )}
      </div>

      {/* Workspace */}
      {(rawText || preview.length > 0) && (
        <div className="bg-card border rounded-lg p-4 md:p-6 space-y-4">
          {/* Header workspace */}
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <div className="font-medium">2) Revisión asistida</div>
              <div className="text-sm text-muted-foreground">
                Total: {stats.total} · Activas: {stats.activeCount} ·
                Desactivadas: {stats.disabledCount}
                {" · "}
                Festivos: {stats.festivos} · Convenio: {stats.convenios} ·
                Cierres: {stats.cierres} · Extras: {stats.extras}
                {stats.manualCount > 0
                  ? ` · Manuales: ${stats.manualCount}`
                  : ""}
                {stats.lowConfidence > 0
                  ? ` · Revisión sugerida: ${stats.lowConfidence}`
                  : ""}
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button
                variant="secondary"
                onClick={addManualRow}
                disabled={loading}
              >
                Añadir día manual
              </Button>
              <Button
                variant="secondary"
                onClick={handleReparse}
                disabled={!canReparse}
              >
                Reanalizar texto
              </Button>
              <Button onClick={handleConfirm} disabled={!canConfirm}>
                Confirmar importación
              </Button>
            </div>
          </div>

          {/* Tabs móvil */}
          <div className="md:hidden flex gap-2">
            <button
              className={`flex-1 border rounded px-3 py-2 text-sm ${activeTab === "preview" ? "bg-muted" : ""}`}
              onClick={() => setActiveTab("preview")}
            >
              Vista previa
            </button>
            <button
              className={`flex-1 border rounded px-3 py-2 text-sm ${activeTab === "editor" ? "bg-muted" : ""}`}
              onClick={() => setActiveTab("editor")}
            >
              Editor OCR
            </button>
          </div>

          {/* Workspace fijo con scroll independiente (desktop) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:h-[72vh]">
            {/* Editor */}
            <div
              className={`${activeTab === "editor" ? "" : "hidden"} md:block h-full`}
            >
              <div className="h-full border rounded-lg flex flex-col">
                <div className="px-3 py-2 border-b bg-muted/40 flex items-center justify-between">
                  <div className="text-sm font-medium">Editor de texto OCR</div>
                  <div className="text-xs text-muted-foreground">
                    Edita y pulsa <b>Reanalizar</b>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                  <textarea
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    className="w-full h-full min-h-[360px] p-3 text-xs leading-5 outline-none resize-none bg-background"
                    placeholder="Aquí aparecerá el texto detectado por OCR…"
                  />
                </div>

                <div className="px-3 py-2 border-t text-xs text-muted-foreground">
                  Consejo: corrige palabras clave (“convenio”, “festivo
                  autonómico”, “fiesta nacional”) para mejorar el parseado.
                </div>
              </div>
            </div>

            {/* Preview */}
            <div
              className={`${activeTab === "preview" ? "" : "hidden"} md:block h-full`}
            >
              <div className="h-full border rounded-lg flex flex-col">
                <div className="px-3 py-2 border-b bg-muted/40 flex items-center justify-between">
                  <div className="text-sm font-medium">
                    Vista previa (editable)
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Se guardarán <b>{stats.activeCount}</b> días
                    {stats.disabledCount > 0
                      ? ` · ${stats.disabledCount} desactivados`
                      : ""}
                  </div>
                </div>

                {/* Tabla con scroll propio */}
                <div className="flex-1 overflow-auto">
                  <table className="min-w-[980px] w-full text-sm">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="p-2 border-b">Fecha</th>
                        <th className="p-2 border-b">Tipo</th>
                        <th className="p-2 border-b">Ámbito</th>
                        <th className="p-2 border-b">Descripción</th>
                        <th className="p-2 border-b text-center">Laborable</th>
                        <th className="p-2 border-b text-center">Activo</th>
                        <th className="p-2 border-b text-center">Origen</th>
                        <th className="p-2 border-b text-center">Conf.</th>
                        <th className="p-2 border-b"></th>
                      </tr>
                    </thead>

                    <tbody>
                      {preview.map((it, idx) => {
                        const conf =
                          it.meta?.confidence ??
                          (it.origen === "manual" ? 1 : 0.9);
                        const low = conf < 0.6;
                        const manual = it.origen === "manual";

                        return (
                          <tr
                            key={idx}
                            className={[
                              "odd:bg-background even:bg-muted/20",
                              low ? "bg-red-50" : "",
                            ].join(" ")}
                          >
                            <td className="p-2 align-top">
                              <input
                                type="date"
                                value={it.fecha}
                                onChange={(e) =>
                                  updateItem(idx, { fecha: e.target.value })
                                }
                                className="border rounded px-2 py-1"
                              />
                            </td>

                            <td className="p-2 align-top">
                              <select
                                value={it.tipo}
                                onChange={(e) =>
                                  updateItem(idx, {
                                    tipo: e.target.value as Tipo,
                                  })
                                }
                                className="border rounded px-2 py-1"
                              >
                                <option value="festivo_local">Festivo</option>
                                <option value="convenio">
                                  Convenio / ajuste
                                </option>
                                <option value="laborable_extra">
                                  Laborable extra
                                </option>
                                <option value="cierre_empresa">
                                  Cierre empresa
                                </option>
                              </select>
                            </td>

                            <td className="p-2 align-top">
                              <select
                                value={it.label || ""}
                                onChange={(e) =>
                                  updateItem(idx, {
                                    label: e.target.value || null,
                                  })
                                }
                                className="border rounded px-2 py-1"
                              >
                                <option value="">—</option>
                                <option value="nacional">Nacional</option>
                                <option value="autonómico">Autonómico</option>
                                <option value="local">Local</option>
                                <option value="convenio">Convenio</option>
                                <option value="cierre">Cierre</option>
                                <option value="extra">Extra</option>
                              </select>
                            </td>

                            <td className="p-2 align-top">
                              <input
                                type="text"
                                value={it.descripcion || ""}
                                onChange={(e) =>
                                  updateItem(idx, {
                                    descripcion: e.target.value,
                                  })
                                }
                                className="border rounded px-2 py-1 w-full"
                              />
                              {it.meta?.source_line && (
                                <div className="mt-1 text-[11px] text-muted-foreground">
                                  <span className="font-medium">OCR:</span>{" "}
                                  <span className="line-clamp-1">
                                    {it.meta.source_line}
                                  </span>
                                </div>
                              )}
                            </td>

                            <td className="p-2 align-top text-center">
                              <input
                                type="checkbox"
                                checked={it.es_laborable}
                                onChange={(e) =>
                                  updateItem(idx, {
                                    es_laborable: e.target.checked,
                                  })
                                }
                              />
                            </td>

                            <td className="p-2 align-top text-center">
                              <input
                                type="checkbox"
                                checked={it.activo !== false}
                                onChange={(e) =>
                                  updateItem(idx, { activo: e.target.checked })
                                }
                              />
                            </td>

                            <td className="p-2 align-top text-center">
                              <span
                                className={
                                  manual
                                    ? "text-blue-700"
                                    : "text-muted-foreground"
                                }
                              >
                                {manual ? "manual" : "ocr"}
                              </span>
                            </td>

                            <td className="p-2 align-top text-center">
                              <span
                                className={confidenceClass(conf)}
                                title={it.meta?.reason || ""}
                              >
                                {pct(conf)}
                              </span>
                            </td>

                            <td className="p-2 align-top text-right">
                              <button
                                className="text-sm text-red-600 hover:underline"
                                onClick={() => removeItem(idx)}
                              >
                                Eliminar
                              </button>
                            </td>
                          </tr>
                        );
                      })}

                      {preview.length === 0 && (
                        <tr>
                          <td
                            className="p-3 text-sm text-muted-foreground"
                            colSpan={9}
                          >
                            No hay entradas detectadas todavía.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="px-3 py-2 border-t text-xs text-muted-foreground">
                  Al confirmar, se guardan las filas <b>activas</b>. Si una
                  fecha ya existe para la empresa, se actualizará (empresa +
                  fecha).
                </div>
              </div>
            </div>
          </div>

          {/* Protecciones: avisos pro */}
          {stats.lowConfidence > 0 && (
            <div className="text-sm border rounded-lg p-3 bg-amber-50">
              <span className="font-medium">Revisión sugerida:</span> hay{" "}
              {stats.lowConfidence} filas con baja confianza. Revisa la
              descripción o corrige el texto OCR y pulsa “Reanalizar”.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
