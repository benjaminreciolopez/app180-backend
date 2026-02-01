import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "CONTENDO - Empleado",
  description: "Aplicación de empleado para fichajes y gestión de jornadas",
  applicationName: "CONTENDO",
  manifest: "/manifest-empleado.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CONTENDO",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0f172a",
};

export default function EmpleadoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
