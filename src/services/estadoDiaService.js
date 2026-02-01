import { sql } from "../db.js";
import { resolverPlanDia } from "./planificacionResolver.js";

function ymd(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

function timeStrToMin(t) {
  if (!t) return null;
  const [hh, mm] = String(t).split(":");
  if (hh == null || mm == null) return null;
  return Number(hh) * 60 + Number(mm);
}

function nowMin() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function dentroDeMargen(actual, objetivo, margen = 15) {
  return actual >= objetivo - margen && actual <= objetivo + margen;
}

async function getAusenciaActiva({ empleadoId, fecha }) {
  const rows = await sql`
    SELECT id, tipo, fecha_inicio, fecha_fin
    FROM ausencias_180
    WHERE empleado_id = ${empleadoId}
      AND estado = 'aprobado'
      AND fecha_inicio <= ${fecha}::date
      AND fecha_fin >= ${fecha}::date
    LIMIT 1
  `;
  return rows[0] || null;
}

function esAusenciaBloqueante(tipo) {
  return tipo === "vacaciones" || tipo === "baja_medica";
}

export async function resolverEstadoDia({
  empresaId,
  empleadoId,
  fecha = ymd(),
  accionEsperada = null, // entrada | descanso_inicio | descanso_fin | salida
}) {
  const plan = await resolverPlanDia({ empresaId, empleadoId, fecha });

  // Día no laboral
  const bloquesTrabajo = (plan.bloques || []).filter(
    (b) => b.tipo === "trabajo"
  );

  if (!bloquesTrabajo.length) {
    return {
      visible: false,
      motivo_oculto: "no_laboral",
      plan,
    };
  }

  const ausencia = await getAusenciaActiva({ empleadoId, fecha });

  if (ausencia && esAusenciaBloqueante(ausencia.tipo)) {
    return {
      visible: false,
      motivo_oculto: "ausencia",
      ausencia,
      plan,
    };
  }

  if (!accionEsperada) {
    return {
      visible: true,
      color: "negro",
      puede_fichar: false,
      accion: null,
      mensaje: "Sin acción definida",
      objetivo_hhmm: null,
      plan,
    };
  }

  const ahora = nowMin();
  const margen = 15;

  let objetivoMin = null;

  if (accionEsperada === "entrada") {
    const b = bloquesTrabajo[0];
    objetivoMin = timeStrToMin(b.inicio);
  }

  if (accionEsperada === "salida") {
    const b = bloquesTrabajo[bloquesTrabajo.length - 1];
    objetivoMin = timeStrToMin(b.fin);
  }

  const bloquesDescanso = (plan.bloques || []).filter((b) =>
    String(b.tipo).includes("descanso")
  );

  if (accionEsperada === "descanso_inicio") {
    const b = bloquesDescanso[0];
    objetivoMin = timeStrToMin(b?.inicio);
  }

  if (accionEsperada === "descanso_fin") {
    const b = bloquesDescanso[0];
    objetivoMin = timeStrToMin(b?.fin);
  }

  if (objetivoMin == null) {
    return {
      visible: true,
      color: "negro",
      puede_fichar: false,
      accion: accionEsperada,
      mensaje: "No hay hora definida para esta acción",
      objetivo_hhmm: null,
      plan,
    };
  }

  const enMargen = dentroDeMargen(ahora, objetivoMin, margen);

  return {
    visible: true,
    color: enMargen ? "rojo" : "negro",
    puede_fichar: enMargen,
    accion: accionEsperada,
    mensaje: enMargen ? "Dentro del margen legal" : "Fuera del margen legal",
    objetivo_hhmm: `${String(Math.floor(objetivoMin / 60)).padStart(2, "0")}:${String(objetivoMin % 60).padStart(2, "0")}`,
    plan,
  };
}
// backend/src/services/estadoDiaService.js
