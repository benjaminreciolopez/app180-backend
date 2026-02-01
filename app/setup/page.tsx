"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/services/api";

export default function SetupPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nombre, setNombre] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();

    if (loading) return;

    setLoading(true);
    setError("");

    try {
      await api.post("/auth/register-first-admin", {
        email,
        password,
        nombre,
        empresa_nombre: empresa,
      });

      alert("Sistema inicializado correctamente");

      router.replace("/login");
    } catch (err: any) {
      console.error(err);

      setError(err?.response?.data?.error || "Error inicializando sistema");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form
        onSubmit={submit}
        className="bg-white p-6 rounded shadow w-full max-w-md space-y-4"
      >
        <h1 className="text-xl font-bold text-center">
          Inicializar Contendo Gestiones
        </h1>

        {error && <div className="text-red-600 text-sm">{error}</div>}

        <input
          required
          placeholder="Nombre empresa"
          className="border p-2 w-full rounded"
          value={empresa}
          onChange={(e) => setEmpresa(e.target.value)}
        />

        <input
          required
          placeholder="Nombre administrador"
          className="border p-2 w-full rounded"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />

        <input
          required
          type="email"
          placeholder="Email"
          className="border p-2 w-full rounded"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <div className="relative">
          <input
            required
            type={showPassword ? "text" : "password"}
            placeholder="Contraseña"
            className="border p-2 w-full rounded pr-10"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
            tabIndex={-1}
          >
            {showPassword ? "🙈" : "👁️"}
          </button>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white w-full py-2 rounded disabled:opacity-50"
        >
          {loading ? "Creando..." : "Inicializar sistema"}
        </button>
      </form>
    </div>
  );
}
