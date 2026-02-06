"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/services/api";
import { useIsMobile } from "@/hooks/useIsMobile";
import IOSDrawer, { IOSDrawerHeader } from "@/components/ui/IOSDrawer";
import ModalAdjuntoFullscreen from "@/components/ui/ModalAdjuntoFullscreen";

type Adjunto = {
  id: string;
  ausencia_id: string;
  storage_path: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  creado_por: string | null;
};

type UiAdjunto = {
  id: string;
  url: string; // URL firmada / pública (placeholder ahora)
  nombre: string;
  mime?: string | null;
  size?: number | null;
};

const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg"]);

function fmtBytes(n?: number | null) {
  if (!n) return "";
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function guessName(a: UiAdjunto) {
  return a.nombre || "Documento";
}

export default function AusenciaAdjuntosPanel({
  ausenciaId,
  canDelete,
  title = "Documentos adjuntos",
}: {
  ausenciaId: string;
  canDelete: boolean; // solo admin -> true
  title?: string;
}) {
  const isMobile = useIsMobile();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [adjuntos, setAdjuntos] = useState<UiAdjunto[]>([]);
  const [preview, setPreview] = useState<UiAdjunto | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // ----------------------------
  // BACKEND PLACEHOLDERS (cambiar luego)
  // ----------------------------
  async function fetchAdjuntos() {
    // TODO: GET /ausencias/:id/adjuntos (o el endpoint que decidas)
    // Por ahora: intentar leer de backend si existe (si no, devolver [])
    try {
      const res = await api.get(`/empleado/ausencias/${ausenciaId}/adjuntos`);
      const rows: Adjunto[] = Array.isArray(res.data) ? res.data : [];
      return rows.map<UiAdjunto>((r) => ({
        id: r.id,
        // TODO: aquí normalmente pides signedUrl al backend o construyes URL pública
        url: `/ficticio/${encodeURIComponent(r.storage_path)}`,
        nombre: r.filename || r.storage_path.split("/").pop() || "Documento",
        mime: r.mime_type,
        size: r.size_bytes,
      }));
    } catch {
      return [];
    }
  }

  async function uploadAdjuntos(files: File[]) {
    // TODO: POST /ausencias/:id/adjuntos (multipart)
    // Placeholder: simulación de “subida” sin backend real
    const now = Date.now();
    const fake = files.map<UiAdjunto>((f, i) => ({
      id: `tmp-${now}-${i}`,
      url: URL.createObjectURL(f),
      nombre: f.name,
      mime: f.type,
      size: f.size,
    }));
    setAdjuntos((prev) => [...fake, ...prev]);
  }

  async function deleteAdjunto(adjuntoId: string) {
    // TODO: DELETE /ausencias/adjuntos/:id
    try {
      await api.delete(`/ausencias/adjuntos/${adjuntoId}`);
    } catch {
      // si no hay backend aún, igualmente lo quitamos en UI
    }
    setAdjuntos((prev) => prev.filter((x) => x.id !== adjuntoId));
  }

  // ----------------------------
  // LOAD
  // ----------------------------
  async function load() {
    setLoading(true);
    try {
      const list = await fetchAdjuntos();
      setAdjuntos(list);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ausenciaId]);

  // ----------------------------
  // VALIDACIÓN FILES
  // ----------------------------
  function validateFiles(files: File[]) {
    const ok: File[] = [];
    const errors: string[] = [];

    for (const f of files) {
      if (!ALLOWED.has(f.type)) {
        errors.push(`${f.name}: tipo no permitido`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        errors.push(`${f.name}: supera 10 MB`);
        continue;
      }
      ok.push(f);
    }

    if (errors.length) {
      alert(errors.join("\n"));
    }
    return ok;
  }

  async function onPickFiles(fileList: FileList | null) {
    if (!fileList) return;
    const files = Array.from(fileList);
    const valid = validateFiles(files);
    if (!valid.length) return;

    setWorking(true);
    try {
      await uploadAdjuntos(valid);
      // si conectas backend real: después de upload, llama load()
      // await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || "Error subiendo adjuntos");
    } finally {
      setWorking(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function openPreview(a: UiAdjunto) {
    setPreview(a);
    setPreviewOpen(true);
  }

  function closePreview() {
    setPreviewOpen(false);
    setPreview(null);
  }

  // ----------------------------
  // Descarga múltiple (placeholder)
  // ----------------------------
  const canMultiDownload = adjuntos.length > 1;

  function multiDownload() {
    // TODO: Endpoint backend que devuelva ZIP: GET /ausencias/:id/adjuntos.zip
    alert("Descarga múltiple (ZIP) pendiente de backend/producción.");
  }

  const header: IOSDrawerHeader = useMemo(
    () => ({
      title: preview ? guessName(preview) : "Documento",
      canGoBack: true,
      onBack: closePreview,
      onClose: closePreview,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preview]
  );

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">{title}</div>
          <div className="text-xs text-gray-500">
            PDF / PNG / JPG · Máx 10 MB por archivo
          </div>
        </div>

        <div className="flex gap-2">
          {canMultiDownload ? (
            <button
              onClick={multiDownload}
              className="px-3 py-2 rounded-xl border border-black/10 bg-white text-xs font-semibold active:bg-black/[0.04]"
            >
              Descargar todo
            </button>
          ) : null}

          <button
            disabled={working}
            onClick={() => inputRef.current?.click()}
            className="px-3 py-2 rounded-xl bg-black text-white text-xs font-semibold disabled:opacity-60"
          >
            {working ? "Subiendo…" : "Subir"}
          </button>

          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            className="hidden"
            onChange={(e) => onPickFiles(e.target.files)}
          />
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Cargando adjuntos…</div>
      ) : adjuntos.length === 0 ? (
        <div className="text-sm text-gray-500">No hay documentos adjuntos.</div>
      ) : (
        <div className="space-y-2">
          {adjuntos.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-gray-900 truncate">
                  {guessName(a)}
                </div>
                <div className="text-xs text-gray-500">
                  {a.mime ? a.mime : ""}
                  {a.size ? ` · ${fmtBytes(a.size)}` : ""}
                </div>
              </div>

              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => openPreview(a)}
                  className="px-3 py-1.5 rounded-lg border border-black/10 text-xs font-semibold active:bg-black/[0.04]"
                >
                  Ver
                </button>

                <a
                  href={a.url}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-lg border border-black/10 text-xs font-semibold active:bg-black/[0.04]"
                >
                  Descargar
                </a>

                {canDelete ? (
                  <button
                    onClick={() => {
                      if (!confirm("¿Eliminar este adjunto?")) return;
                      deleteAdjunto(a.id);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-red-200 text-xs font-semibold text-red-700 active:bg-red-50"
                  >
                    Borrar
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PREVIEW: móvil -> IOSDrawer, desktop -> Modal */}
      {preview && isMobile === true && previewOpen ? (
        <IOSDrawer open={true} onClose={closePreview} header={header}>
          <div className="h-full">
            <ModalAdjuntoFullscreen
              url={preview.url}
              filename={guessName(preview)}
              onClose={closePreview}
              // si tu Modal ya es fullscreen, esto se verá bien dentro
            />
          </div>
        </IOSDrawer>
      ) : null}

      {preview && (isMobile === false || isMobile === null) && previewOpen ? (
        <ModalAdjuntoFullscreen
          url={preview.url}
          filename={guessName(preview)}
          onClose={closePreview}
        />
      ) : null}
    </div>
  );
}
