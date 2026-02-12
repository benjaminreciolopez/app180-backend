// backend/src/controllers/plantillasJornadaController.js
// Refactor completo: validaciones, seguridad multi-empresa, transacciones, y manejo robusto de errores.

import { sql } from "../db.js";
import { resolverPlanDia } from "../services/planificacionResolver.js";
import { inferirTipoTurnoDesdePlan } from "../helpers/turnosInferenciaHelper.js";
import { getOrCreateTurnoCatalogo } from "../services/turnoAutoService.js";
import { recalcularTurnosDesdePlantilla } from "../services/recalcularTurnosDesdePlantilla.js";
import { getEmpresaIdAdminOrThrow } from "../services/authService.js";
import { handleErr } from "../utils/errorHandler.js";

/**
 * Helpers
 */

function toIntOrThrow(v, name) {
  const n = Number(v);
  if (!Number.isInteger(n)) {
    const err = new Error(`${name} inválido`);
    err.status = 400;
    throw err;
  }
  return n;
}

function boolOrNull(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v;
  // tolerancia a frontend enviando strings "true"/"false"
  if (typeof v === "string") {
    if (v.toLowerCase() === "true") return true;
    if (v.toLowerCase() === "false") return false;
  }
  // si llega cualquier otra cosa, lo tratamos como inválido
  return Symbol.for("invalid_boolean");
}

function cmpTime(a, b) {
  return String(a).localeCompare(String(b));
}

// Convierte a ordenado + valida. Si quieres CONTIGUO, activa requireContiguous=true
function validateBloques(bloques, { requireContiguous = true } = {}) {
  if (!Array.isArray(bloques)) {
    const err = new Error("bloques debe ser array");
    err.status = 400;
    throw err;
  }

  const sorted = [...bloques].sort((x, y) =>
    cmpTime(x.hora_inicio, y.hora_inicio),
  );

  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];

    if (!b?.tipo || !b?.hora_inicio || !b?.hora_fin) {
      const err = new Error(
        `Bloque ${i + 1}: requiere tipo, hora_inicio y hora_fin`,
      );
      err.status = 400;
      throw err;
    }

    if (cmpTime(b.hora_inicio, b.hora_fin) >= 0) {
      const err = new Error(
        `Bloque ${i + 1}: hora_fin debe ser posterior a hora_inicio`,
      );
      err.status = 400;
      throw err;
    }

    if (i > 0) {
      const prev = sorted[i - 1];

      // solape
      if (cmpTime(prev.hora_fin, b.hora_inicio) > 0) {
        const err = new Error(`Bloque ${i + 1}: solapa con el anterior`);
        err.status = 400;
        throw err;
      }

      // contigüidad estricta (tu regla: inicio nuevo = fin anterior)
      if (requireContiguous && cmpTime(prev.hora_fin, b.hora_inicio) !== 0) {
        const err = new Error(
          `Bloque ${i + 1}: debe empezar exactamente a ${prev.hora_fin} (fin del bloque anterior)`,
        );
        err.status = 400;
        throw err;
      }
    }
  }

  return sorted;
}

function assertBloquesDentroDeRango(sortedBloques, rangoInicio, rangoFin) {
  // si no hay rango definido, no imponemos esta regla
  if (!rangoInicio || !rangoFin) return;

  for (let i = 0; i < sortedBloques.length; i++) {
    const b = sortedBloques[i];
    if (
      cmpTime(b.hora_inicio, rangoInicio) < 0 ||
      cmpTime(b.hora_fin, rangoFin) > 0
    ) {
      const err = new Error(
        `Bloque ${i + 1}: debe estar dentro del rango ${rangoInicio} - ${rangoFin}`,
      );
      err.status = 400;
      throw err;
    }
  }

  // opcional: que cubran todo el rango
  // si lo quieres obligatorio, descomenta:
  // const first = sortedBloques[0];
  // const last = sortedBloques[sortedBloques.length - 1];
  // if (cmpTime(first.hora_inicio, rangoInicio) !== 0 || cmpTime(last.hora_fin, rangoFin) !== 0) {
  //   const err = new Error(`Los bloques deben cubrir todo el rango ${rangoInicio} - ${rangoFin}`);
  //   err.status = 400;
  //   throw err;
  // }
}

async function assertPlantillaEmpresa(tx, plantillaId, empresaId) {
  const p = await tx`
    select 1
    from plantillas_jornada_180
    where id=${plantillaId} and empresa_id=${empresaId}
    limit 1
  `;
  if (!p.length) {
    const err = new Error("Plantilla no encontrada");
    err.status = 404;
    throw err;
  }
}

async function getPlantillaDiaAndAssertEmpresa(tx, plantillaDiaId, empresaId) {
  const rows = await tx`
    select d.*
    from plantilla_dias_180 d
    join plantillas_jornada_180 p on p.id = d.plantilla_id
    where d.id=${plantillaDiaId} and p.empresa_id=${empresaId}
    limit 1
  `;
  if (!rows.length) {
    const err = new Error("Día de plantilla no encontrado");
    err.status = 404;
    throw err;
  }
  return rows[0];
}

async function getExcepcionAndAssertEmpresa(tx, excepcionId, empresaId) {
  const rows = await tx`
    select ex.*
    from plantilla_excepciones_180 ex
    join plantillas_jornada_180 p on p.id = ex.plantilla_id
    where ex.id=${excepcionId} and p.empresa_id=${empresaId}
    limit 1
  `;
  if (!rows.length) {
    const err = new Error("Excepción no encontrada");
    err.status = 404;
    throw err;
  }
  return rows[0];
}


/**
 * =========================
 * Plantillas
 * =========================
 */
export const listarPlantillas = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);

    const rows = await sql`
      select *
      from plantillas_jornada_180
      where empresa_id=${empresaId}
      order by created_at desc
    `;

    res.json(rows);
  } catch (err) {
    handleErr(res, err, "listarPlantillas");
  }
};

export const crearPlantilla = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { nombre, descripcion, tipo } = req.body || {};

    if (!nombre) return res.status(400).json({ error: "nombre obligatorio" });

    const t = tipo ?? "semanal";

    const r = await sql`
      insert into plantillas_jornada_180 (empresa_id, nombre, descripcion, tipo)
      values (${empresaId}, ${nombre}, ${descripcion ?? null}, ${t})
      returning *
    `;

    res.json(r[0]);
  } catch (err) {
    handleErr(res, err, "crearPlantilla");
  }
};

export const getPlantillaDetalle = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { id } = req.params;

    const p = await sql`
      select *
      from plantillas_jornada_180
      where id=${id} and empresa_id=${empresaId}
      limit 1
    `;

    if (!p.length) return res.status(404).json({ error: "No encontrada" });

    const dias = await sql`
      select *
      from plantilla_dias_180
      where plantilla_id=${id}
      order by dia_semana asc
    `;

    const excepciones = await sql`
      select *
      from plantilla_excepciones_180
      where plantilla_id=${id}
      order by fecha desc
    `;

    res.json({ plantilla: p[0], dias, excepciones });
  } catch (err) {
    handleErr(res, err, "getPlantillaDetalle");
  }
};

export const actualizarPlantilla = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { id } = req.params;
    const { nombre, descripcion, tipo, activo } = req.body || {};

    const activoParsed = boolOrNull(activo);
    if (activoParsed === Symbol.for("invalid_boolean")) {
      return res.status(400).json({ error: "activo debe ser boolean" });
    }

    const r = await sql`
      update plantillas_jornada_180
      set
        nombre = coalesce(${nombre ?? null}, nombre),
        descripcion = coalesce(${descripcion ?? null}, descripcion),
        tipo = coalesce(${tipo ?? null}, tipo),
        activo = coalesce(${activoParsed}, activo)
      where id=${id} and empresa_id=${empresaId}
      returning *
    `;

    if (!r.length) return res.status(404).json({ error: "No encontrada" });

    res.json(r[0]);
  } catch (err) {
    handleErr(res, err, "actualizarPlantilla");
  }
};

export const borrarPlantilla = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { id } = req.params;

    // Si prefieres borrado lógico, cambia por update activo=false
    const r = await sql`
      delete from plantillas_jornada_180
      where id=${id} and empresa_id=${empresaId}
      returning id
    `;
    if (!r.length) return res.status(404).json({ error: "No encontrada" });

    res.json({ ok: true });
  } catch (err) {
    handleErr(res, err, "borrarPlantilla");
  }
};

/**
 * =========================
 * Días (semanales)
 * =========================
 */
export const upsertDiaSemana = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { id, dia_semana } = req.params;
    const { hora_inicio, hora_fin, activo } = req.body || {};

    if (!hora_inicio || !hora_fin) {
      return res
        .status(400)
        .json({ error: "hora_inicio y hora_fin obligatorias" });
    }

    const diaSemana = toIntOrThrow(dia_semana, "dia_semana");
    if (diaSemana < 1 || diaSemana > 7) {
      return res
        .status(400)
        .json({ error: "dia_semana debe estar entre 1 y 7" });
    }

    const activoParsed = boolOrNull(activo);
    if (activoParsed === Symbol.for("invalid_boolean")) {
      return res.status(400).json({ error: "activo debe ser boolean" });
    }

    const result = await sql.begin(async (tx) => {
      await assertPlantillaEmpresa(tx, id, empresaId);

      const r = await tx`
        insert into plantilla_dias_180 (plantilla_id, dia_semana, hora_inicio, hora_fin, activo)
        values (
          ${id},
          ${diaSemana},
          ${hora_inicio},
          ${hora_fin},
          coalesce(${activoParsed}, true)
        )
        on conflict (plantilla_id, dia_semana) do update set
          hora_inicio=excluded.hora_inicio,
          hora_fin=excluded.hora_fin,
          activo=excluded.activo
        returning *
      `;
      return r[0];
    });

    res.json(result);
  } catch (err) {
    handleErr(res, err, "upsertDiaSemana");
  }
};

export const getBloquesDia = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { plantilla_dia_id } = req.params;

    const rows = await sql.begin(async (tx) => {
      await getPlantillaDiaAndAssertEmpresa(tx, plantilla_dia_id, empresaId);

      return tx`
        select id, tipo, hora_inicio, hora_fin, obligatorio
        from plantilla_bloques_180
        where plantilla_dia_id=${plantilla_dia_id}
        order by hora_inicio asc
      `;
    });

    res.json(rows);
  } catch (err) {
    handleErr(res, err, "getBloquesDia");
  }
};

export const upsertBloquesDia = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { plantilla_dia_id } = req.params;
    const { bloques } = req.body || {};

    const out = await sql.begin(async (tx) => {
      const dia = await getPlantillaDiaAndAssertEmpresa(
        tx,
        plantilla_dia_id,
        empresaId,
      );

      // VALIDACION FUERTE
      const sorted = validateBloques(bloques, { requireContiguous: true });
      assertBloquesDentroDeRango(sorted, dia.hora_inicio, dia.hora_fin);

      if (sorted.length === 0) {
        const err = new Error("Debe existir al menos un bloque");
        err.status = 400;
        throw err;
      }

      // atomicidad: delete + insert
      await tx`delete from plantilla_bloques_180 where plantilla_dia_id=${plantilla_dia_id}`;

      for (const b of sorted) {
        const obligatorioParsed = boolOrNull(b.obligatorio);
        if (obligatorioParsed === Symbol.for("invalid_boolean")) {
          const err = new Error("obligatorio debe ser boolean");
          err.status = 400;
          throw err;
        }

        await tx`
          insert into plantilla_bloques_180 (plantilla_dia_id, tipo, hora_inicio, hora_fin, obligatorio, cliente_id)
          values (
            ${plantilla_dia_id},
            ${b.tipo},
            ${b.hora_inicio},
            ${b.hora_fin},
            coalesce(${obligatorioParsed}, true),
            ${b.cliente_id || null}
          )
        `;
        // 🔁 Recalcular turnos de empleados con esta plantilla
        const plantillaDia = await tx`
        SELECT plantilla_id
        FROM plantilla_dias_180
        WHERE id = ${plantilla_dia_id}
        LIMIT 1
      `;

        if (plantillaDia.length) {
          await recalcularTurnosDesdePlantilla({
            empresaId,
            plantillaId: plantillaDia[0].plantilla_id,
            tx,
          });
        }
      }

      return tx`
        select id, tipo, hora_inicio, hora_fin, obligatorio
        from plantilla_bloques_180
        where plantilla_dia_id=${plantilla_dia_id}
        order by hora_inicio asc
      `;
    });

    res.json(out);
  } catch (err) {
    handleErr(res, err, "upsertBloquesDia");
  }
};
/**
 * =========================
 * Excepciones por fecha
 * =========================
 */
export const upsertExcepcionFecha = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { id, fecha } = req.params; // plantilla id, fecha YYYY-MM-DD
    const { hora_inicio, hora_fin, activo, nota } = req.body || {};

    const activoParsed = boolOrNull(activo);
    if (activoParsed === Symbol.for("invalid_boolean")) {
      return res.status(400).json({ error: "activo debe ser boolean" });
    }

    const out = await sql.begin(async (tx) => {
      await assertPlantillaEmpresa(tx, id, empresaId);

      const r = await tx`
        insert into plantilla_excepciones_180 (plantilla_id, fecha, hora_inicio, hora_fin, activo, nota)
        values (
          ${id},
          ${fecha}::date,
          ${hora_inicio ?? null},
          ${hora_fin ?? null},
          coalesce(${activoParsed}, true),
          ${nota ?? null}
        )
        on conflict (plantilla_id, fecha) do update set
          hora_inicio=excluded.hora_inicio,
          hora_fin=excluded.hora_fin,
          activo=excluded.activo,
          nota=excluded.nota
        returning *
      `;
      return r[0];
    });

    res.json(out);
  } catch (err) {
    handleErr(res, err, "upsertExcepcionFecha");
  }
};

export const getBloquesExcepcion = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { excepcion_id } = req.params;

    const rows = await sql.begin(async (tx) => {
      await getExcepcionAndAssertEmpresa(tx, excepcion_id, empresaId);

      return tx`
        select id, tipo, hora_inicio, hora_fin, obligatorio
        from plantilla_excepcion_bloques_180
        where excepcion_id=${excepcion_id}
        order by hora_inicio asc
      `;
    });

    res.json(rows);
  } catch (err) {
    handleErr(res, err, "getBloquesExcepcion");
  }
};

export const upsertBloquesExcepcion = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { excepcion_id } = req.params;
    const { bloques } = req.body || {};

    const out = await sql.begin(async (tx) => {
      const ex = await getExcepcionAndAssertEmpresa(
        tx,
        excepcion_id,
        empresaId,
      );

      // VALIDACION FUERTE
      const sorted = validateBloques(bloques, { requireContiguous: true });
      assertBloquesDentroDeRango(sorted, ex.hora_inicio, ex.hora_fin);

      if (sorted.length === 0) {
        const err = new Error("Debe existir al menos un bloque");
        err.status = 400;
        throw err;
      }

      await tx`delete from plantilla_excepcion_bloques_180 where excepcion_id=${excepcion_id}`;

      for (const b of sorted) {
        const obligatorioParsed = boolOrNull(b.obligatorio);
        if (obligatorioParsed === Symbol.for("invalid_boolean")) {
          const err = new Error("obligatorio debe ser boolean");
          err.status = 400;
          throw err;
        }

        await tx`
          insert into plantilla_excepcion_bloques_180 (excepcion_id, tipo, hora_inicio, hora_fin, obligatorio, cliente_id)
          values (
            ${excepcion_id},
            ${b.tipo},
            ${b.hora_inicio},
            ${b.hora_fin},
            coalesce(${obligatorioParsed}, true),
            ${b.cliente_id || null}
          )
        `;

        // 🔁 Recalcular turnos de empleados con esta plantilla
        await recalcularTurnosDesdePlantilla({
          empresaId,
          plantillaId: ex.plantilla_id,
          fecha: ex.fecha,
          tx,
        });
      }

      return tx`
        select id, tipo, hora_inicio, hora_fin, obligatorio
        from plantilla_excepcion_bloques_180
        where excepcion_id=${excepcion_id}
        order by hora_inicio asc
      `;
    });

    res.json(out);
  } catch (err) {
    handleErr(res, err, "upsertBloquesExcepcion");
  }
};

/**
 * =========================
 * Asignaciones
 * =========================
 */
// helper: null = abierto
function normDateOrNull(v) {
  const s = (v ?? "").toString().trim();
  return s ? s : null;
}

export const asignarPlantillaEmpleado = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);

    // cliente_id ahora es OPCIONAL
    const { empleado_id, plantilla_id, cliente_id, fecha_inicio, fecha_fin, alias, color, ignorar_festivos } = req.body || {};
    const inicioStr = normDateOrNull(fecha_inicio);
    const fin = normDateOrNull(fecha_fin);

    console.log("[DEBUG] Asignar:", { empleado_id, plantilla_id, inicioStr, fin });

    if (!plantilla_id) {
      return res.status(400).json({ error: "Falta plantilla_id" });
    }

    if (fin && inicioStr && fin < inicioStr) {
      return res.status(400).json({ error: "La fecha de fin no puede ser anterior a la de inicio" });
    }

    const out = await sql.begin(async (tx) => {
      // ... (validaciones iguales)
      // =========================
      // Validar empleado (si viene) y plantilla (multiempresa)
      // =========================
      if (empleado_id) {
        const e = await tx`
          select 1
          from employees_180
          where id=${empleado_id} and empresa_id=${empresaId}
          limit 1
        `;
        if (!e.length) {
          const err = new Error("Empleado no válido");
          err.status = 404;
          throw err;
        }
      }

      const p = await tx`
        select 1
        from plantillas_jornada_180
        where id=${plantilla_id}
          and empresa_id=${empresaId}
          and activo=true
        limit 1
      `;
      if (!p.length) {
        const err = new Error("Plantilla no válida o inactiva");
        err.status = 404;
        throw err;
      }

      // Validar cliente SOLO si viene
      if (cliente_id) {
        const c = await tx`
          select 1
          from clients_180
          where id=${cliente_id}
            and empresa_id=${empresaId}
            and activo=true
          limit 1
        `;

        if (!c.length) {
          const err = new Error("Cliente no válido");
          err.status = 404;
          throw err;
        }
      }

      // =========================
      // Fecha HOY desde Postgres (fallback)
      // =========================
      const [{ hoy }] = await tx`select current_date as hoy`;
      const finalInicio = inicioStr || hoy;

      // =========================
      // 1. Cerrar asignación activa si existe (starts before, intersects)
      // =========================

      // Construir filtro de empleado dinámicamente para evitar bug de "Optional param"
      const filtroEmpleado = empleado_id
        ? sql`and empleado_id = ${empleado_id}`
        : sql`and empleado_id IS NULL`;

      await tx`
        update empleado_plantillas_180
        set fecha_fin = greatest(fecha_inicio, ${finalInicio}::date - interval '1 day')
        where empresa_id = ${empresaId}
          ${filtroEmpleado}
          and (fecha_fin is null OR fecha_fin >= ${finalInicio}::date)
          and fecha_inicio < ${finalInicio}::date
      `;

      // =========================
      // 2. Eliminar/Acortar asignaciones FUTURAS que solapen totalmente
      // =========================
      if (!fin) {
        // Nueva es indefinida -> Borrar todo lo que empiece >= hoy
        await tx`
            delete from empleado_plantillas_180
            where empresa_id = ${empresaId}
              ${filtroEmpleado}
              and fecha_inicio >= ${finalInicio}::date
          `;
      } else {
        // Nueva tiene fin -> Borrar lo que solape en el rango [inicio, fin]
        await tx`
            delete from empleado_plantillas_180
            where empresa_id = ${empresaId}
               ${filtroEmpleado}
              and fecha_inicio >= ${finalInicio}::date
              and fecha_inicio <= ${fin}::date
          `;
      }

      // =========================
      // Insertar nueva asignación
      // =========================
      const r = await tx`
        insert into empleado_plantillas_180 (
          empleado_id,
          plantilla_id,
          cliente_id,
          fecha_inicio,
          fecha_fin,
          empresa_id,
          alias,
          color,
          ignorar_festivos
        )
        values (
          ${empleado_id || null},
          ${plantilla_id},
          ${cliente_id || null},
          ${finalInicio}::date,
          ${fin}::date,
          ${empresaId},
          ${alias || null},
          ${color || null},
          ${ignorar_festivos ? true : false}
        )
        returning *
      `;
      const asignacion = r[0];

      if (empleado_id) {
        // =========================
        // Resolver plan del día y deducir tipo de turno
        // =========================
        const plan = await resolverPlanDia({
          empresaId,
          empleadoId: empleado_id,
          fecha: new Date(finalInicio).toISOString().slice(0, 10),
        });

        const tipo_turno = inferirTipoTurnoDesdePlan(plan);

        // =========================
        // Obtener o crear turno catálogo
        // =========================
        const turno = await getOrCreateTurnoCatalogo(
          { empresaId, tipo: tipo_turno },
          tx,
        );

        // =========================
        // Asignar turno al empleado
        // =========================
        await tx`
          update employees_180
          set turno_id = ${turno.id}
          where id = ${empleado_id}
            and empresa_id = ${empresaId}
        `;

        return {
          asignacion,
          turno_auto: {
            tipo_turno,
            turno_id: turno.id,
            turno_nombre: turno.nombre,
          },
        };
      }

      return { asignacion };
    });

    res.json(out);
  } catch (err) {
    if (err?.code === "23P01") {
      return res.status(409).json({
        error: "Conflicto de fechas en asignación",
      });
    }

    handleErr(res, err, "asignarPlantillaEmpleado");
  }
};

export const listarAsignacionesEmpleado = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    let { empleado_id } = req.params;

    if (empleado_id === "null" || empleado_id === "undefined") {
      empleado_id = null;
    }

    const r = await sql`
      select
        id,
        fecha_inicio,
        fecha_fin,
        plantilla_id,
        (select nombre from plantillas_jornada_180 where id = empleado_plantillas_180.plantilla_id) as plantilla_nombre,
        cliente_id,
        (select nombre from clients_180 where id = empleado_plantillas_180.cliente_id) as cliente_nombre,
        alias,
        color,
        ignorar_festivos
      from empleado_plantillas_180
      where empresa_id=${empresaId}
        and (${empleado_id}::uuid IS NULL OR empleado_id=${empleado_id})
      order by fecha_inicio desc
    `;

    res.json(r);
  } catch (err) {
    handleErr(res, err, "listarAsignacionesEmpleado");
  }
};

/**
 * Endpoint Admin: Listado global con filtros
 * GET /admin/plantillas/asignaciones
 */
export const listarAsignaciones = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { empleado_id, desde, hasta, estado } = req.query; // estado: 'activos', 'historial'

    let filters = sql`a.empresa_id = ${empresaId}`;

    if (empleado_id) {
      if (empleado_id === 'null' || empleado_id === 'admin') {
        filters = sql`${filters} AND a.empleado_id IS NULL`;
      } else {
        filters = sql`${filters} AND a.empleado_id = ${empleado_id}`;
      }
    }

    if (desde) {
      filters = sql`${filters} AND (a.fecha_fin IS NULL OR a.fecha_fin >= ${desde}::date)`;
    }
    if (hasta) {
      filters = sql`${filters} AND a.fecha_inicio <= ${hasta}::date`;
    }

    if (estado === 'activos') {
      // Activos hoy o futuro
      filters = sql`${filters} AND (a.fecha_fin IS NULL OR a.fecha_fin >= current_date)`;
    } else if (estado === 'historial') {
      filters = sql`${filters} AND a.fecha_fin < current_date`;
    }

    const rows = await sql`
      SELECT
        a.id,
        a.empleado_id,
        e.nombre as empleado_nombre,
        a.plantilla_id,
        p.nombre as plantilla_nombre,
        a.cliente_id,
        c.nombre as cliente_nombre,
        a.fecha_inicio,
        a.fecha_fin,
        a.alias,
        a.color,
        a.ignorar_festivos
      FROM empleado_plantillas_180 a
      LEFT JOIN employees_180 e ON e.id = a.empleado_id
      JOIN plantillas_jornada_180 p ON p.id = a.plantilla_id
      LEFT JOIN clients_180 c ON c.id = a.cliente_id
      WHERE ${filters}
      ORDER BY a.fecha_inicio DESC
    `;

    res.json(rows);
  } catch (err) {
    handleErr(res, err, "listarAsignaciones");
  }
};

/**
 * Endpoint Admin: Actualizar asignación
 * PUT /admin/plantillas/asignaciones/:id
 */
export const actualizarAsignacion = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { id } = req.params;
    const { fecha_fin, alias, color, ignorar_festivos } = req.body;

    const r = await sql`
      UPDATE empleado_plantillas_180
      SET
        fecha_fin = ${normDateOrNull(fecha_fin)}::date,
        alias = ${alias || null},
        color = ${color || null},
        ignorar_festivos = ${boolOrNull(ignorar_festivos) ?? false}
      WHERE id = ${id} AND empresa_id = ${empresaId}
      RETURNING *
    `;

    if (!r.length) return res.status(404).json({ error: "Asignación no encontrada" });

    // TODO: Si cambiamos fecha_fin, deberíamos recalcular turnos si la lógica auto lo requiere,
    // pero por ahora es visual/planing.

    res.json(r[0]);
  } catch (err) {
    handleErr(res, err, "actualizarAsignacion");
  }
};

/**
 * Endpoint Admin: Obtener asignación por ID
 * GET /admin/plantillas/asignaciones/:id
 */
export const getAsignacion = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { id } = req.params;

    const r = await sql`
      SELECT
        a.id,
        a.empleado_id,
        e.nombre as empleado_nombre,
        a.plantilla_id,
        p.nombre as plantilla_nombre,
        a.cliente_id,
        c.nombre as cliente_nombre,
        a.fecha_inicio,
        a.fecha_fin,
        a.alias,
        a.color,
        a.ignorar_festivos
      FROM empleado_plantillas_180 a
      LEFT JOIN employees_180 e ON e.id = a.empleado_id
      JOIN plantillas_jornada_180 p ON p.id = a.plantilla_id
      LEFT JOIN clients_180 c ON c.id = a.cliente_id
      WHERE a.id = ${id} AND a.empresa_id = ${empresaId}
    `;

    if (!r.length) return res.status(404).json({ error: "Asignación no encontrada" });

    res.json(r[0]);
  } catch (err) {
    handleErr(res, err, "getAsignacion");
  }
};

/**
 * Endpoint Admin: Borrar asignación
 * DELETE /admin/plantillas/asignaciones/:id
 */
export const borrarAsignacion = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { id } = req.params;

    const r = await sql`
      DELETE FROM empleado_plantillas_180
      WHERE id = ${id} AND empresa_id = ${empresaId}
      RETURNING id
    `;

    if (!r.length) return res.status(404).json({ error: "Asignación no encontrada" });

    res.json({ ok: true });
  } catch (err) {
    handleErr(res, err, "borrarAsignacion");
  }
};

/**
 * =========================
 * Planificación (resolver)
 * =========================
 */
export const getPlanDiaEmpleado = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { empleado_id } = req.params;

    const fecha =
      String(req.query.fecha || "").trim() ||
      new Date().toISOString().slice(0, 10);

    const e =
      await sql`select 1 from employees_180 where id=${empleado_id} and empresa_id=${empresaId} limit 1`;
    if (!e.length) return res.status(404).json({ error: "Empleado no válido" });

    const plan = await resolverPlanDia({
      empresaId,
      empleadoId: empleado_id,
      fecha,
    });

    res.json(plan);
  } catch (err) {
    handleErr(res, err, "getPlanDiaEmpleado");
  }
};
export const replicarDiaSemana = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { id } = req.params;

    const { dia_origen, dias_destino, sobrescribir = true } = req.body || {};

    const origen = toIntOrThrow(dia_origen, "dia_origen");

    if (!Array.isArray(dias_destino) || dias_destino.length === 0) {
      return res.status(400).json({
        error: "dias_destino debe ser un array no vacío",
      });
    }

    const destinos = dias_destino.map((d) => toIntOrThrow(d, "dia_destino"));

    if (origen < 1 || origen > 7) {
      return res.status(400).json({ error: "dia_origen inválido (1-7)" });
    }

    for (const d of destinos) {
      if (d < 1 || d > 7) {
        return res.status(400).json({ error: "dia_destino inválido (1-7)" });
      }
    }

    const out = await sql.begin(async (tx) => {
      // Validar plantilla
      await assertPlantillaEmpresa(tx, id, empresaId);

      // Obtener día origen
      const [diaBase] = await tx`
        SELECT id
        FROM plantilla_dias_180
        WHERE plantilla_id=${id}
          AND dia_semana=${origen}
        LIMIT 1
      `;

      if (!diaBase) {
        const err = new Error("Día origen sin configuración");
        err.status = 400;
        throw err;
      }

      // Bloques del origen
      const bloques = await tx`
        SELECT tipo, hora_inicio, hora_fin, obligatorio
        FROM plantilla_bloques_180
        WHERE plantilla_dia_id=${diaBase.id}
        ORDER BY hora_inicio
      `;

      if (!bloques.length) {
        const err = new Error("El día origen no tiene bloques");
        err.status = 400;
        throw err;
      }

      const copiados = [];

      for (const dia of destinos) {
        // Crear / obtener día destino
        const [dest] = await tx`
          INSERT INTO plantilla_dias_180
            (plantilla_id, dia_semana, hora_inicio, hora_fin, activo)
          SELECT
            plantilla_id,
            ${dia},
            hora_inicio,
            hora_fin,
            activo
          FROM plantilla_dias_180
          WHERE id=${diaBase.id}
          ON CONFLICT (plantilla_id, dia_semana)
          DO UPDATE SET
            hora_inicio = EXCLUDED.hora_inicio,
            hora_fin = EXCLUDED.hora_fin,
            activo = EXCLUDED.activo
          RETURNING id
        `;

        if (sobrescribir) {
          await tx`
            DELETE FROM plantilla_bloques_180
            WHERE plantilla_dia_id=${dest.id}
          `;
        }

        // Si no sobrescribe y ya hay bloques → saltar
        if (!sobrescribir) {
          const [{ count }] = await tx`
            SELECT COUNT(*)::int AS count
            FROM plantilla_bloques_180
            WHERE plantilla_dia_id=${dest.id}
          `;

          if (count > 0) continue;
        }

        // Copiar bloques
        for (const b of bloques) {
          await tx`
            INSERT INTO plantilla_bloques_180
              (plantilla_dia_id, tipo, hora_inicio, hora_fin, obligatorio)
            VALUES
              (
                ${dest.id},
                ${b.tipo},
                ${b.hora_inicio},
                ${b.hora_fin},
                ${b.obligatorio}
              )
          `;
        }

        copiados.push(dia);
      }

      return { copiados };
    });

    res.json({
      ok: true,
      dia_origen: origen,
      dias_destino: out.copiados,
    });
  } catch (err) {
    handleErr(res, err, "replicarDiaSemana");
  }
};
export async function resetDiaPlantilla(req, res, next) {
  try {
    const { id } = req.params;

    await sql.begin(async (tx) => {
      // Desactivar rango
      await tx`
        UPDATE plantilla_dias_180
        SET
          hora_inicio = NULL,
          hora_fin = NULL,
          activo = false
        WHERE id = ${id}
      `;

      // Borrar bloques
      await tx`
        DELETE FROM plantilla_bloques_180
        WHERE plantilla_dia_id = ${id}
      `;
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
export const desasignarPlantillaEmpleado = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { empleado_id } = req.body || {};

    if (!empleado_id) {
      return res.status(400).json({ error: "empleado_id es obligatorio" });
    }

    await sql.begin(async (tx) => {
      // Validar empleado
      const e = await tx`
        select 1
        from employees_180
        where id=${empleado_id} and empresa_id=${empresaId}
        limit 1
      `;
      if (!e.length) {
        const err = new Error("Empleado no válido");
        err.status = 404;
        throw err;
      }

      // Fecha HOY desde Postgres
      const [{ hoy }] = await tx`select current_date as hoy`;

      // Cerrar TODAS las asignaciones abiertas
      await tx`
        update empleado_plantillas_180
        set fecha_fin = greatest(fecha_inicio, ${hoy}::date - interval '1 day')
        where empleado_id = ${empleado_id}
          and fecha_fin is null
      `;
    });

    res.json({ ok: true, message: "Asignaciones cerradas correctamente" });
  } catch (err) {
    handleErr(res, err, "desasignarPlantillaEmpleado");
  }
};


export const renovarAsignacion = async (req, res) => {
  try {
    // Placeholder implementation to fix deployment error
    // TODO: Implement logic
    res.status(501).json({ error: "Not Implemented" });
  } catch (err) {
    handleErr(res, err, "renovarAsignacion");
  }
};
