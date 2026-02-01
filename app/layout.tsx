import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import AuthInit from "@/components/AuthInit";
import ToastProvider from "@/components/ToastProvider";
import DynamicAuthor from "@/components/DynamicAuthor";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Forzar credenciales para el manifest PWA (evita 401 en Vercel Preview) */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
      </head>
      <body className="app-shell">
        <ThemeProvider>
          <AuthInit />
          <DynamicAuthor />
          {children}
          <ToastProvider />
        </ThemeProvider>
        {/* Portal container para evitar conflictos con aria-hidden */}
        <div id="portal-root" />
      </body>
    </html>
  );
}

export const metadata: Metadata = {
  title: "CONTENDO GESTIONES",
  description: "Sistema de gestión empresarial para control de empleados, clientes, facturación y jornadas laborales",
  applicationName: "CONTENDO GESTIONES",
  authors: [{ name: "CONTENDO GESTIONES" }],
  generator: "Next.js",
  keywords: ["gestión", "empresa", "rrhh", "fichajes", "facturación"],
  // manifest: "/manifest.json", // Gestionado manualmente en <head> para soporte de credenciales
  icons: {
    icon: "/icon-192.png",
    shortcut: "/icon-192.png",
    apple: "/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CONTENDO GESTIONES",
  },
  formatDetection: {
    telephone: false,
  },
  verification: {
    google: "2zFmN73-46TyFbR4AAj81JKyrH9WpjEhph7_rCIiZsE",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // Evita zoom accidental, mejor experiencia app-like
};
