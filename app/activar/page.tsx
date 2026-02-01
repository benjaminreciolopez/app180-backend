"use client";

import { useState } from "react";
import { api, setAuthToken } from "@/services/api";
import { useRouter } from "next/navigation";
import { CheckCircle, AlertCircle } from "lucide-react";
import { showSuccess, showError } from "@/lib/toast";

export default function ActivarPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleActivation = async () => {
    if (!code) return;

    setLoading(true);
    try {
      // Generate unique hash
      const device_hash =
          globalThis.crypto?.randomUUID?.() ||
          Math.random().toString(36).substring(2) + Date.now().toString(36);

      const res = await api.post("/empleado/activate-install", {
        token: code, // Validation accepts code too
        device_hash,
        user_agent: navigator.userAgent,
      });

      const { token: jwtToken, user } = res.data;

      if (jwtToken && user) {
        localStorage.setItem("device_hash", device_hash);
        localStorage.setItem("token", jwtToken);
        localStorage.setItem("user", JSON.stringify(user));
        setAuthToken(jwtToken);
        
        showSuccess("¡Dispositivo activado correctamente!");
        router.replace("/empleado/dashboard");
      }
    } catch (err: any) {
      console.error("❌ Error activando:", err);
      const msg = err?.response?.data?.error || "Código inválido o expirado";
      showError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800">Activar Dispositivo</h1>
            <p className="text-slate-500 mt-2">Introduce el código facilitado por tu administrador</p>
        </div>

        <div className="space-y-6">
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                    Código de Activación
                </label>
                <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Ej: 123456"
                    className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-center font-mono text-xl tracking-widest font-bold uppercase transition-all"
                    maxLength={10}
                />
            </div>

            <button
                onClick={handleActivation}
                disabled={loading || !code}
                className="w-full bg-blue-600 text-white font-bold py-3.5 rounded-xl shadow-lg hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {loading ? "Activando..." : "Validar Código"}
            </button>
            
            <div className="bg-blue-50 p-3 rounded-lg text-xs text-blue-700 text-center">
               Este proceso vinculará este dispositivo a tu cuenta de empleado.
            </div>
        </div>
      </div>
    </div>
  );
}
