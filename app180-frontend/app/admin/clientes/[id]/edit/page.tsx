"use client";

import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function ClienteEditPage() {
  const { id } = useParams();
  const router = useRouter();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          onClick={() => router.push(`/admin/clientes/${id}`)}
        >
          <ArrowLeft size={18} />
        </Button>

        <h1 className="text-xl font-semibold">Editar cliente</h1>
      </div>

      <div className="text-sm text-slate-500">
        Aquí irá el formulario completo.
      </div>
    </div>
  );
}
