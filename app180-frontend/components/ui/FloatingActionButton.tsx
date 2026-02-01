// src/components/ui/FloatingActionButton.tsx
"use client";

import type { ReactNode } from "react";

export default function FloatingActionButton({
  ariaLabel,
  onClick,
  children,
}: {
  ariaLabel: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={ariaLabel}
      onClick={onClick}
      className="
        fixed top-4 right-4 z-50
        w-11 h-11 rounded-full
        bg-white/80 backdrop-blur-md
        border border-black/5
        shadow-[0_10px_25px_-10px_rgba(0,0,0,0.35)]
        flex items-center justify-center
        active:scale-[0.98] transition
      "
    >
      {children}
    </button>
  );
}
