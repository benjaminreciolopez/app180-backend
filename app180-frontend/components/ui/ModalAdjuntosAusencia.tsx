// src/components/ui/ModalAdjuntosAusencia.tsx
"use client";

import { useEffect } from "react";
import AdjuntosViewer from "@/components/ausencias/AdjuntosViewer";

export default function ModalAdjuntosAusencia({
  open,
  onClose,
  ausenciaId,
  currentUserId,
  modo,
}: {
  open: boolean;
  onClose: () => void;
  ausenciaId: string;
  currentUserId?: string | null;
  modo: "empleado" | "admin";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999]">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="absolute inset-0 p-4 md:p-10 grid place-items-center">
        <div className="w-full max-w-5xl max-h-[90vh] overflow-auto rounded-2xl bg-white shadow-xl border border-black/10">
          <div className="px-4 py-3 border-b border-black/5 flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900">
              Adjuntos (partes / justificantes)
            </div>
            <button
              onClick={onClose}
              className="px-3 py-2 rounded-xl bg-black text-white text-sm font-semibold"
            >
              Cerrar
            </button>
          </div>

          <div className="p-4">
            <AdjuntosViewer
              ausenciaId={ausenciaId}
              modo={modo}
              currentUserId={currentUserId || null}
              baseUrl="/adjuntos/ausencias"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
