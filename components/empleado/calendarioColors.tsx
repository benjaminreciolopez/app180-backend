export const COLOR_MAP: Record<string, string> = {
  // Ausencias
  vacaciones: "#3b82f6", // azul
  baja_medica: "#ef4444", // rojo

  // Festivos y no laborables
  festivo: "#f59e0b", // ámbar
  festivo_local: "#f59e0b",
  festivo_nacional: "#f59e0b",
  festivo_empresa: "#f59e0b",
  no_laborable: "#fbbf24",
  domingo: "#fde68a", // amarillo claro
  laborable_extra: "#0ea5e9", // 🔵 AZUL CLARO

  // Empresa
  cierre_empresa: "#a855f7", // morado
  convenio: "#8b5cf6",

  // Jornadas
  jornada: "#22c55e",
  jornada_real: "#16a34a",
  jornada_plan: "#4ade80",

  // Planificación
  plan_trabajo: "#0ea5e9",
  plan_descanso: "#38bdf8",

  // Real
  real_trabajo: "#10b981",
  real_descanso: "#6ee7b7",

  // Fichajes
  fichaje: "#6366f1",

  // Incidencias
  incidencia: "#ec4899",

  // Por defecto
  default: "#9ca3af", // gris
};

export function colorFor(tipo?: string | null, estado?: string | null) {
  if (!tipo) return COLOR_MAP.default;

  const key = tipo.toLowerCase();

  const col = COLOR_MAP[key];

  if (!COLOR_MAP[key]) {
    console.warn("Color no definido para tipo:", key);
    return COLOR_MAP.default;
  }

  if (!col) {
    console.warn("Color no definido para tipo:", key);
    return COLOR_MAP.default;
  }

  // Opcional: matizar por estado
  if (estado === "pendiente") return "#f97316"; // naranja
  if (estado === "rechazado") return "#6b7280"; // gris oscuro

  return col;
}
