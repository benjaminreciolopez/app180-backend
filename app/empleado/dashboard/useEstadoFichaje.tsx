"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import type { AccionFichaje } from "./FichajeAction";

export type BotonEstado = {
  visible: boolean;
  color: "rojo" | "negro";
  puede_fichar: boolean;
  mensaje: string | null;
  accion: AccionFichaje | null;
  objetivo_hhmm: string | null;
  margen_antes: number;
  margen_despues: number;
  motivo_oculto: string | null;

  // ✅ AÑADIR
  ausencia?: {
    id: string;
    tipo: "vacaciones" | "baja_medica" | string;
    fecha_inicio: string;
    fecha_fin: string;
  } | null;

  calendario?: {
    tipo: string;
    nombre: string | null;
    descripcion: string | null;
    origen: string;
    confirmado: boolean;
  } | null;
};

export function useEstadoFichaje() {
  const [estado, setEstado] = useState<"fuera" | "dentro" | "descanso" | null>(
    null,
  );
  const [boton, setBoton] = useState<BotonEstado | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/fichajes/estado");

      setEstado(res.data?.estado ?? null);

      // contrato nuevo
      const b = res.data?.boton || null;
      setBoton(
        b
          ? {
              visible: Boolean(b.visible),
              color: b.color === "rojo" ? "rojo" : "negro",
              puede_fichar: Boolean(b.puede_fichar),
              mensaje: b.mensaje ?? null,
              accion: (b.accion as AccionFichaje) ?? null,
              objetivo_hhmm: b.objetivo_hhmm ?? null,
              margen_antes: Number(b.margen_antes ?? 15),
              margen_despues: Number(b.margen_despues ?? 15),
              motivo_oculto: b.motivo_oculto ?? null,

              // ✅ AÑADIR
              ausencia: b.ausencia ?? null,
              calendario: b.calendario ?? null,
            }
          : null,
      );
      console.log("BOTON ESTADO:", b);
    } catch (e) {
      console.error("Error cargando estado fichaje", e);
      setEstado(null);
      setBoton(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return { estado, boton, loading, reload: load };
}
