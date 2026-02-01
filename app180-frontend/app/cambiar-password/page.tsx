"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api, setAuthToken } from "@/services/api";
import { getUser } from "@/services/auth";
import { Eye, EyeOff, Lock } from "lucide-react";
import { showSuccess, showError } from "@/lib/toast";
import { Button } from "@/components/ui/button";

export default function CambiarPasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [passwordForced, setPasswordForced] = useState(false);

  useEffect(() => {
    // Verificar si el usuario tiene password_forced
    // 🆕 Usar helper
    const user = getUser();
    if (user) {
      setPasswordForced(user.password_forced === true);
    }
  }, []);

  const validatePassword = (password: string): string | null => {
    if (password.length < 6) {
      return "La contraseña debe tener al menos 6 caracteres";
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return; // Prevent double-click
    setError("");

    // Validaciones
    if (!currentPassword || !newPassword || !confirmPassword) {
      showError("Todos los campos son obligatorios");
      return;
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      showError(passwordError);
      return;
    }

    if (newPassword !== confirmPassword) {
      showError("Las contraseñas no coinciden");
      return;
    }

    if (currentPassword === newPassword) {
      showError("La nueva contraseña debe ser diferente a la actual");
      return;
    }

    setSaving(true);

    try {
      const res = await api.post("/auth/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
      });

      const { token, user } = res.data;

      // Actualizar localStorage
      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify(user));
      setAuthToken(token);

      showSuccess('Contraseña cambiada correctamente');

      // Redirigir según el rol
      if (user.role === "admin") {
        router.replace("/admin/dashboard");
      } else {
        router.replace("/empleado/dashboard");
      }
    } catch (err: any) {
      console.error("Error cambiando contraseña:", err);
      showError(
        err?.response?.data?.error || "Error al cambiar la contraseña",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-neutral-100 to-neutral-200 dark:from-neutral-900 dark:to-neutral-800 p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-6 rounded-t-xl">
          <div className="flex items-center justify-center mb-2">
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
              <Lock className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white text-center">
            {passwordForced ? "Cambio de contraseña obligatorio" : "Cambiar contraseña"}
          </h1>
          {passwordForced && (
            <p className="text-blue-100 text-sm text-center mt-2">
              Por seguridad, debes cambiar tu contraseña antes de continuar
            </p>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Contraseña actual */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
              Contraseña actual
            </label>
            {passwordForced && (
              <p className="text-xs text-blue-600 dark:text-blue-400 mb-2">
                Tu contraseña temporal es: <strong>123456</strong>
              </p>
            )}
            <div className="relative">
              <input
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-4 py-3 pr-12 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={passwordForced ? "123456" : "Ingresa tu contraseña actual"}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                tabIndex={-1}
              >
                {showCurrent ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {/* Nueva contraseña */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
              Nueva contraseña
            </label>
            <div className="relative">
              <input
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-4 py-3 pr-12 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Mínimo 6 caracteres"
                required
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                tabIndex={-1}
              >
                {showNew ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
              Mínimo 6 caracteres
            </p>
          </div>

          {/* Confirmar contraseña */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
              Confirmar nueva contraseña
            </label>
            <div className="relative">
              <input
                type={showConfirm ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 pr-12 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Repite la nueva contraseña"
                required
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                tabIndex={-1}
              >
                {showConfirm ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Submit */}
          <Button
            type="submit"
            disabled={saving}
            className="w-full py-6 text-lg font-bold shadow-md hover:shadow-lg transition-all"
          >
            {saving ? "Guardando..." : "Cambiar contraseña"}
          </Button>
        </form>

        {/* Footer */}
        {!passwordForced && (
          <div className="px-6 pb-6 text-center">
            <Button
              variant="ghost"
              onClick={() => router.back()}
              className="w-full text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              Cancelar
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
