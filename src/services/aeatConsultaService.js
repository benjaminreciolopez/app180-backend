// backend/src/services/aeatConsultaService.js
// Servicio para verificar coherencia entre datos presentados y datos actuales
// Compara el snapshot guardado al presentar vs el cálculo actual para detectar discrepancias

import { sql } from '../db.js';
import logger from '../utils/logger.js';

// =========================
// FUNCIONES PRINCIPALES
// =========================

/**
 * Realizar verificación completa: comparar datos presentados vs datos recalculados
 * Esta es la función principal que orquesta todo el flujo
 */
export async function realizarConsultaCompleta(empresaId, certificadoId, modelo, ejercicio, periodo, userId) {
  // 1. Cargar datos presentados (snapshot guardado al presentar)
  const datosPresentados = await cargarDatosPresentados(empresaId, modelo, ejercicio, periodo);

  if (!datosPresentados) {
    throw new Error(
      `No se encontró una presentación del modelo ${modelo} ${periodo || ''} del ejercicio ${ejercicio}. ` +
      `Solo se pueden verificar modelos que hayan sido presentados desde la app.`
    );
  }

  // 2. Cargar datos actuales recalculados de la app
  const datosActuales = await cargarDatosApp(empresaId, modelo, ejercicio, periodo);

  // 3. Cargar mapeo de campos para este modelo
  const mapeos = await sql`
    SELECT * FROM aeat_campo_mapeo_180
    WHERE modelo = ${modelo}
    ORDER BY casilla
  `;

  // 4. Detectar discrepancias entre presentado y actual
  const discrepancias = detectarDiscrepancias(datosPresentados.datos, datosActuales, mapeos);

  // 5. Guardar consulta en BD
  const resumen = {
    total: discrepancias.length,
    altas: discrepancias.filter(d => d.severidad === 'alta').length,
    medias: discrepancias.filter(d => d.severidad === 'media').length,
    bajas: discrepancias.filter(d => d.severidad === 'baja').length,
  };

  const [consulta] = await sql`
    INSERT INTO aeat_consultas_180 (
      empresa_id, ejercicio, modelo, periodo,
      tipo_consulta, datos_aeat, datos_app, discrepancias_resumen, estado
    ) VALUES (
      ${empresaId}, ${ejercicio}, ${modelo}, ${periodo || '0A'},
      'verificacion_local',
      ${JSON.stringify({ presentado: datosPresentados.datos, fecha_presentacion: datosPresentados.fecha })},
      ${JSON.stringify(datosActuales)},
      ${JSON.stringify(resumen)},
      ${resumen.altas > 0 ? 'pendiente' : resumen.medias > 0 ? 'pendiente' : 'resuelto'}
    )
    RETURNING *
  `;

  // 6. Guardar discrepancias individuales
  for (const disc of discrepancias) {
    await sql`
      INSERT INTO aeat_discrepancias_180 (
        consulta_id, empresa_id, modelo, ejercicio, periodo,
        casilla, campo_app, descripcion_campo,
        valor_app, valor_aeat, diferencia, porcentaje_diferencia,
        severidad
      ) VALUES (
        ${consulta.id}, ${empresaId}, ${modelo}, ${ejercicio}, ${periodo || '0A'},
        ${disc.casilla}, ${disc.campo_app}, ${disc.descripcion},
        ${disc.valor_actual}, ${disc.valor_presentado}, ${disc.diferencia}, ${disc.porcentaje},
        ${disc.severidad}
      )
    `;
  }

  logger.info(`Verificación modelo ${modelo}: empresa=${empresaId} ejercicio=${ejercicio} discrepancias=${resumen.total} (${resumen.altas} altas)`);

  return {
    consulta,
    discrepancias,
    resumen,
    datos_presentados: datosPresentados,
    datos_actuales: datosActuales,
  };
}

/**
 * Cargar datos presentados (snapshot guardado al momento de presentar)
 */
async function cargarDatosPresentados(empresaId, modelo, ejercicio, periodo) {
  switch (modelo) {
    case '303':
    case '130':
    case '111':
    case '115':
    case '349': {
      // Modelos trimestrales: buscar en fiscal_models_180 solo si fue presentado
      const [fiscal] = await sql`
        SELECT datos_json, presentado_at, aeat_respuesta_json, resultado_importe, resultado_tipo
        FROM fiscal_models_180
        WHERE empresa_id = ${empresaId}
          AND modelo = ${modelo}
          AND ejercicio = ${parseInt(ejercicio)}
          AND periodo = ${periodo}
          AND estado = 'PRESENTADO'
        ORDER BY presentado_at DESC LIMIT 1
      `;
      if (!fiscal || !fiscal.datos_json) return null;
      return {
        datos: fiscal.datos_json,
        fecha: fiscal.presentado_at,
        respuesta_aeat: fiscal.aeat_respuesta_json,
        resultado_importe: fiscal.resultado_importe,
      };
    }

    case '390':
    case '190':
    case '180':
    case '347': {
      // Modelos anuales: buscar en modelos_anuales_180 solo si fue presentado
      const [anual] = await sql`
        SELECT datos_calculados, fecha_presentacion, csv_presentacion, numero_justificante
        FROM modelos_anuales_180
        WHERE empresa_id = ${empresaId}
          AND modelo = ${modelo}
          AND ejercicio = ${parseInt(ejercicio)}
          AND estado = 'presentado'
        ORDER BY fecha_presentacion DESC LIMIT 1
      `;
      if (!anual || !anual.datos_calculados) return null;
      return {
        datos: anual.datos_calculados,
        fecha: anual.fecha_presentacion,
        csv: anual.csv_presentacion,
        justificante: anual.numero_justificante,
      };
    }

    default:
      return null;
  }
}

/**
 * Cargar datos actuales recalculados de la app para un modelo/periodo
 */
async function cargarDatosApp(empresaId, modelo, ejercicio, periodo) {
  switch (modelo) {
    case '303':
    case '130':
    case '111':
    case '115':
    case '349': {
      const [fiscal] = await sql`
        SELECT datos_json, resultado_importe, resultado_tipo
        FROM fiscal_models_180
        WHERE empresa_id = ${empresaId}
          AND modelo = ${modelo}
          AND ejercicio = ${parseInt(ejercicio)}
          AND periodo = ${periodo}
        ORDER BY updated_at DESC LIMIT 1
      `;
      return fiscal?.datos_json || null;
    }

    case '390':
    case '190':
    case '180':
    case '347': {
      const [anual] = await sql`
        SELECT datos_calculados
        FROM modelos_anuales_180
        WHERE empresa_id = ${empresaId}
          AND modelo = ${modelo}
          AND ejercicio = ${parseInt(ejercicio)}
        ORDER BY updated_at DESC LIMIT 1
      `;
      return anual?.datos_calculados || null;
    }

    default:
      return null;
  }
}

/**
 * Detectar discrepancias entre datos presentados y datos actuales
 * Usa el mapeo de campos para comparar casilla por casilla
 */
function detectarDiscrepancias(datosPresentados, datosActuales, mapeos) {
  const discrepancias = [];

  if (!datosPresentados || !datosActuales || !mapeos || mapeos.length === 0) {
    return discrepancias;
  }

  for (const mapeo of mapeos) {
    const valorPresentado = obtenerValorPorPath(datosPresentados, mapeo.campo_app);
    const valorActual = obtenerValorPorPath(datosActuales, mapeo.campo_app);

    // Si ambos valores son null/undefined, no hay discrepancia
    if (valorPresentado == null && valorActual == null) continue;

    const vPres = parseFloat(valorPresentado) || 0;
    const vActual = parseFloat(valorActual) || 0;
    const diferencia = Math.abs(vActual - vPres);
    const tolerancia = parseFloat(mapeo.tolerancia) || 0.01;

    if (diferencia > tolerancia) {
      const porcentaje = vPres !== 0
        ? Math.round((diferencia / Math.abs(vPres)) * 10000) / 100
        : (vActual !== 0 ? 100 : 0);

      let severidad = 'baja';
      if (mapeo.es_campo_clave && (diferencia > 100 || porcentaje > 5)) {
        severidad = 'alta';
      } else if (diferencia > 100 || porcentaje > 5) {
        severidad = 'media';
      } else if (diferencia > 1) {
        severidad = 'media';
      }

      discrepancias.push({
        casilla: mapeo.casilla,
        campo_app: mapeo.campo_app,
        descripcion: mapeo.descripcion || mapeo.campo_app,
        valor_actual: vActual,
        valor_presentado: vPres,
        diferencia,
        porcentaje,
        severidad,
      });
    }
  }

  return discrepancias.sort((a, b) => {
    const order = { alta: 0, media: 1, baja: 2 };
    return order[a.severidad] - order[b.severidad];
  });
}

/**
 * Obtener valor de un objeto siguiendo un path de puntos
 * Ej: obtenerValorPorPath(obj, 'modelo303.devengado.cuota')
 */
function obtenerValorPorPath(obj, path) {
  if (!obj || !path) return null;
  return path.split('.').reduce((curr, key) => {
    if (curr == null) return null;
    return curr[key];
  }, obj);
}

/**
 * Actualizar datos de la app para que coincidan con lo presentado
 */
export async function aplicarCorreccionDesdeAeat(discrepanciaId, userId) {
  const [disc] = await sql`
    SELECT d.*, c.datos_aeat
    FROM aeat_discrepancias_180 d
    JOIN aeat_consultas_180 c ON c.id = d.consulta_id
    WHERE d.id = ${discrepanciaId}
  `;

  if (!disc) throw new Error('Discrepancia no encontrada');

  // Marcar como corregida
  await sql`
    UPDATE aeat_discrepancias_180
    SET estado = 'corregido_app',
        accion_tomada = 'actualizar_app',
        corregido_por = ${userId},
        fecha_correccion = NOW()
    WHERE id = ${discrepanciaId}
  `;

  // Verificar si todas las discrepancias de la consulta están resueltas
  const [pendientes] = await sql`
    SELECT COUNT(*) as count
    FROM aeat_discrepancias_180
    WHERE consulta_id = ${disc.consulta_id} AND estado = 'pendiente'
  `;

  if (parseInt(pendientes.count) === 0) {
    await sql`
      UPDATE aeat_consultas_180
      SET estado = 'resuelto', resuelto_por = ${userId}, fecha_resolucion = NOW()
      WHERE id = ${disc.consulta_id}
    `;
  }

  logger.info(`Discrepancia corregida: id=${discrepanciaId} campo=${disc.campo_app}`);

  return { success: true, discrepancia: disc };
}

/**
 * Ignorar una discrepancia
 */
export async function ignorarDiscrepancia(discrepanciaId, userId, notas) {
  await sql`
    UPDATE aeat_discrepancias_180
    SET estado = 'ignorado',
        accion_tomada = 'ignorar',
        corregido_por = ${userId},
        fecha_correccion = NOW(),
        notas = ${notas || null}
    WHERE id = ${discrepanciaId}
  `;

  return { success: true };
}

/**
 * Obtener historial de consultas para una empresa
 */
export async function getHistorialConsultas(empresaId, filtros = {}) {
  const { modelo, ejercicio, estado, limit: lim = 50 } = filtros;

  let query = sql`
    SELECT c.*,
      (SELECT COUNT(*) FROM aeat_discrepancias_180 d WHERE d.consulta_id = c.id) as total_discrepancias,
      (SELECT COUNT(*) FROM aeat_discrepancias_180 d WHERE d.consulta_id = c.id AND d.severidad = 'alta') as discrepancias_altas
    FROM aeat_consultas_180 c
    WHERE c.empresa_id = ${empresaId}
  `;

  if (modelo) {
    query = sql`${query} AND c.modelo = ${modelo}`;
  }
  if (ejercicio) {
    query = sql`${query} AND c.ejercicio = ${parseInt(ejercicio)}`;
  }
  if (estado) {
    query = sql`${query} AND c.estado = ${estado}`;
  }

  query = sql`${query} ORDER BY c.fecha_consulta DESC LIMIT ${parseInt(lim)}`;

  return query;
}

/**
 * Obtener detalle de una consulta con todas sus discrepancias
 */
export async function getDetalleConsulta(consultaId) {
  const [consulta] = await sql`
    SELECT * FROM aeat_consultas_180 WHERE id = ${consultaId}
  `;

  if (!consulta) throw new Error('Consulta no encontrada');

  const discrepancias = await sql`
    SELECT * FROM aeat_discrepancias_180
    WHERE consulta_id = ${consultaId}
    ORDER BY
      CASE severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 WHEN 'baja' THEN 2 END,
      casilla
  `;

  return { consulta, discrepancias };
}
