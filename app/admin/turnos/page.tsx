"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function TurnosPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/jornadas");
  }, [router]);

  return (
    <div className="p-6">
      <p className="text-gray-600">
        El sistema de turnos ha sido integrado dentro de Jornadas.
      </p>
    </div>
  );
}
// app180-frontend/app/admin/turnos/page.tsx
