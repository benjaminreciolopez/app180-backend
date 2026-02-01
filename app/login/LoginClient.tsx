"use client";

import { FormEvent, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/services/auth";
import { Eye, EyeOff } from "lucide-react";
import { showSuccess, showError } from "@/lib/toast";
import { Button } from "@/components/ui/button";

export default function LoginClient() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false); // 🆕

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const r = await fetch("https://app180-backend.onrender.com/system/status");
        if (!r.ok) return; // Silent fail if not available
        const status = await r.json();
        if (status.bootstrap === true) {
           router.replace("/setup");
        }
      } catch (err) {
        console.error("Error checking system status", err);
      }
    };
    checkStatus();
  }, [router]);

  const [loading, setLoading] = useState(false);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    if (loading) return; // Prevent double-click
    setLoading(true);

    try {
      // Pasamos 'remember' al servicio
      const result = await login(email, password, undefined, remember);
      showSuccess('Inicio de sesión exitoso');

      if (result?.decoded?.role === "admin") {
        router.replace("/admin/dashboard");
      } else {
        router.replace("/empleado/dashboard");
      }
    } catch (err: any) {
      showError(err?.response?.data?.error || "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-100">
      <form
        onSubmit={handleLogin}
        className="bg-white shadow-lg rounded-lg p-8 w-full max-w-md space-y-6"
      >
        <h1 className="text-2xl font-bold text-center">
          Acceso CONTENDO GESTIONES
        </h1>

        <div>
          <label className="block text-sm font-medium mb-1">Email</label>
          <input
            type="email"
            className="border rounded w-full px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
          />
        </div>

        {/* PASSWORD */}
        <div className="relative">
          <label className="block text-sm font-medium mb-1">Contraseña</label>
          <input
            type={showPassword ? "text" : "password"}
            placeholder="Contraseña"
            autoComplete="current-password"
            className="border p-2 w-full rounded pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
          />

          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-[38px] text-gray-500 hover:text-gray-700"
            tabIndex={-1}
            disabled={loading}
          >
            {showPassword ? (
              <EyeOff className="w-5 h-5" />
            ) : (
              <Eye className="w-5 h-5" />
            )}
          </button>
        </div>

        {/* REMEMBER ME CHECBOX */}
        <div className="flex items-center">
          <input
            id="remember-me"
            type="checkbox"
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={loading}
          />
          <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-900 cursor-pointer select-none">
            Mantener sesión iniciada
          </label>
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="w-full py-6 text-lg font-bold shadow-md hover:shadow-xl transition-all"
        >
          {loading ? "Iniciando sesión..." : "Entrar"}
        </Button>
      </form>
    </div>
  );
}
