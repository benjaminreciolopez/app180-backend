"use client";

import { X, Download } from "lucide-react";

export default function ModalAdjuntoFullscreen({
  url,
  filename,
  onClose,
}: {
  url: string;
  filename?: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[999] bg-black/80 flex flex-col">
      {/* Header */}
      <div className="h-14 px-4 flex items-center justify-between text-white">
        <div className="truncate text-sm font-medium">
          {filename || "Documento"}
        </div>

        <div className="flex items-center gap-3">
          <a
            href={url}
            download={filename}
            target="_blank"
            rel="noreferrer"
            className="w-10 h-10 grid place-items-center rounded-full hover:bg-white/10 active:bg-white/20"
            aria-label="Descargar"
          >
            <Download size={18} />
          </a>

          <button
            onClick={onClose}
            className="w-10 h-10 grid place-items-center rounded-full hover:bg-white/10 active:bg-white/20"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto bg-black flex items-center justify-center p-4">
        {/* Intentamos iframe primero (PDF, etc.) */}
        <iframe
          src={url}
          className="w-full h-full max-w-5xl bg-white rounded-lg"
        />
      </div>
    </div>
  );
}
