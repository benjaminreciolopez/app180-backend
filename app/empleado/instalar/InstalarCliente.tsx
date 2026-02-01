"use client";

import { useEffect, useState, useRef } from "react";
import { api, setAuthToken } from "@/services/api";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle, Smartphone, HelpCircle, Copy, Download } from "lucide-react";
import {
  isStandalone,
  getPlatform,
  getInstallInstructions,
  isMobileDevice,
} from "@/utils/pwaDetection";
import { showSuccess, showError } from "@/lib/toast";

export default function InstalarCliente({ token }: { token?: string }) {
  const router = useRouter();
  const [isPWA, setIsPWA] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "unknown" | "desktop">("unknown");
  const [tokenActivo, setTokenActivo] = useState("");
  
  // Estado para la activación manual
  const [inputToken, setInputToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  
  // Inicialización
  useEffect(() => {
    // 1. Detectar plataforma y modo
    const pwa = isStandalone();
    setIsPWA(pwa);
    setPlatform(getPlatform());

    // 2. Obtener token de URL
    let urlToken = token || new URLSearchParams(window.location.search).get("token") || "";
    
    // 3. Si tenemos token, lo guardamos en estado
    if (urlToken) {
      setTokenActivo(urlToken);
      setInputToken(urlToken);
    }
    
    // 4. Si es PWA, intentar recuperar token de localStorage (por si Safari lo pasó)
    if (pwa && !urlToken) {
        // 5. Verificar si YA estamos logueados
        const existingToken = localStorage.getItem("token");
        if (existingToken) {
            console.log("🔄 Sesión detectada en PWA, redirigiendo...");
            router.replace("/empleado/dashboard");
            return;
        }

        const storedToken = localStorage.getItem("pending_activation_token");
        if (storedToken) {
            setTokenActivo(storedToken);
            setInputToken(storedToken);
        }
    }

    // Terminamos de chequear sesión
    setCheckingSession(false);
  }, [token, router]);

  // Función para activar el dispositivo
  const handleActivation = async (tokenToUse: string) => {
    if (!tokenToUse) {
      showError("El código de invitación es necesario");
      return;
    }

    setLoading(true);
    try {
      // Generar hash único
      const device_hash =
          globalThis.crypto?.randomUUID?.() ||
          Math.random().toString(36).substring(2) + Date.now().toString(36);

      console.log("📱 Activando dispositivo con hash:", device_hash);

      const res = await api.post("/empleado/activate-install", {
        token: tokenToUse,
        device_hash,
        user_agent: navigator.userAgent,
      });

      const { token: jwtToken, user } = res.data;

      if (jwtToken && user) {
        // Guardar sesión
        localStorage.setItem("device_hash", device_hash);
        localStorage.setItem("token", jwtToken);
        localStorage.setItem("user", JSON.stringify(user));
        setAuthToken(jwtToken);
        
        // Limpiar tokens temporales
        localStorage.removeItem("pending_activation_token");
        
        showSuccess("¡Dispositivo activado correctamente!");
        
        // Redirigir inmediatamente
        router.replace("/cambiar-password");
      }
    } catch (err: any) {
      console.error("❌ Error activando:", err);
      const msg = err?.response?.data?.error || "Error al activar el dispositivo";
      showError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Copiar token al portapapeles
  const copyToken = () => {
    navigator.clipboard.writeText(tokenActivo);
    showSuccess("Código copiado al portapapeles");
    
    // Intentar guardar en localStorage por si acaso Safari lo comparte
    if (tokenActivo) {
        localStorage.setItem("pending_activation_token", tokenActivo);
    }
  };

  // Si estamos chequeando sesión en modo PWA, mostramos spinner limpio
  if (checkingSession) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // VISTA: NAVEGADOR (Instrucciones)
  if (!isPWA) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-4 font-sans text-slate-800">
        <div className="max-w-md mx-auto bg-white rounded-2xl shadow-xl overflow-hidden mt-4">
          <div className="bg-blue-600 p-6 text-center">
            <h1 className="text-2xl font-bold text-white mb-2">Instalar Aplicación</h1>
            <p className="text-blue-100 text-sm">Paso 1 de 2: Instalación</p>
          </div>

          <div className="p-6 space-y-6">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex gap-4 items-start">
              <Download className="w-8 h-8 text-blue-600 shrink-0 mt-1" />
              <div>
                <h3 className="font-semibold text-blue-900">Esta app debe instalarse</h3>
                <p className="text-sm text-blue-700 mt-1">
                  Para garantizar el acceso seguro y el fichaje correcto, debes instalar la aplicación en tu móvil.
                </p>
              </div>
            </div>

            {tokenActivo && (
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block pl-1">
                  Tu Código de Invitación
                </label>
                <div 
                  onClick={copyToken}
                  className="bg-slate-100 border-2 border-slate-200 rounded-xl p-4 flex justify-between items-center cursor-pointer hover:bg-slate-200 transition-colors group"
                >
                    <code className="text-xl font-mono font-bold text-slate-700 tracking-wider">
                        {tokenActivo}
                    </code>
                    <Copy className="w-5 h-5 text-slate-400 group-hover:text-blue-600" />
                </div>
                <p className="text-xs text-center text-slate-500">
                  👆 Toca para copiar (lo necesitarás si la app no se activa sola)
                </p>
              </div>
            )}

            <div className="border-t border-slate-100 pt-6">
              <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-indigo-600" />
                Cómo Instalar
              </h3>
              
              {platform === "ios" ? (
                <ol className="space-y-4 text-sm text-slate-600">
                    <li className="flex gap-3">
                        <span className="bg-indigo-100 text-indigo-700 font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0">1</span>
                        <span>Toca el botón <strong>Compartir</strong> <span className="inline-block px-1 bg-slate-200 rounded text-xs align-middle">⬆️</span> en la barra inferior de Safari.</span>
                    </li>
                    <li className="flex gap-3">
                        <span className="bg-indigo-100 text-indigo-700 font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0">2</span>
                        <span>Busca y selecciona <strong>"Añadir a pantalla de inicio"</strong>.</span>
                    </li>
                    <li className="flex gap-3">
                        <span className="bg-indigo-100 text-indigo-700 font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0">3</span>
                        <span>Confirma tocando <strong>"Añadir"</strong>.</span>
                    </li>
                    <li className="flex gap-3">
                        <span className="bg-indigo-100 text-indigo-700 font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0">4</span>
                        <span>Cierra Safari y abre la app <strong>CONTENDO</strong> desde tu inicio.</span>
                    </li>
                </ol>
              ) : (
                <ol className="space-y-4 text-sm text-slate-600">
                    <li className="flex gap-3">
                        <span className="bg-indigo-100 text-indigo-700 font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0">1</span>
                        <span>Toca el menú de tres puntos <span className="inline-block px-1 bg-slate-200 rounded text-xs align-middle">⋮</span> arriba a la derecha.</span>
                    </li>
                    <li className="flex gap-3">
                        <span className="bg-indigo-100 text-indigo-700 font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0">2</span>
                        <span>Selecciona <strong>"Instalar aplicación"</strong> o "Añadir a pantalla de inicio".</span>
                    </li>
                    <li className="flex gap-3">
                        <span className="bg-indigo-100 text-indigo-700 font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0">3</span>
                        <span>Abre la app instalada.</span>
                    </li>
                </ol>
              )}
            </div>
            
            <div className="bg-red-50 p-4 rounded-xl text-center">
                <p className="text-red-600 font-bold text-sm">
                    ⚠️ NO INTENTES ENTRAR DESDE AQUÍ
                </p>
                <p className="text-red-500 text-xs mt-1">
                    La aplicación solo funcionará si la instalas primero.
                </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // VISTA: PWA (Activación)
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-8">
            <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800">¡App Instalada!</h1>
            <p className="text-slate-500 mt-2">Ahora activemos tu cuenta</p>
        </div>

        <div className="space-y-6">
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                    Código de Invitación
                </label>
                <input
                    type="text"
                    value={inputToken}
                    onChange={(e) => setInputToken(e.target.value)}
                    placeholder="Pega tu código aquí"
                    className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-center font-mono text-lg tracking-widest uppercase transition-all"
                />
            </div>

            <button
                onClick={() => handleActivation(inputToken)}
                disabled={loading || !inputToken}
                className="w-full bg-blue-600 text-white font-bold py-3.5 rounded-xl shadow-lg hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {loading ? "Activando..." : "Activar Dispositivo"}
            </button>
            
            <p className="text-xs text-center text-slate-400">
                Si no tienes el código, pide a tu administrador que te envíe uno nuevo.
            </p>
        </div>
      </div>
    </div>
  );
}
