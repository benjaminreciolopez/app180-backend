// backend/src/controllers/aeatConsultaController.js
// Controlador para verificación de modelos presentados y gestión de discrepancias

import {
  realizarConsultaCompleta,
  aplicarCorreccionDesdeAeat,
  ignorarDiscrepancia,
  getHistorialConsultas,
  getDetalleConsulta,
} from '../services/aeatConsultaService.js';
import { sql } from '../db.js';
import logger from '../utils/logger.js';

/**
 * POST /consultar
 * Verificar un modelo presentado: comparar datos presentados vs datos actuales
 */
export async function consultarModelo(req, res) {
  try {
    const { modelo, ejercicio, periodo } = req.body;
    const empresaId = req.params.empresa_id || req.user.empresa_id;

    if (!modelo || !ejercicio) {
      return res.status(400).json({ error: 'Modelo y ejercicio son requeridos' });
    }

    const resultado = await realizarConsultaCompleta(
      empresaId, null, modelo, parseInt(ejercicio), periodo, req.user.id
    );

    res.json({
      success: true,
      consulta: resultado.consulta,
      resumen: resultado.resumen,
      discrepancias: resultado.discrepancias,
    });
  } catch (error) {
    logger.error('Error verificando modelo:', error);
    res.status(500).json({ error: error.message || 'Error verificando modelo' });
  }
}

/**
 * GET /historial
 * Listar verificaciones previas con filtros
 */
export async function getHistorial(req, res) {
  try {
    const empresaId = req.params.empresa_id || req.user.empresa_id;
    const { modelo, ejercicio, estado, limit } = req.query;

    const consultas = await getHistorialConsultas(empresaId, { modelo, ejercicio, estado, limit });

    res.json({ success: true, consultas });
  } catch (error) {
    logger.error('Error obteniendo historial consultas:', error);
    res.status(500).json({ error: 'Error obteniendo historial' });
  }
}

/**
 * GET /:consultaId
 * Detalle de una verificación con todas sus discrepancias
 */
export async function getConsultaDetalle(req, res) {
  try {
    const { consultaId } = req.params;

    const resultado = await getDetalleConsulta(consultaId);

    res.json({ success: true, ...resultado });
  } catch (error) {
    logger.error('Error obteniendo detalle consulta:', error);
    res.status(500).json({ error: error.message || 'Error obteniendo detalle' });
  }
}

/**
 * POST /:consultaId/resolver
 * Resolver una discrepancia (actualizar app o ignorar)
 */
export async function resolverDiscrepancia(req, res) {
  try {
    const { discrepancia_id, accion, notas } = req.body;

    if (!discrepancia_id || !accion) {
      return res.status(400).json({ error: 'discrepancia_id y accion son requeridos' });
    }

    let resultado;
    if (accion === 'actualizar_app') {
      resultado = await aplicarCorreccionDesdeAeat(discrepancia_id, req.user.id);
    } else if (accion === 'ignorar') {
      resultado = await ignorarDiscrepancia(discrepancia_id, req.user.id, notas);
    } else {
      return res.status(400).json({ error: 'Acción no válida. Use: actualizar_app, ignorar' });
    }

    res.json({ success: true, ...resultado });
  } catch (error) {
    logger.error('Error resolviendo discrepancia:', error);
    res.status(500).json({ error: error.message || 'Error resolviendo discrepancia' });
  }
}

/**
 * GET /resumen/:ejercicio
 * Resumen de estado de verificaciones para un ejercicio completo
 */
export async function getResumenEjercicio(req, res) {
  try {
    const empresaId = req.params.empresa_id || req.user.empresa_id;
    const { ejercicio } = req.params;

    const resumen = await sql`
      SELECT
        c.modelo,
        c.periodo,
        c.estado,
        c.fecha_consulta,
        c.discrepancias_resumen,
        (SELECT COUNT(*) FROM aeat_discrepancias_180 d
         WHERE d.consulta_id = c.id AND d.estado = 'pendiente') as discrepancias_pendientes
      FROM aeat_consultas_180 c
      WHERE c.empresa_id = ${empresaId}
        AND c.ejercicio = ${parseInt(ejercicio)}
      ORDER BY c.modelo, c.periodo, c.fecha_consulta DESC
    `;

    // Agrupar por modelo - solo mantener la consulta más reciente por modelo/periodo
    const porModelo = {};
    for (const r of resumen) {
      const key = `${r.modelo}_${r.periodo}`;
      if (!porModelo[key]) {
        porModelo[key] = r;
      }
    }

    res.json({
      success: true,
      ejercicio: parseInt(ejercicio),
      modelos: Object.values(porModelo),
    });
  } catch (error) {
    logger.error('Error obteniendo resumen ejercicio:', error);
    res.status(500).json({ error: 'Error obteniendo resumen' });
  }
}

/**
 * POST /importar
 * Importar un fichero de modelo presentado (.ses, .190, .180, .347, etc.)
 * Parsea el fichero BOE y guarda los datos como si hubiera sido presentado
 */
export async function importarModeloPresentado(req, res) {
  try {
    const empresaId = req.params.empresa_id || req.user.empresa_id;
    const { modelo, ejercicio, periodo, contenido_fichero } = req.body;

    if (!modelo || !ejercicio || !contenido_fichero) {
      return res.status(400).json({ error: 'modelo, ejercicio y contenido_fichero son requeridos' });
    }

    // Parsear el fichero BOE para extraer los datos
    const datosParsed = parsearFicheroBOE(contenido_fichero, modelo);

    if (!datosParsed) {
      return res.status(400).json({ error: 'No se pudo parsear el fichero. Verifique el formato.' });
    }

    // Guardar como presentado según tipo de modelo
    const TRIMESTRALES = ['303', '130', '111', '115', '349'];
    const ANUALES = ['390', '190', '180', '347'];

    if (TRIMESTRALES.includes(modelo)) {
      // Buscar o crear registro en fiscal_models_180
      const existing = await sql`
        SELECT id FROM fiscal_models_180
        WHERE empresa_id = ${empresaId}
          AND modelo = ${modelo}
          AND ejercicio = ${parseInt(ejercicio)}
          AND periodo = ${periodo || '1T'}
      `;

      if (existing.length > 0) {
        await sql`
          UPDATE fiscal_models_180
          SET datos_json = ${JSON.stringify(datosParsed)},
              estado = 'PRESENTADO',
              presentado_at = NOW(),
              updated_at = NOW()
          WHERE id = ${existing[0].id}
        `;
      } else {
        await sql`
          INSERT INTO fiscal_models_180 (
            empresa_id, modelo, ejercicio, periodo, datos_json,
            estado, presentado_at, created_at, updated_at
          ) VALUES (
            ${empresaId}, ${modelo}, ${parseInt(ejercicio)}, ${periodo || '1T'},
            ${JSON.stringify(datosParsed)}, 'PRESENTADO', NOW(), NOW(), NOW()
          )
        `;
      }
    } else if (ANUALES.includes(modelo)) {
      const existing = await sql`
        SELECT id FROM modelos_anuales_180
        WHERE empresa_id = ${empresaId}
          AND modelo = ${modelo}
          AND ejercicio = ${parseInt(ejercicio)}
      `;

      if (existing.length > 0) {
        await sql`
          UPDATE modelos_anuales_180
          SET datos_calculados = ${JSON.stringify(datosParsed)},
              estado = 'presentado',
              fecha_presentacion = NOW(),
              updated_at = NOW()
          WHERE id = ${existing[0].id}
        `;
      } else {
        await sql`
          INSERT INTO modelos_anuales_180 (
            empresa_id, modelo, ejercicio, datos_calculados,
            estado, fecha_presentacion, created_at, updated_at
          ) VALUES (
            ${empresaId}, ${modelo}, ${parseInt(ejercicio)},
            ${JSON.stringify(datosParsed)}, 'presentado', NOW(), NOW(), NOW()
          )
        `;
      }
    }

    logger.info(`Modelo importado: ${modelo} ejercicio=${ejercicio} empresa=${empresaId}`);

    res.json({
      success: true,
      mensaje: `Modelo ${modelo} importado correctamente`,
      datos: datosParsed,
    });
  } catch (error) {
    logger.error('Error importando modelo:', error);
    res.status(500).json({ error: error.message || 'Error importando modelo' });
  }
}

/**
 * Parsear un fichero BOE (formato AEAT) y extraer datos estructurados
 * Soporta autoliquidaciones (.ses) e informativas (.190, .180, .347)
 */
function parsearFicheroBOE(contenido, modelo) {
  if (!contenido || contenido.trim().length === 0) return null;

  const AUTOLIQ = ['303', '130', '111', '115'];

  if (AUTOLIQ.includes(modelo)) {
    return parsearAutoliquidacion(contenido, modelo);
  } else {
    return parsearInformativa(contenido, modelo);
  }
}

/**
 * Parsear fichero de autoliquidación (.ses)
 * Formato: líneas con tags <T...> seguidas de valores posicionales
 */
function parsearAutoliquidacion(contenido, modelo) {
  const datos = {};
  const lineas = contenido.split('\n');

  for (const linea of lineas) {
    // Buscar tags <T seguidos de datos
    const tagMatches = linea.matchAll(/<T(\d{3})>\s*([\d.,+-]+)/g);
    for (const match of tagMatches) {
      const casilla = match[1];
      const valor = match[2].replace(/\./g, '').replace(',', '.');
      datos[`casilla_${casilla}`] = parseFloat(valor) || 0;
    }

    // Formato posicional: buscar campos con prefijos conocidos
    if (linea.startsWith('<T')) {
      const parts = linea.split('>');
      if (parts.length >= 2) {
        const tag = parts[0].replace('<T', '').trim();
        const valor = parts[1].trim();
        if (tag && valor) {
          datos[`T${tag}`] = valor;
        }
      }
    }
  }

  // Si no se parsearon tags, intentar formato de ancho fijo
  if (Object.keys(datos).length === 0) {
    return parsearAnchoFijo(contenido, modelo);
  }

  return datos;
}

/**
 * Parsear fichero de ancho fijo (formato estándar BOE)
 */
function parsearAnchoFijo(contenido, modelo) {
  const datos = { _raw: contenido, _modelo: modelo };

  // Extraer tipo de registro (primer carácter o primeros 2)
  const lineas = contenido.split(/\r?\n/).filter(l => l.trim().length > 0);

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const tipoRegistro = linea.substring(0, 1);

    if (tipoRegistro === '1' || tipoRegistro === 'T') {
      // Registro de declarante - extraer NIF y datos generales
      datos.nif_declarante = linea.substring(1, 10).trim();
      datos.ejercicio = linea.substring(10, 14).trim();
    } else if (tipoRegistro === '2') {
      // Registro de detalle/perceptor
      if (!datos.registros_detalle) datos.registros_detalle = [];
      datos.registros_detalle.push({
        nif: linea.substring(1, 10).trim(),
        contenido: linea.trim(),
      });
    }
  }

  return datos;
}

/**
 * Parsear fichero de declaración informativa (.190, .180, .347, .349)
 * Formato: registros de 500 caracteres con CR+LF
 */
function parsearInformativa(contenido, modelo) {
  const datos = {
    declarante: null,
    registros: [],
    _modelo: modelo,
  };

  // Las informativas tienen registros de 500 chars
  // Intentar dividir por líneas o por bloques de 500
  let registros;
  const lineas = contenido.split(/\r?\n/).filter(l => l.trim().length > 0);

  if (lineas.length > 0 && lineas[0].length >= 250) {
    registros = lineas;
  } else {
    // Dividir por bloques de 500
    registros = [];
    const clean = contenido.replace(/\r?\n/g, '');
    for (let i = 0; i < clean.length; i += 500) {
      const bloque = clean.substring(i, i + 500);
      if (bloque.trim().length > 0) registros.push(bloque);
    }
  }

  for (const reg of registros) {
    const tipoRegistro = reg.substring(0, 1);

    if (tipoRegistro === '1') {
      // Registro tipo 1: Declarante
      datos.declarante = {
        tipo_registro: '1',
        modelo: reg.substring(1, 4).trim(),
        ejercicio: reg.substring(4, 8).trim(),
        nif: reg.substring(8, 17).trim(),
        nombre: reg.substring(17, 57).trim(),
        total_registros: parseInt(reg.substring(57, 66).trim()) || 0,
      };

      // Campos específicos según modelo
      if (modelo === '190') {
        datos.declarante.total_retenciones = parseImporteInformativa(reg, 66, 81);
        datos.declarante.total_retribuciones = parseImporteInformativa(reg, 81, 96);
      } else if (modelo === '180') {
        datos.declarante.total_retenciones = parseImporteInformativa(reg, 66, 81);
        datos.declarante.total_rentas = parseImporteInformativa(reg, 81, 96);
      } else if (modelo === '347') {
        datos.declarante.total_operaciones = parseImporteInformativa(reg, 66, 81);
      }
    } else if (tipoRegistro === '2') {
      // Registro tipo 2: Detalle (perceptor/declarado/arrendador)
      const detalle = {
        tipo_registro: '2',
        nif: reg.substring(17, 26).trim(),
        nombre: reg.substring(26, 66).trim(),
      };

      if (modelo === '190') {
        detalle.clave_percepcion = reg.substring(66, 68).trim();
        detalle.retribuciones = parseImporteInformativa(reg, 68, 83);
        detalle.retenciones = parseImporteInformativa(reg, 83, 98);
      } else if (modelo === '180') {
        detalle.renta_anual = parseImporteInformativa(reg, 66, 81);
        detalle.retencion = parseImporteInformativa(reg, 81, 96);
      } else if (modelo === '347') {
        detalle.importe_anual = parseImporteInformativa(reg, 66, 81);
        detalle.importe_1T = parseImporteInformativa(reg, 81, 96);
        detalle.importe_2T = parseImporteInformativa(reg, 96, 111);
        detalle.importe_3T = parseImporteInformativa(reg, 111, 126);
        detalle.importe_4T = parseImporteInformativa(reg, 126, 141);
      }

      datos.registros.push(detalle);
    }
  }

  return datos;
}

/**
 * Parsear importe de formato informativa (signo + 13 dígitos con 2 decimales implícitos)
 */
function parseImporteInformativa(reg, desde, hasta) {
  const campo = reg.substring(desde, hasta).trim();
  if (!campo) return 0;
  const signo = campo.charAt(0);
  const numStr = campo.substring(1).replace(/^0+/, '') || '0';
  const valor = parseInt(numStr) / 100;
  return signo === 'N' ? -valor : valor;
}
