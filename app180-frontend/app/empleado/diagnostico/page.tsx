"use client";

import { useEffect, useState } from "react";
import { isStandalone, getPlatform, getDeviceInfo } from "@/utils/pwaDetection";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

export default function DiagnosticoPage() {
  const [info, setInfo] = useState<any>(null);

  useEffect(() => {
    const deviceInfo = getDeviceInfo();
    const additionalInfo = {
      ...deviceInfo,
      userAgent: navigator.userAgent,
      displayMode: window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 
                   window.matchMedia('(display-mode: fullscreen)').matches ? 'fullscreen' :
                   window.matchMedia('(display-mode: minimal-ui)').matches ? 'minimal-ui' : 'browser',
      navigatorStandalone: (navigator as any).standalone,
      windowLocation: window.location.href,
      localStorage: {
        token: !!localStorage.getItem('token'),
        user: !!localStorage.getItem('user'),
        device_hash: !!localStorage.getItem('device_hash'),
      },
      sessionStorage: {
        token: !!sessionStorage.getItem('token'),
        user: !!sessionStorage.getItem('user'),
      }
    };
    
    setInfo(additionalInfo);
    console.log('📊 Diagnóstico completo:', additionalInfo);
  }, []);

  if (!info) {
    return <LoadingSpinner fullPage />;
  }

  return (
    <div className="min-h-screen bg-neutral-100 dark:bg-neutral-900 p-4">
      <div className="max-w-2xl mx-auto bg-white dark:bg-neutral-800 rounded-lg shadow-lg p-6 space-y-4">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">
          🔍 Diagnóstico PWA
        </h1>

        <div className="space-y-3">
          <DiagItem 
            label="¿Es PWA instalada?" 
            value={info.isPWA ? "✅ SÍ" : "❌ NO"} 
            important={true}
          />
          
          <DiagItem 
            label="Modo de visualización" 
            value={info.displayMode} 
            important={true}
          />
          
          <DiagItem 
            label="Plataforma" 
            value={info.platform} 
          />
          
          <DiagItem 
            label="Navegador" 
            value={info.browser} 
          />
          
          <DiagItem 
            label="navigator.standalone (iOS)" 
            value={info.navigatorStandalone === true ? "true" : info.navigatorStandalone === false ? "false" : "undefined"} 
          />
          
          <DiagItem 
            label="Puede instalar PWA" 
            value={info.canInstallPWA ? "Sí" : "No"} 
          />

          <div className="border-t pt-3 mt-3">
            <h2 className="font-semibold mb-2 text-neutral-900 dark:text-white">Almacenamiento</h2>
            
            <DiagItem 
              label="Token en localStorage" 
              value={info.localStorage.token ? "✅" : "❌"} 
            />
            
            <DiagItem 
              label="Usuario en localStorage" 
              value={info.localStorage.user ? "✅" : "❌"} 
            />
            
            <DiagItem 
              label="Device hash en localStorage" 
              value={info.localStorage.device_hash ? "✅" : "❌"} 
            />

            <DiagItem 
              label="Token en sessionStorage" 
              value={info.sessionStorage.token ? "✅" : "❌"} 
            />
            
            <DiagItem 
              label="Usuario en sessionStorage" 
              value={info.sessionStorage.user ? "✅" : "❌"} 
            />
          </div>

          <div className="border-t pt-3 mt-3">
            <h2 className="font-semibold mb-2 text-neutral-900 dark:text-white">Detalles técnicos</h2>
            
            <div className="bg-neutral-50 dark:bg-neutral-900 p-3 rounded text-xs font-mono break-all">
              <div className="mb-2">
                <strong>URL actual:</strong><br/>
                {info.windowLocation}
              </div>
              <div>
                <strong>User Agent:</strong><br/>
                {info.userAgent}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mt-6">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            <strong>Instrucciones:</strong> Toma una captura de pantalla de esta página y envíasela al desarrollador para diagnosticar el problema.
          </p>
        </div>
      </div>
    </div>
  );
}

function DiagItem({ label, value, important = false }: { label: string; value: string; important?: boolean }) {
  return (
    <div className={`flex justify-between items-center p-2 rounded ${important ? 'bg-yellow-50 dark:bg-yellow-950/20' : ''}`}>
      <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{label}</span>
      <span className={`text-sm font-mono ${important ? 'font-bold' : ''} text-neutral-900 dark:text-white`}>
        {value}
      </span>
    </div>
  );
}
