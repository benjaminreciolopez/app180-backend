// app/empleado/dashboard/usePlanDiaEmpleado.ts
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/services/api";

type BloquePlan = {
  tipo: string;
  inicio: string; // HH:MM:SS (backend)
  fin: string; // HH:MM:SS (backend)
  obligatorio?: boolean;
};

type PlanDia = {
  plantilla_id: string | null;
  plantilla_nombre: string | null;
  fecha: string;
  modo?: "semanal" | "excepcion";
  rango?: { inicio: string; fin: string } | null;
  nota?: string | null;
  bloques: BloquePlan[];
};

type BloqueReal = {
  tipo: "trabajo" | "descanso";
  inicio: string; // ISO
  fin: string; // ISO
  minutos?: number;
  ubicacion?: string | null;
};

type ResumenJornada = {
  fecha?: string | null;
  plantilla_id?: string | null;
  plan_modo?: string | null;
  rango_esperado?: any;
  bloques_esperados?: any[];
  bloques_reales?: BloqueReal[];
  minutos_trabajados?: number;
  minutos_descanso?: number;
  minutos_extra?: number;
  avisos?: string[];
};

type Turno = {
  id: string;
  nombre?: string | null;
  descripcion?: string | null;
  tipo_turno?: string | null;
  tipo_horario?: string | null;
  horas_dia_objetivo?: number | null;
  max_horas_dia?: number | null;
  max_horas_semana?: number | null;
  minutos_descanso_min?: number | null;
  minutos_descanso_max?: number | null;
  nocturno_permitido?: boolean | null;
} | null;

export type PlanDiaEmpleadoResponse = {
  fecha: string;
  empleado_id: string;
  empresa_id: string;
  turno: Turno;
  plan: PlanDia;
  estado_fichaje: {
    estado: "fuera" | "dentro" | "descanso";
    ultimo_fichaje: any | null;
    acciones_permitidas: string[];
  };
  jornada: any | null;
  resumen: ResumenJornada | null;
  avisos: string[];
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function usePlanDiaEmpleado(fecha?: string) {
  const [data, setData] = useState<PlanDiaEmpleadoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fechaUse = useMemo(() => fecha || todayISO(), [fecha]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get("/empleado/plan-dia", {
        params: { fecha: fechaUse },
      });
      setData(r.data as PlanDiaEmpleadoResponse);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || "Error cargando plan");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [fechaUse]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload, fecha: fechaUse };
}
