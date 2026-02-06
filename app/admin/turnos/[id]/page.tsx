"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function EditarTurnoPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/jornadas");
  }, [router]);

  return null;
}
// app180-frontend/app/admin/turnos/[id]/page.tsx
