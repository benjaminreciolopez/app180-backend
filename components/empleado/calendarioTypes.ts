// src/components/empleado/calendarioTypes.ts
export type CalendarioTipo =
  | "vacaciones"
  | "baja_medica"
  | "festivo_local"
  | "festivo_nacional"
  | "convenio"
  | "cierre_empresa"
  | "laborable_extra"
  | "domingo"
  | "no_laborable"
  | "jornada"
  | "real_trabajo"
  | "real_descanso"
  | "plan_trabajo"
  | "plan_descanso"
  | string;
export type EstadoAusencia = "pendiente" | "aprobado" | "rechazado";

export type CalendarioEvento = {
  id: string;
  tipo: string;
  subtipo?: string | null; // ✅ AÑADIR
  title?: string | null;
  start: string;
  end?: string | null;
  allDay?: boolean;
  estado?: string | null;
  meta?: any;
};
