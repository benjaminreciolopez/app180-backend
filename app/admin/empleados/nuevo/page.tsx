"use client";

import { useState } from "react";
import { api } from "@/services/api";
import { useRouter } from "next/navigation";
import { showSuccess, showError } from "@/lib/toast";
import { Button } from "@/components/ui/button";

export default function NuevoEmpleadoPage() {
  const router = useRouter();

  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  async function crear(e: React.FormEvent) {
    e.preventDefault();

    try {
      setLoading(true);

      await api.post("/employees", {
        nombre,
        email,
        // 👇 NO mandamos password
      });

      showSuccess('Empleado creado correctamente\n\nContraseña inicial: 123456');
      router.push("/admin/empleados");
    } catch (err) {
      console.error(err);
      showError('Error creando empleado');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-main max-w-xl">
      <h1 className="text-xl font-bold mb-4">Nuevo empleado</h1>

      <form onSubmit={crear} className="card space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Nombre</label>
          <input
            className="w-full border border-border rounded-md px-3 py-2"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Email</label>
          <input
            type="email"
            className="w-full border border-border rounded-md px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        {/* INFO PASSWORD */}
        <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
          <strong>Contraseña inicial:</strong> 123456
          <br />
          El empleado deberá cambiarla en su primer inicio de sesión.
        </div>

        <Button type="submit" disabled={loading} className="w-full py-6 font-bold">
          {loading ? "Creando…" : "Crear empleado"}
        </Button>
      </form>
    </div>
  );
}
