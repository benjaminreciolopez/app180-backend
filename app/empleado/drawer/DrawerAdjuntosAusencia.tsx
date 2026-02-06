// src/components/empleado/drawer/DrawerAdjuntosAusencia.tsx
"use client";

import IOSDrawer from "@/components/ui/IOSDrawer";
import AdjuntosViewer from "@/components/ausencias/AdjuntosViewer";

export default function DrawerAdjuntosAusencia({
  open,
  onClose,
  ausenciaId,
  currentUserId,
  modo,
  onBack,
}: {
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
  ausenciaId: string;
  currentUserId?: string | null;
  modo: "empleado" | "admin";
}) {
  return (
    <IOSDrawer
      open={open}
      onClose={onClose}
      header={{
        title: "Adjuntos",
        canGoBack: !!onBack,
        onBack: onBack || onClose,
        onClose: onClose,
      }}
    >
      <div className="p-4">
        <AdjuntosViewer
          ausenciaId={ausenciaId}
          modo={modo}
          currentUserId={currentUserId || null}
          baseUrl="/adjuntos/ausencias"
        />
      </div>
    </IOSDrawer>
  );
}
