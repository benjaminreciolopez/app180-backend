"use client";

import { Smartphone, Monitor, HelpCircle } from "lucide-react";
import { getPlatform, getInstallInstructions } from "@/utils/pwaDetection";

export default function AyudaInstalacionPage() {
  const platform = getPlatform();

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-100 to-neutral-200 dark:from-neutral-900 dark:to-neutral-800 p-4 py-12">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-2xl p-8 text-center">
          <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <HelpCircle className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">
            Cómo instalar CONTENDO GESTIONES
          </h1>
          <p className="text-neutral-600 dark:text-neutral-400">
            Guía paso a paso para instalar la aplicación en tu dispositivo
          </p>
        </div>

        {/* Advertencia importante */}
        <div className="bg-yellow-50 dark:bg-yellow-950/30 border-2 border-yellow-400 dark:border-yellow-600 rounded-xl p-6">
          <h2 className="text-xl font-bold text-yellow-800 dark:text-yellow-200 mb-2 flex items-center gap-2">
            ⚠️ Muy importante
          </h2>
          <ul className="space-y-2 text-yellow-800 dark:text-yellow-200">
            <li className="flex gap-2">
              <span className="flex-shrink-0">•</span>
              <span>
                Debes instalar la aplicación como <strong>PWA</strong> (Progressive Web App)
              </span>
            </li>
            <li className="flex gap-2">
              <span className="flex-shrink-0">•</span>
              <span>
                NO uses un acceso directo del navegador, debe ser la aplicación instalada
              </span>
            </li>
            <li className="flex gap-2">
              <span className="flex-shrink-0">•</span>
              <span>
                El enlace de invitación solo funciona si abres la app instalada
              </span>
            </li>
          </ul>
        </div>

        {/* Instrucciones iPhone */}
        <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl overflow-hidden">
          <div className="bg-gradient-to-r from-gray-700 to-gray-800 p-6">
            <div className="flex items-center gap-3">
              <Smartphone className="w-8 h-8 text-white" />
              <h2 className="text-2xl font-bold text-white">iPhone (Safari)</h2>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <p className="text-sm text-blue-800 dark:text-blue-200 font-semibold">
                ℹ️ Debes usar Safari, no funciona con Chrome en iPhone
              </p>
            </div>

            <ol className="space-y-4">
              <li className="flex gap-4">
                <span className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                  1
                </span>
                <div className="flex-1">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                    Abre el enlace de invitación en Safari
                  </p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
                    Asegúrate de estar usando Safari, no Chrome u otro navegador
                  </p>
                </div>
              </li>

              <li className="flex gap-4">
                <span className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                  2
                </span>
                <div className="flex-1">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                    Toca el botón "Compartir"
                  </p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
                    Es el icono de un cuadrado con una flecha hacia arriba, en la parte inferior de la pantalla
                  </p>
                </div>
              </li>

              <li className="flex gap-4">
                <span className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                  3
                </span>
                <div className="flex-1">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                    Desplázate y busca "Añadir a pantalla de inicio"
                  </p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
                    Puede que tengas que desplazarte hacia abajo en el menú para encontrarlo
                  </p>
                </div>
              </li>

              <li className="flex gap-4">
                <span className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                  4
                </span>
                <div className="flex-1">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                    Toca "Añadir"
                  </p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
                    Confirma que quieres añadir la aplicación a tu pantalla de inicio
                  </p>
                </div>
              </li>

              <li className="flex gap-4">
                <span className="flex-shrink-0 w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold">
                  5
                </span>
                <div className="flex-1">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                    Abre la app desde tu pantalla de inicio
                  </p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
                    Verás el icono de CONTENDO GESTIONES. Tócalo para abrir la aplicación
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </div>

        {/* Instrucciones Android */}
        <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl overflow-hidden">
          <div className="bg-gradient-to-r from-green-600 to-green-700 p-6">
            <div className="flex items-center gap-3">
              <Smartphone className="w-8 h-8 text-white" />
              <h2 className="text-2xl font-bold text-white">Android (Chrome)</h2>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
              <p className="text-sm text-green-800 dark:text-green-200 font-semibold">
                ℹ️ Recomendamos usar Chrome para la mejor experiencia
              </p>
            </div>

            <ol className="space-y-4">
              <li className="flex gap-4">
                <span className="flex-shrink-0 w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold">
                  1
                </span>
                <div className="flex-1">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                    Abre el enlace de invitación en Chrome
                  </p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
                    Chrome es el navegador recomendado para Android
                  </p>
                </div>
              </li>

              <li className="flex gap-4">
                <span className="flex-shrink-0 w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold">
                  2
                </span>
                <div className="flex-1">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                    Toca el menú ⋮ (tres puntos)
                  </p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
                    Está en la esquina superior derecha de la pantalla
                  </p>
                </div>
              </li>

              <li className="flex gap-4">
                <span className="flex-shrink-0 w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold">
                  3
                </span>
                <div className="flex-1">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                    Selecciona "Instalar aplicación" o "Añadir a pantalla de inicio"
                  </p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
                    El texto puede variar según la versión de Android
                  </p>
                </div>
              </li>

              <li className="flex gap-4">
                <span className="flex-shrink-0 w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold">
                  4
                </span>
                <div className="flex-1">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                    Toca "Instalar"
                  </p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
                    Confirma la instalación de la aplicación
                  </p>
                </div>
              </li>

              <li className="flex gap-4">
                <span className="flex-shrink-0 w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold">
                  5
                </span>
                <div className="flex-1">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                    Abre la app desde tu pantalla de inicio o cajón de aplicaciones
                  </p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
                    Busca el icono de CONTENDO GESTIONES y ábrelo
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </div>

        {/* Desktop (no recomendado) */}
        <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl overflow-hidden">
          <div className="bg-gradient-to-r from-orange-600 to-orange-700 p-6">
            <div className="flex items-center gap-3">
              <Monitor className="w-8 h-8 text-white" />
              <h2 className="text-2xl font-bold text-white">Ordenador (No recomendado)</h2>
            </div>
          </div>
          <div className="p-6">
            <div className="bg-orange-50 dark:bg-orange-950/30 border-2 border-orange-400 dark:border-orange-600 rounded-lg p-4">
              <p className="text-orange-800 dark:text-orange-200 font-semibold mb-2">
                ⚠️ Esta aplicación está diseñada para dispositivos móviles
              </p>
              <p className="text-sm text-orange-700 dark:text-orange-300">
                Por favor, abre el enlace de invitación desde tu teléfono móvil (iPhone o Android) para una experiencia óptima.
              </p>
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl p-6">
          <h2 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-4">
            Preguntas frecuentes
          </h2>
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                ¿Por qué no puedo usar un acceso directo del navegador?
              </h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                La aplicación necesita estar instalada como PWA para funcionar correctamente y vincularse a tu dispositivo de forma segura.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                ¿Qué hago si no veo la opción "Instalar aplicación"?
              </h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Asegúrate de estar usando Safari en iPhone o Chrome en Android. Otros navegadores pueden no mostrar esta opción.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                ¿El enlace de invitación caduca?
              </h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Sí, los enlaces de invitación caducan en 24 horas por seguridad. Si tu enlace ha caducado, contacta con tu administrador para que te envíe uno nuevo.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                ¿Puedo usar la aplicación en varios dispositivos?
              </h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                No, por seguridad cada empleado solo puede tener un dispositivo activo. Si necesitas cambiar de dispositivo, contacta con tu administrador.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-neutral-600 dark:text-neutral-400 text-sm">
          <p>¿Sigues teniendo problemas?</p>
          <p className="mt-1">Contacta con tu administrador para obtener ayuda</p>
        </div>
      </div>
    </div>
  );
}
