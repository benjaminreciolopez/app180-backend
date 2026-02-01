"use client";

import { api } from "@/services/api";
import { showError } from "@/lib/toast";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NuevaPlantillaPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    nombre: "",
    descripcion: "",
    tipo: "semanal", // diaria | semanal | mensual
  });

  async function guardar() {
    if (!form.nombre.trim()) {
      showError("Nombre obligatorio");
      return;
    }
    setSaving(true);
    try {
      const res = await api.post("/admin/plantillas", {
        nombre: form.nombre.trim(),
        descripcion: form.descripcion.trim() || null,
        tipo: form.tipo,
      });
      const id = res.data?.id;
      if (id) router.replace(`/admin/jornadas/${id}`);
      else router.replace("/admin/jornadas");
    } catch (e) {
      console.error(e);
      showError("No se pudo crear");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 space-y-4 max-w-[900px]">
      <div>
        <h1 className="text-2xl font-bold">Nueva plantilla de jornada</h1>
        <p className="text-sm text-gray-600">
          Crea la plantilla y luego configura días, bloques y excepciones.
        </p>
      </div>

      <div className="bg-white border rounded p-4 space-y-3">
        <div>
          <label className="text-sm font-semibold">Nombre</label>
          <input
            className="border rounded p-2 w-full"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          />
        </div>

        <div>
          <label className="text-sm font-semibold">Descripción</label>
          <input
            className="border rounded p-2 w-full"
            value={form.descripcion}
            onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
          />
        </div>

        <div>
          <label className="text-sm font-semibold">Tipo</label>
          <select
            className="border rounded p-2 w-full"
            value={form.tipo}
            onChange={(e) => setForm({ ...form, tipo: e.target.value })}
          >
            <option value="diaria">Diaria</option>
            <option value="semanal">Semanal</option>
            <option value="mensual">Mensual</option>
          </select>
        </div>

        <div className="flex justify-end gap-2">
          <button
            className="px-3 py-2 rounded bg-gray-200"
            onClick={() => router.back()}
          >
            Cancelar
          </button>
          <button
            disabled={saving}
            className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-60"
            onClick={guardar}
          >
            {saving ? "Guardando…" : "Crear"}
          </button>
        </div>
      </div>
    </div>
  );
}
// app180-frontend/app/admin/jornadas/nuevo/page.tsx
