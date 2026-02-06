// src/components/empleado/drawer/DrawerMenu.tsx
"use client";

function Row({
  title,
  subtitle,
  onClick,
}: {
  title: string;
  subtitle?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 flex items-center gap-3 active:bg-black/[0.04] transition"
    >
      <div className="flex-1">
        <div className="text-[15px] font-semibold text-gray-900">{title}</div>
        {subtitle ? (
          <div className="text-[13px] text-gray-500 mt-0.5">{subtitle}</div>
        ) : null}
      </div>
      <div className="text-gray-400 text-lg leading-none">›</div>
    </button>
  );
}

function Divider() {
  return <div className="h-px bg-black/5 mx-4" />;
}

export default function DrawerMenu({
  onCalendario,
  onVacaciones,
  onBaja,
  onSolicitudes,
  onLogout,
}: {
  onCalendario: () => void;
  onVacaciones: () => void;
  onBaja: () => void;
  onSolicitudes: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="py-2">
      <Row
        title="Calendario"
        subtitle="Festivos, ausencias y fichajes"
        onClick={onCalendario}
      />
      <Divider />
      <Row
        title="Solicitar vacaciones"
        subtitle="Enviar solicitud al administrador"
        onClick={onVacaciones}
      />
      <Divider />
      <Row
        title="Solicitar baja médica"
        subtitle="Adjuntar documentos si procede"
        onClick={onBaja}
      />
      <Divider />
      <Row
        title="Mis solicitudes"
        subtitle="Estado: pendiente / aprobado / rechazado"
        onClick={onSolicitudes}
      />
      <Divider />
      <Row
        title="Cerrar sesión"
        subtitle="Salir de la aplicación"
        onClick={onLogout}
      />
    </div>
  );
}
