"use client";

import { useRef, useState } from "react";
import { Paperclip, Trash2, Eye, Upload } from "lucide-react";
import ModalAdjuntoFullscreen from "@/components/ui/ModalAdjuntoFullscreen";

export type Adjunto = {
  id: string;
  nombre: string;
  url: string;
};

export default function AdjuntosPanel({
  adjuntos,
  onUpload,
  onDelete,
  readonly = false,
  title = "Documentos adjuntos",
}: {
  adjuntos: Adjunto[];
  onUpload?: (files: FileList) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  readonly?: boolean;
  title?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<Adjunto | null>(null);
  const [working, setWorking] = useState(false);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files || !onUpload) return;
    setWorking(true);
    try {
      await onUpload(e.target.files);
      e.target.value = "";
    } finally {
      setWorking(false);
    }
  }

  async function handleDelete(id: string) {
    if (!onDelete) return;
    if (!confirm("¿Eliminar este adjunto?")) return;
    setWorking(true);
    try {
      await onDelete(id);
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold flex items-center gap-2">
            <Paperclip size={16} />
            {title}
          </div>

          {!readonly && (
            <>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleUpload}
              />
              <button
                disabled={working}
                onClick={() => inputRef.current?.click()}
                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border bg-white hover:bg-black/[0.04] disabled:opacity-50"
              >
                <Upload size={14} />
                Añadir
              </button>
            </>
          )}
        </div>

        {adjuntos.length === 0 ? (
          <div className="text-xs text-gray-500">
            No hay documentos adjuntos.
          </div>
        ) : (
          <div className="space-y-2">
            {adjuntos.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3"
              >
                <div className="truncate text-sm">{a.nombre}</div>

                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => setPreview(a)}
                    className="px-2.5 py-1.5 rounded-lg border text-xs flex items-center gap-1"
                  >
                    <Eye size={14} />
                    Ver
                  </button>

                  <a
                    href={a.url}
                    download
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1.5 rounded-lg border text-xs"
                  >
                    Descargar
                  </a>

                  {!readonly && (
                    <button
                      disabled={working}
                      onClick={() => handleDelete(a.id)}
                      className="px-2.5 py-1.5 rounded-lg border text-xs text-red-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {preview && (
        <ModalAdjuntoFullscreen
          url={preview.url}
          filename={preview.nombre}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
