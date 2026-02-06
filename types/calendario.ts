export type CalendarioIntegradoTipo =
  | "calendario_empresa"
  | "no_laborable"
  | "ausencia"
  | "jornada_real"
  | "jornada_plan";

export type CalendarioIntegradoEvento = {
  id: string;
  tipo: CalendarioIntegradoTipo;
  title: string;
  start: string; // "YYYY-MM-DD" o ISO datetime
  end: string | null;
  allDay: boolean;
  estado: string | null; // para ausencias / jornada_real
  empleado_id: string | null;
  empleado_nombre: string | null;
  meta: any | null;
};
