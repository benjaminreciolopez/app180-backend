// app180-frontend/components/ForceChangePasswordModal.tsx

"use client";

import { useEffect, useState } from "react";
import { api, setAuthToken } from "@/services/api";
import { Eye, EyeOff } from "lucide-react";

export default function ForceChangePasswordModal() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  // =========================
  // Detectar password forzado
  // =========================
  useEffect(() => {
    const raw = localStorage.getItem("user");
    if (!raw) return;

    try {
      const user = JSON.parse(raw);

      if (user?.password_forced === true) {
        setVisible(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  if (!visible) return null;

  // =========================
  // Submit
  // =========================
  async function submit(e: React.FormEvent) {
    e.preventDefault();

    if (saving) return;

    setSaving(true);
    setError(null);

    try {
      const res = await api.post("/auth/change-password", {
        current_password: current,
        new_password: next,
      });

      const { token, user } = res.data;

      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify(user));
      setAuthToken(token);

      // cerrar modal
      setVisible(false);

      // refrescar contexto completo
      window.location.reload();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Error al cambiar contraseña");
    } finally {
      setSaving(false);
    }
  }

  // =========================
  // UI
  // =========================
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4">
      <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl w-full max-w-md p-6 text-neutral-900 dark:text-neutral-100">
        <h2 className="text-xl font-bold mb-2">
          Cambio de contraseña obligatorio
        </h2>

        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
          Por seguridad, debes cambiar tu contraseña antes de continuar.
        </p>

        <form onSubmit={submit} className="space-y-4">
          {/* ========================= */}
          {/* Contraseña actual */}
          {/* ========================= */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Contraseña actual
            </label>

            <div className="relative">
              <input
                type={showCurrent ? "text" : "password"}
                className="
                  border rounded w-full px-3 py-2 pr-10
                  bg-white dark:bg-neutral-800
                  border-neutral-300 dark:border-neutral-700
                  text-neutral-900 dark:text-neutral-100
                  focus:outline-none focus:ring-2 focus:ring-blue-500
                "
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />

              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute inset-y-0 right-2 flex items-center text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                tabIndex={-1}
              >
                {showCurrent ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* ========================= */}
          {/* Nueva contraseña */}
          {/* ========================= */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Nueva contraseña
            </label>

            <div className="relative">
              <input
                type={showNext ? "text" : "password"}
                className="
                  border rounded w-full px-3 py-2 pr-10
                  bg-white dark:bg-neutral-800
                  border-neutral-300 dark:border-neutral-700
                  text-neutral-900 dark:text-neutral-100
                  focus:outline-none focus:ring-2 focus:ring-blue-500
                "
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
              />

              <button
                type="button"
                onClick={() => setShowNext(!showNext)}
                className="absolute inset-y-0 right-2 flex items-center text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                tabIndex={-1}
              >
                {showNext ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* ========================= */}
          {/* Error */}
          {/* ========================= */}
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          {/* ========================= */}
          {/* Botón */}
          {/* ========================= */}
          <button
            type="submit"
            disabled={saving}
            className="
              w-full bg-blue-600 hover:bg-blue-700
              text-white font-medium
              py-2 rounded
              disabled:opacity-50 disabled:cursor-not-allowed
              transition
            "
          >
            {saving ? "Guardando..." : "Cambiar contraseña"}
          </button>
        </form>
      </div>
    </div>
  );
}
