"use client";

import { useState } from "react";
import { X, Copy, Send, MessageCircle, Check } from "lucide-react";
import { api } from "@/services/api";

interface ShareInviteLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  inviteData: {
    installUrl: string;
    expires_at: string;
    token: string;
    code?: string;
    empleado: {
      nombre: string;
      email: string;
    };
  };
  empleadoId: string;
  tipo?: "nuevo" | "cambio";
}

export default function ShareInviteLinkModal({
  isOpen,
  onClose,
  inviteData,
  empleadoId,
  tipo = "nuevo",
}: ShareInviteLinkModalProps) {
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  if (!isOpen) return null;

  const { installUrl, expires_at, empleado } = inviteData;

  // Formatear fecha de expiración
  const expiresDate = new Date(expires_at);
  const expiresFormatted = expiresDate.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Copiar al portapapeles
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(installUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Error copiando al portapapeles:", err);
      alert("No se pudo copiar el enlace");
    }
  };

  // Compartir por WhatsApp
  const handleWhatsApp = () => {
    const message = `Hola ${empleado.nombre}! 👋

Te comparto el enlace para activar tu acceso a CONTENDO GESTIONES.

⚠️ IMPORTANTE: Debes abrir este enlace desde tu móvil e instalar la aplicación.

🔗 Enlace: ${installUrl}

⏰ Caduca en 24 horas (${expiresFormatted})

📱 Instrucciones:
1. Abre este enlace desde tu móvil
2. Instala la aplicación:
   • iPhone: Toca "Compartir" → "Añadir a pantalla de inicio"
   • Android: Toca menú ⋮ → "Instalar aplicación"
3. Abre la app desde el icono en tu pantalla
4. Cambia tu contraseña inicial

Si tienes problemas, contáctame.`;

    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank");
  };

  // Enviar por email
  const handleSendEmail = async () => {
    setSending(true);
    setEmailSent(false);

    try {
      await api.post(`/admin/employees/${empleadoId}/send-invite-email`, {
        token: inviteData.token,
        tipo,
      });

      setEmailSent(true);
      setTimeout(() => setEmailSent(false), 3000);
    } catch (err: any) {
      console.error("Error enviando email:", err);
      alert(
        err?.response?.data?.error ||
          "No se pudo enviar el email. Verifica la configuración SMTP.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
            Compartir enlace de invitación
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Información del empleado */}
          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-semibold">
                {empleado.nombre.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                  {empleado.nombre}
                </p>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  {empleado.email}
                </p>
              </div>
            </div>
          </div>

          {/* Advertencia */}
          <div className="bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              <strong>⚠️ Importante:</strong> El empleado debe abrir este
              enlace desde su móvil e instalar la aplicación como PWA. El
              enlace caduca el <strong>{expiresFormatted}</strong>.
            </p>
          </div>

          {inviteData.code && (
             <div className="mb-6">
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                  Código de Activación Manual
                </label>
                <div className="bg-indigo-50 border-2 border-indigo-200 rounded-lg p-4 flex items-center justify-between">
                   <div className="text-3xl font-mono font-bold text-indigo-700 tracking-[0.2em]">
                      {inviteData.code}
                   </div>
                   <button
                    onClick={() => {
                        navigator.clipboard.writeText(inviteData.code!);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                    }}
                    className="p-2 text-indigo-600 hover:bg-indigo-100 rounded transition"
                   >
                     {copied ? <Check size={20} /> : <Copy size={20} />}
                   </button>
                </div>
                <p className="text-xs text-neutral-500 mt-2">
                   Envía este código al empleado. Deberá introducirlo en <strong className="text-indigo-600 font-mono">/activar</strong>
                </p>
             </div>
          )}

          {/* Enlace */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
              Enlace de activación
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={installUrl}
                readOnly
                className="flex-1 px-4 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 font-mono text-sm"
              />
              <button
                onClick={handleCopy}
                className={`px-4 py-2 rounded-lg font-medium transition flex items-center gap-2 ${
                  copied
                    ? "bg-green-600 text-white"
                    : "bg-neutral-200 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 hover:bg-neutral-300 dark:hover:bg-neutral-600"
                }`}
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copiar
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Opciones de compartir */}
          <div>
            <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-3">
              Opciones para compartir
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* WhatsApp */}
              <button
                onClick={handleWhatsApp}
                className="flex items-center gap-3 p-4 border-2 border-green-500 hover:bg-green-50 dark:hover:bg-green-950/30 rounded-lg transition group"
              >
                <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                    WhatsApp
                  </p>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400">
                    Compartir con mensaje predefinido
                  </p>
                </div>
              </button>

              {/* Email */}
              <button
                onClick={handleSendEmail}
                disabled={sending || emailSent}
                className={`flex items-center gap-3 p-4 border-2 rounded-lg transition group ${
                  emailSent
                    ? "border-green-500 bg-green-50 dark:bg-green-950/30"
                    : "border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    emailSent ? "bg-green-500" : "bg-blue-500"
                  }`}
                >
                  {emailSent ? (
                    <Check className="w-5 h-5 text-white" />
                  ) : (
                    <Send className="w-5 h-5 text-white" />
                  )}
                </div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                    {emailSent ? "Email enviado" : "Enviar por email"}
                  </p>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400">
                    {sending
                      ? "Enviando..."
                      : emailSent
                        ? `Enviado a ${empleado.email}`
                        : `Enviar a ${empleado.email}`}
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* Instrucciones para el admin */}
          <div className="bg-neutral-50 dark:bg-neutral-800 rounded-lg p-4">
            <h4 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
              📋 Instrucciones para el empleado
            </h4>
            <ol className="text-sm text-neutral-600 dark:text-neutral-400 space-y-1 list-decimal list-inside">
              <li>Abrir el enlace desde el móvil</li>
              <li>
                Instalar la aplicación:
                <ul className="ml-6 mt-1 space-y-1 list-disc list-inside">
                  <li>
                    iPhone: Toca "Compartir" → "Añadir a pantalla de inicio"
                  </li>
                  <li>Android: Toca menú ⋮ → "Instalar aplicación"</li>
                </ul>
              </li>
              <li>Abrir la app desde el icono en la pantalla de inicio</li>
              <li>Cambiar la contraseña inicial</li>
            </ol>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-700 px-6 py-4">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-900 dark:text-neutral-100 font-medium rounded-lg transition"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
