// app/admin/jornadas/types.ts
export type PlantillaTipo = "semanal" | "mensual" | "diaria";

export type BloqueTipo = "trabajo" | "descanso" | "pausa" | "comida" | "otro";

export type Plantilla = {
  id: string;
  empresa_id: string;
  nombre: string;
  descripcion: string | null;
  tipo: PlantillaTipo;
  activo: boolean;
  created_at: string;
  updated_at: string;
};

export type PlantillaDia = {
  id: string;
  plantilla_id: string;
  dia_semana: number; // 1..7
  hora_inicio: string | null; // "HH:MM:SS"
  hora_fin: string | null;
  activo?: boolean; // si existe en tu tabla
};

export type Bloque = {
  id?: string;
  tipo: string; // en BD es text; en UI intentamos BloqueTipo
  hora_inicio: string; // "HH:MM:SS"
  hora_fin: string;
  obligatorio: boolean;
  cliente_id?: string | null;
  cliente_nombre?: string | null;
};

export type Excepcion = {
  id: string;
  plantilla_id: string;
  fecha: string; // "YYYY-MM-DD"
  activo: boolean;
  hora_inicio: string | null;
  hora_fin: string | null;
  nota: string | null;
};

export type Asignacion = {
  id: string;
  cliente_id?: string;
  cliente_nombre?: string;
  empleado_id: string | null;
  plantilla_id: string;
  fecha_inicio: string; // date
  fecha_fin: string | null;
  activo: boolean;
  plantilla_nombre?: string;
};

export type EmpleadoLite = { id: string; nombre: string };

// Preview plan día
export type PlanDia = {
  plantilla_id: string | null;
  fecha: string;
  modo?: "semanal" | "excepcion";
  rango?: { inicio: string; fin: string } | null;
  nota?: string | null;
  bloques: Array<{
    tipo: string;
    inicio: string;
    fin: string;
    obligatorio: boolean;
    cliente_id?: string | null;
    cliente_nombre?: string | null;
  }>;
};
