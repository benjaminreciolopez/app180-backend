// src/components/ausencias/AdjuntosViewer.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/services/api";

type Adjunto = {
  id: string;
  ausencia_id: string;
  storage_path: string;
  filename?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  created_at: string;
  creado_por?: string | null;
};

type Props = {
  ausenciaId: string;
  modo: "empleado" | "admin";
  /** si lo pasas, se usa para marcar quién puede borrar (empleado solo los suyos) */
  currentUserId?: string | null;

  /**
   * RUTA FICTICIA (por ahora):
   * - GET:    `${baseUrl}?ausencia_id=...`
   * - POST:   `${baseUrl}` (multipart/form-data)
   * - DELETE: `${baseUrl}/${adjuntoId}`
   */
  baseUrl?: string;

  /** límites */
  maxFiles?: number;
  maxSizeMb?: number;
  allowedMime?: string[];

  /** hooks de UI */
  onChanged?: () => void;
};

function bytesToHuman(n?: number | null) {
  if (!n && n !== 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function isPreviewable(mime?: string | null) {
  if (!mime) return false;
  return mime.startsWith("image/") || mime === "application/pdf";
}

function safeName(a: Adjunto) {
  return (
    a.filename ||
    (a.storage_path ? a.storage_path.split("/").pop() : "") ||
    "archivo"
  );
}

/**
 * ZIP (frontend) sin librerías: usamos CompressionStream si existe.
 * Si no existe, hacemos fallback a descargar uno a uno.
 */
async function downloadAsZipIfPossible(files: { name: string; blob: Blob }[]) {
  const hasCompression =
    typeof (window as any).CompressionStream !== "undefined" &&
    typeof ReadableStream !== "undefined";

  if (!hasCompression) return { ok: false as const, reason: "no-compression" };

  // Nota: esto crea un TAR-like simple NO, necesitamos ZIP real => sin librerías es complejo.
  // Por ahora: si no metemos JSZip, hacemos fallback. Mantengo este placeholder.
  return { ok: false as const, reason: "zip-not-implemented-without-lib" };
}

export default function AdjuntosViewer({
  ausenciaId,
  modo,
  currentUserId = null,
  baseUrl = "/adjuntos/ausencias",
  maxFiles = 10,
  maxSizeMb = 10,
  allowedMime = [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
  ],
  onChanged,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [items, setItems] = useState<Adjunto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Adjunto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const acceptAttr = useMemo(() => allowedMime.join(","), [allowedMime]);
  const maxBytes = useMemo(() => maxSizeMb * 1024 * 1024, [maxSizeMb]);

  const canDelete = useCallback(
    (a: Adjunto) => {
      if (modo === "admin") return true;
      // empleado: solo si coincide creador (si lo tenemos)
      if (!currentUserId) return false;
      return a.creado_por === currentUserId;
    },
    [modo, currentUserId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(baseUrl, {
        params: { ausencia_id: ausenciaId },
      });
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch (e: any) {
      console.error(e);
      setItems([]);
      setError(e?.response?.data?.error || "Error cargando adjuntos");
    } finally {
      setLoading(false);
    }
  }, [baseUrl, ausenciaId]);

  useEffect(() => {
    load();
  }, [load]);

  const validateFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return { ok: false, msg: "Selecciona archivos" };

      if (files.length > maxFiles) {
        return { ok: false, msg: `Máximo ${maxFiles} archivos por subida` };
      }

      for (const f of files) {
        if (!allowedMime.includes(f.type)) {
          return { ok: false, msg: `Tipo no permitido: ${f.name}` };
        }
        if (f.size > maxBytes) {
          return {
            ok: false,
            msg: `Archivo demasiado grande: ${f.name} (máx ${maxSizeMb}MB)`,
          };
        }
      }
      return { ok: true, msg: "" };
    },
    [allowedMime, maxBytes, maxFiles, maxSizeMb]
  );

  const pickFiles = () => inputRef.current?.click();

  const upload = useCallback(
    async (files: File[]) => {
      const v = validateFiles(files);
      if (!v.ok) {
        alert(v.msg);
        return;
      }

      setUploading(true);
      setError(null);
      try {
        const fd = new FormData();
        fd.append("ausencia_id", ausenciaId);

        // multi
        files.forEach((f) => fd.append("files", f));

        // ruta ficticia de backend
        await api.post(baseUrl, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });

        await load();
        onChanged?.();
      } catch (e: any) {
        console.error(e);
        alert(e?.response?.data?.error || "Error subiendo adjuntos");
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [ausenciaId, baseUrl, load, onChanged, validateFiles]
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    upload(files);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    upload(files);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  async function downloadOne(a: Adjunto) {
    setWorkingId(a.id);
    try {
      // Ruta ficticia: GET /adjuntos/ausencias/:id/download devuelve el fichero
      const res = await api.get(`${baseUrl}/${a.id}/download`, {
        responseType: "blob",
      });

      const blob = new Blob([res.data], {
        type: a.mime_type || "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = safeName(a);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error(e);
      alert(e?.response?.data?.error || "Error descargando archivo");
    } finally {
      setWorkingId(null);
    }
  }

  async function downloadAll() {
    if (items.length === 0) return;

    // intentamos ZIP, pero sin JSZip no es viable de forma fiable.
    // Fallback: descarga secuencial.
    const ok = confirm(
      "Se descargarán todos los archivos. (ZIP se añadirá cuando lo pasemos a producción con storage real). ¿Continuar?"
    );
    if (!ok) return;

    for (const a of items) {
      // eslint-disable-next-line no-await-in-loop
      await downloadOne(a);
    }
  }

  async function remove(a: Adjunto) {
    if (!canDelete(a)) return;
    if (!confirm("¿Eliminar este adjunto?")) return;

    setWorkingId(a.id);
    try {
      await api.delete(`${baseUrl}/${a.id}`);
      await load();
      onChanged?.();
      if (preview?.id === a.id) setPreview(null);
    } catch (e: any) {
      console.error(e);
      alert(e?.response?.data?.error || "Error eliminando adjunto");
    } finally {
      setWorkingId(null);
    }
  }

  const previewUrl = useMemo(() => {
    if (!preview) return null;
    // ruta ficticia: sirve el fichero
    return `${baseUrl}/${preview.id}/download`;
  }, [baseUrl, preview]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold text-gray-900">
            Partes / justificantes
          </div>
          <div className="text-xs text-gray-500">
            PDF o imagen. Puedes subir varios y descargar individual o todo.
          </div>
        </div>

        <button
          onClick={load}
          className="text-sm font-semibold px-3 py-2 rounded-xl border border-black/10 bg-white active:bg-black/[0.04]"
        >
          Recargar
        </button>
      </div>

      {/* Upload zone */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900">
              Subir adjuntos
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              Máx {maxFiles} archivos · {maxSizeMb}MB c/u ·{" "}
              {allowedMime.join(", ")}
            </div>
          </div>

          <button
            disabled={uploading}
            onClick={pickFiles}
            className="shrink-0 px-4 py-2.5 rounded-xl bg-black text-white text-sm font-semibold disabled:opacity-60"
          >
            {uploading ? "Subiendo…" : "Elegir"}
          </button>

          <input
            ref={inputRef}
            type="file"
            multiple
            accept={acceptAttr}
            className="hidden"
            onChange={onInputChange}
          />
        </div>

        <div className="mt-3 text-xs text-gray-500">
          En desktop puedes arrastrar archivos aquí.
        </div>
      </div>

      {/* List */}
      <div className="rounded-2xl border border-black/10 bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-4 text-sm text-gray-500">Cargando adjuntos…</div>
        ) : error ? (
          <div className="p-4 text-sm text-red-600">{error}</div>
        ) : items.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">
            No hay adjuntos todavía.
          </div>
        ) : (
          <div>
            <div className="px-4 py-3 border-b border-black/5 flex items-center justify-between gap-3">
              <div className="text-xs text-gray-500">
                {items.length} archivo(s)
              </div>
              <button
                onClick={downloadAll}
                className="text-sm font-semibold px-3 py-2 rounded-xl border border-black/10 bg-white active:bg-black/[0.04]"
              >
                Descargar todo
              </button>
            </div>

            <ul>
              {items.map((a, idx) => {
                const name = safeName(a);
                const canPrev = isPreviewable(a.mime_type);
                const busy = workingId === a.id;

                return (
                  <li key={a.id}>
                    <div className="p-4 flex items-start justify-between gap-3">
                      <button
                        className="min-w-0 text-left"
                        onClick={() =>
                          canPrev ? setPreview(a) : downloadOne(a)
                        }
                      >
                        <div className="text-[14px] font-semibold text-gray-900 truncate">
                          {name}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {a.mime_type || "archivo"} ·{" "}
                          {bytesToHuman(a.size_bytes)}
                        </div>
                      </button>

                      <div className="flex items-center gap-2">
                        {canPrev ? (
                          <button
                            onClick={() => setPreview(a)}
                            className="px-3 py-2 rounded-xl border border-black/10 bg-white text-sm font-semibold active:bg-black/[0.04]"
                          >
                            Ver
                          </button>
                        ) : null}

                        <button
                          disabled={busy}
                          onClick={() => downloadOne(a)}
                          className="px-3 py-2 rounded-xl border border-black/10 bg-white text-sm font-semibold active:bg-black/[0.04] disabled:opacity-50"
                        >
                          {busy ? "…" : "Descargar"}
                        </button>

                        <button
                          disabled={busy || !canDelete(a)}
                          onClick={() => remove(a)}
                          className="px-3 py-2 rounded-xl border border-black/10 bg-white text-sm font-semibold text-red-600 active:bg-black/[0.04] disabled:opacity-40"
                          title={
                            canDelete(a)
                              ? "Eliminar"
                              : "No tienes permisos para eliminar este archivo"
                          }
                        >
                          Borrar
                        </button>
                      </div>
                    </div>

                    {idx !== items.length - 1 ? (
                      <div className="h-px bg-black/5 mx-4" />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Preview modal inline (lo usaremos tanto en iOSDrawer como en Modal desktop) */}
      {preview && (
        <div className="rounded-2xl border border-black/10 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-black/5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 truncate">
                {safeName(preview)}
              </div>
              <div className="text-xs text-gray-500">
                {preview.mime_type || "archivo"} ·{" "}
                {bytesToHuman(preview.size_bytes)}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => downloadOne(preview)}
                className="px-3 py-2 rounded-xl border border-black/10 bg-white text-sm font-semibold active:bg-black/[0.04]"
              >
                Descargar
              </button>
              <button
                onClick={() => setPreview(null)}
                className="px-3 py-2 rounded-xl bg-black text-white text-sm font-semibold"
              >
                Cerrar
              </button>
            </div>
          </div>

          <div className="p-3">
            {preview.mime_type === "application/pdf" ? (
              <iframe
                title="PDF Preview"
                src={previewUrl || ""}
                className="w-full h-[70vh] rounded-xl border border-black/10 bg-white"
              />
            ) : preview.mime_type?.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl || ""}
                alt={safeName(preview)}
                className="w-full max-h-[70vh] object-contain rounded-xl border border-black/10 bg-white"
              />
            ) : (
              <div className="text-sm text-gray-500">
                Vista previa no disponible para este tipo. Usa “Descargar”.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
