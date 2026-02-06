// src/components/ui/IOSDrawer.tsx
"use client";

import { ReactNode, useEffect } from "react";
import { ChevronLeft, X } from "lucide-react";

export type IOSDrawerHeader = {
  title: string;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
};

export default function IOSDrawer({
  open,
  onClose,
  header,
  children,
  width = "w-full md:w-[420px]",
}: {
  open: boolean;
  onClose: () => void;
  header: IOSDrawerHeader;
  children: ReactNode;
  width?: string;
}) {
  // Lock body scroll (iOS safe)
  useEffect(() => {
    if (!open) return;
    
    // Guardar posición actual
    const scrollY = window.scrollY;
    
    // Aplicar bloqueo
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    
    return () => {
      // Restaurar
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overflow = '';
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/35"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={[
          "absolute right-0 top-0 h-full bg-white",
          "shadow-[0_20px_70px_-30px_rgba(0,0,0,0.6)]",
          "flex flex-col",
          width,
          "animate-ios-slide-in",
        ].join(" ")}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="h-14 px-3 border-b flex items-center justify-between">
          <div className="flex items-center gap-1">
            {header.canGoBack ? (
              <button
                onClick={header.onBack}
                className="w-10 h-10 rounded-full hover:bg-black/5 active:bg-black/10 grid place-items-center"
                aria-label="Volver"
              >
                <ChevronLeft size={18} />
              </button>
            ) : (
              <div className="w-10 h-10" />
            )}

            <div className="font-semibold text-[15px] text-gray-900">
              {header.title}
            </div>
          </div>

          <button
            onClick={header.onClose}
            className="w-10 h-10 rounded-full hover:bg-black/5 active:bg-black/10 grid place-items-center"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain relative">
          <div className="px-0 py-0 min-h-full flex flex-col">{children}</div>
        </div>
      </div>

      {/* Animación */}
      <style jsx global>{`
        @keyframes iosSlideIn {
          from {
            transform: translateX(12px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        .animate-ios-slide-in {
          animation: iosSlideIn 140ms ease-out;
        }
      `}</style>
    </div>
  );
}
