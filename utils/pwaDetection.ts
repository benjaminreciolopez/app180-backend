// app180-frontend/utils/pwaDetection.ts

/**
 * Utilidades para detectar modo PWA y características del dispositivo
 */

export interface DeviceInfo {
  isStandalone: boolean;
  isPWA: boolean;
  platform: 'ios' | 'android' | 'desktop' | 'unknown';
  browser: string;
  canInstallPWA: boolean;
}

/**
 * Detecta si la aplicación está corriendo en modo standalone (PWA instalada)
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;

  // Método 1: display-mode standalone
  const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches;
  
  // Método 2: navigator.standalone (iOS)
  const isIOSStandalone = (window.navigator as any).standalone === true;
  
  // Método 3: verificar si fue lanzada desde home screen
  const isLaunchedFromHomeScreen = window.matchMedia('(display-mode: standalone)').matches ||
                                    window.matchMedia('(display-mode: fullscreen)').matches ||
                                    window.matchMedia('(display-mode: minimal-ui)').matches;

  const result = isStandaloneMode || isIOSStandalone || isLaunchedFromHomeScreen;
  
  // 🐛 Debug logging
  console.log('🔍 PWA Detection:', {
    isStandaloneMode,
    isIOSStandalone,
    isLaunchedFromHomeScreen,
    finalResult: result,
    userAgent: window.navigator.userAgent,
    displayMode: window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 
                 window.matchMedia('(display-mode: fullscreen)').matches ? 'fullscreen' :
                 window.matchMedia('(display-mode: minimal-ui)').matches ? 'minimal-ui' : 'browser'
  });

  return result;
}

/**
 * Detecta la plataforma del dispositivo
 */
export function getPlatform(): 'ios' | 'android' | 'desktop' | 'unknown' {
  if (typeof window === 'undefined') return 'unknown';

  const userAgent = window.navigator.userAgent.toLowerCase();

  // iOS
  if (/iphone|ipad|ipod/.test(userAgent)) {
    return 'ios';
  }

  // Android
  if (/android/.test(userAgent)) {
    return 'android';
  }

  // Desktop
  if (/windows|mac|linux/.test(userAgent)) {
    return 'desktop';
  }

  return 'unknown';
}

/**
 * Detecta el navegador utilizado
 */
export function getBrowser(): string {
  if (typeof window === 'undefined') return 'unknown';

  const userAgent = window.navigator.userAgent.toLowerCase();

  if (userAgent.includes('firefox')) return 'Firefox';
  if (userAgent.includes('edg')) return 'Edge';
  if (userAgent.includes('chrome')) return 'Chrome';
  if (userAgent.includes('safari')) return 'Safari';
  if (userAgent.includes('opera') || userAgent.includes('opr')) return 'Opera';

  return 'Unknown';
}

/**
 * Verifica si el navegador puede instalar PWA
 */
export function canInstallPWA(): boolean {
  if (typeof window === 'undefined') return false;

  // Verificar si beforeinstallprompt está disponible
  return 'BeforeInstallPromptEvent' in window;
}

/**
 * Obtiene información completa del dispositivo
 */
export function getDeviceInfo(): DeviceInfo {
  const standalone = isStandalone();
  const platform = getPlatform();
  const browser = getBrowser();
  const canInstall = canInstallPWA();

  return {
    isStandalone: standalone,
    isPWA: standalone,
    platform,
    browser,
    canInstallPWA: canInstall,
  };
}

/**
 * Verifica si el dispositivo es móvil
 */
export function isMobileDevice(): boolean {
  const platform = getPlatform();
  return platform === 'ios' || platform === 'android';
}

/**
 * Genera un hash único del dispositivo basado en características del navegador
 */
export function generateDeviceHash(): string {
  if (typeof window === 'undefined') {
    return Math.random().toString(36).substring(2);
  }

  // Usar crypto.randomUUID si está disponible
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  // Fallback
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/**
 * Obtiene instrucciones de instalación según la plataforma
 */
export function getInstallInstructions(platform?: 'ios' | 'android' | 'desktop' | 'unknown'): string[] {
  const detectedPlatform = platform || getPlatform();

  switch (detectedPlatform) {
    case 'ios':
      return [
        'Toca el botón "Compartir" (cuadrado con flecha hacia arriba)',
        'Desplázate y selecciona "Añadir a pantalla de inicio"',
        'Toca "Añadir"',
        'Abre la aplicación desde el icono en tu pantalla de inicio',
      ];

    case 'android':
      return [
        'Toca el menú ⋮ (tres puntos en la esquina superior)',
        'Selecciona "Instalar aplicación" o "Añadir a pantalla de inicio"',
        'Toca "Instalar"',
        'Abre la aplicación desde el icono en tu pantalla de inicio',
      ];

    case 'desktop':
      return [
        'Esta aplicación está diseñada para dispositivos móviles',
        'Por favor, abre este enlace desde tu teléfono',
      ];

    default:
      return [
        'Busca la opción "Instalar aplicación" o "Añadir a pantalla de inicio" en el menú de tu navegador',
        'Sigue las instrucciones para instalar la aplicación',
      ];
  }
}
