export type TipoAusencia = "vacaciones" | "baja_medica";
export type EstadoAusencia = "pendiente" | "aprobado" | "rechazado";

export type AusenciaBase = {
  id: string;
  empleado_id: string;
  empleado_nombre: string;
  tipo: TipoAusencia;
  estado: EstadoAusencia;
};

export type EventoAdmin = AusenciaBase & {
  start: string;
  end: string;
  comentario_empleado?: string | null;
  comentario_admin?: string | null;
};

export type Pendiente = AusenciaBase & {
  fecha_inicio: string;
  fecha_fin: string;
  comentario_empleado?: string | null;
  creado_en?: string | null;
};
