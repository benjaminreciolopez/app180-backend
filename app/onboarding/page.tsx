"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/services/api";
import { getUser, updateStoredUser } from "@/services/auth";
import { showSuccess, showError } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Check, Calendar, Mail, ArrowRight, Building2 } from "lucide-react";

type Modulos = {
  fichajes: boolean;
  worklogs: boolean;
  empleados: boolean;
  calendario: boolean;
  facturacion: boolean;
  pagos: boolean;
};

const MODULE_LIST = [
  { key: "empleados", label: "Empleados", desc: "Gestión de empleados, ausencias, dispositivos", default: true },
  { key: "fichajes", label: "Fichajes", desc: "Control de entrada/salida, horas trabajadas", default: true },
  { key: "calendario", label: "Calendario", desc: "Festivos, cierres, planificación", default: true },
  { key: "worklogs", label: "Trabajos / Partes", desc: "Partes de trabajo, asignaciones a clientes", default: false },
  { key: "facturacion", label: "Facturación", desc: "Facturas, conceptos, IVA, VeriFactu", default: false },
  { key: "pagos", label: "Cobros y Pagos", desc: "Control de cobros y pagos de clientes", default: false },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [empresaNombre, setEmpresaNombre] = useState("");
  const [modulos, setModulos] = useState<Modulos>({
    fichajes: true,
    worklogs: false,
    empleados: true,
    calendario: true,
    facturacion: false,
    pagos: false,
  });
  const [googleConnected, setGoogleConnected] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const user = getUser();
    if (!user) {
      router.replace("/login");
      return;
    }
    // Pre-fill empresa name from domain
    const domain = user.email?.split("@")[1]?.split(".")[0] || "";
    setEmpresaNombre(domain.charAt(0).toUpperCase() + domain.slice(1));
  }, [router]);

  // Listen for OAuth popup completion
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.data?.type === "oauth-success") {
        setGoogleConnected(true);
        showSuccess("Google Calendar y Gmail conectados");
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  function toggleModule(key: string) {
    setModulos((prev) => ({ ...prev, [key]: !prev[key as keyof Modulos] }));
  }

  async function handleConnectGoogle() {
    setLoading(true);
    try {
      const res = await api.post("/auth/google/complete-setup", {
        empresa_nombre: empresaNombre,
      });
      const { authUrl } = res.data;
      // Open popup
      window.open(
        authUrl,
        "Google Setup",
        "width=500,height=700,scrollbars=yes,resizable=yes,left=200,top=100"
      );
    } catch (err: any) {
      showError(err?.response?.data?.error || "Error conectando con Google");
    } finally {
      setLoading(false);
    }
  }

  async function handleFinish() {
    setLoading(true);
    try {
      // 1. Update empresa name if changed
      if (empresaNombre) {
        await api.post("/auth/google/complete-setup", {
          empresa_nombre: empresaNombre,
        }).catch(() => {}); // ignore if already called
      }

      // 2. Save modules
      await api.put("/admin/configuracion", { modulos });

      // 3. Refresh user data
      const me = await api.get("/auth/me");
      updateStoredUser(me.data);
      localStorage.setItem("user", JSON.stringify(me.data));
      window.dispatchEvent(new Event("session-updated"));

      showSuccess("Configuración completada");
      router.replace("/admin/dashboard");
    } catch (err: any) {
      showError(err?.response?.data?.error || "Error guardando configuración");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
        {/* Progress bar */}
        <div className="h-1.5 bg-gray-100">
          <div
            className="h-full bg-blue-500 transition-all duration-500"
            style={{ width: `${(step / 3) * 100}%` }}
          />
        </div>

        <div className="p-8">
          {/* Step 1: Empresa name */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto">
                  <Building2 className="w-7 h-7 text-blue-600" />
                </div>
                <h1 className="text-2xl font-bold">Nombre de tu empresa</h1>
                <p className="text-gray-500 text-sm">
                  Puedes cambiarlo más adelante en Configuración
                </p>
              </div>

              <input
                type="text"
                value={empresaNombre}
                onChange={(e) => setEmpresaNombre(e.target.value)}
                placeholder="Mi Empresa SL"
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-blue-500 transition-colors"
                autoFocus
              />

              <Button
                onClick={() => setStep(2)}
                disabled={!empresaNombre.trim()}
                className="w-full py-6 text-base font-semibold"
              >
                Continuar
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </div>
          )}

          {/* Step 2: Connect Google services */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <div className="w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center mx-auto">
                  {googleConnected ? (
                    <Check className="w-7 h-7 text-green-600" />
                  ) : (
                    <Calendar className="w-7 h-7 text-green-600" />
                  )}
                </div>
                <h1 className="text-2xl font-bold">Conectar servicios Google</h1>
                <p className="text-gray-500 text-sm">
                  Conecta tu cuenta de Google para sincronizar Calendar y enviar emails
                </p>
              </div>

              {/* What will be connected */}
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-50 border border-blue-100">
                  <Calendar className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-sm">Google Calendar</p>
                    <p className="text-xs text-gray-500">Sincroniza festivos, cierres y eventos automáticamente</p>
                  </div>
                  {googleConnected && <Check className="w-5 h-5 text-green-500 ml-auto mt-0.5" />}
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-red-50 border border-red-100">
                  <Mail className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-sm">Gmail</p>
                    <p className="text-xs text-gray-500">Envía facturas, invitaciones y notificaciones</p>
                  </div>
                  {googleConnected && <Check className="w-5 h-5 text-green-500 ml-auto mt-0.5" />}
                </div>
              </div>

              {googleConnected ? (
                <div className="text-center p-4 bg-green-50 rounded-xl border border-green-200">
                  <Check className="w-8 h-8 text-green-500 mx-auto mb-2" />
                  <p className="font-semibold text-green-700">Servicios conectados correctamente</p>
                </div>
              ) : (
                <Button
                  onClick={handleConnectGoogle}
                  disabled={loading}
                  className="w-full py-6 text-base font-semibold bg-white text-gray-700 border-2 border-gray-300 hover:bg-gray-50 hover:border-gray-400"
                >
                  <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  {loading ? "Conectando..." : "Autorizar con Google"}
                </Button>
              )}

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  className="flex-1 py-5"
                >
                  Atrás
                </Button>
                <Button
                  onClick={() => setStep(3)}
                  className="flex-1 py-5 font-semibold"
                >
                  {googleConnected ? "Continuar" : "Omitir por ahora"}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Choose modules */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <h1 className="text-2xl font-bold">Elige tus módulos</h1>
                <p className="text-gray-500 text-sm">
                  Activa solo los que necesites. Puedes cambiarlos en cualquier momento.
                </p>
              </div>

              <div className="space-y-2">
                {MODULE_LIST.map((mod) => (
                  <button
                    key={mod.key}
                    onClick={() => toggleModule(mod.key)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                      modulos[mod.key as keyof Modulos]
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                      modulos[mod.key as keyof Modulos]
                        ? "bg-blue-500"
                        : "bg-gray-200"
                    }`}>
                      {modulos[mod.key as keyof Modulos] && (
                        <Check className="w-4 h-4 text-white" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{mod.label}</p>
                      <p className="text-xs text-gray-500">{mod.desc}</p>
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setStep(2)}
                  className="flex-1 py-5"
                >
                  Atrás
                </Button>
                <Button
                  onClick={handleFinish}
                  disabled={loading}
                  className="flex-1 py-5 font-semibold"
                >
                  {loading ? "Guardando..." : "Empezar a usar APP180"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
