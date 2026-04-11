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
 */
export async function getResumenEjercicio(req, res) {
  try {
    const empresaId = req.params.empresa_id || req.user.empresa_id;
    const { ejercicio } = req.params;

    const resumen = await sql`
      SELECT
        c.modelo, c.periodo, c.estado, c.fecha_consulta, c.discrepancias_resumen,
        (SELECT COUNT(*) FROM aeat_discrepancias_180 d
         WHERE d.consulta_id = c.id AND d.estado = 'pendiente') as discrepancias_pendientes
      FROM aeat_consultas_180 c
      WHERE c.empresa_id = ${empresaId}
        AND c.ejercicio = ${parseInt(ejercicio)}
      ORDER BY c.modelo, c.periodo, c.fecha_consulta DESC
    `;

    const porModelo = {};
    for (const r of resumen) {
      const key = `${r.modelo}_${r.periodo}`;
      if (!porModelo[key]) porModelo[key] = r;
    }

    res.json({ success: true, ejercicio: parseInt(ejercicio), modelos: Object.values(porModelo) });
  } catch (error) {
    logger.error('Error obteniendo resumen ejercicio:', error);
    res.status(500).json({ error: 'Error obteniendo resumen' });
  }
}

// =========================
// IMPORTACIÓN DE MODELOS
// =========================

/**
 * POST /importar
 * Importar un fichero de modelo presentado
 * Soporta: PDF (cotejo AEAT), BOE (.ses), informativas (.190, .180, .347), texto plano
 */
export async function importarModeloPresentado(req, res) {
  try {
    const empresaId = req.params.empresa_id || req.user.empresa_id;
    const { modelo, ejercicio, periodo, contenido_fichero, formato } = req.body;

    if (!modelo || !ejercicio || !contenido_fichero) {
      return res.status(400).json({ error: 'modelo, ejercicio y contenido_fichero son requeridos' });
    }

    let datosParsed;

    if (formato === 'pdf') {
      // PDF de cotejo AEAT: el contenido viene como texto extraído del PDF
      datosParsed = parsearPdfCotejoAEAT(contenido_fichero, modelo);
    } else {
      // Fichero BOE/texto plano
      datosParsed = parsearFicheroBOE(contenido_fichero, modelo);
    }

    if (!datosParsed || Object.keys(datosParsed).length === 0) {
      return res.status(400).json({ error: 'No se pudo parsear el fichero. Verifique el formato.' });
    }

    // Guardar como presentado
    const TRIMESTRALES = ['303', '130', '111', '115', '349'];
    const ANUALES = ['390', '190', '180', '347'];

    if (TRIMESTRALES.includes(modelo)) {
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

    logger.info(`Modelo importado: ${modelo} ejercicio=${ejercicio} formato=${formato || 'boe'} empresa=${empresaId}`, {
      casillas: Object.keys(datosParsed).length,
    });

    res.json({
      success: true,
      mensaje: `Modelo ${modelo} importado correctamente (${Object.keys(datosParsed).length} campos extraídos)`,
      datos: datosParsed,
    });
  } catch (error) {
    logger.error('Error importando modelo:', error);
    res.status(500).json({ error: error.message || 'Error importando modelo' });
  }
}

// =========================
// PARSERS
// =========================

/**
 * Parsear PDF de cotejo AEAT
 * Extrae casillas y valores del texto del PDF de presentación
 * Formato típico: "casilla_XX ... valor" con números en formato español (1.234,56)
 */
function parsearPdfCotejoAEAT(textoPdf, modelo) {
  const datos = { _formato: 'pdf_cotejo', _modelo: modelo };

  // Extraer metadata de presentación
  const csvMatch = textoPdf.match(/Código Seguro de Verificación:\s*(\S+)/);
  if (csvMatch) datos.csv_verificacion = csvMatch[1];

  const justMatch = textoPdf.match(/Número de justificante:\s*(\S+)/i) || textoPdf.match(/justificante:\s*(\d+)/i);
  if (justMatch) datos.numero_justificante = justMatch[1];

  const fechaMatch = textoPdf.match(/Presentación realizada el:\s*([^\n]+)/);
  if (fechaMatch) datos.fecha_presentacion = fechaMatch[1].trim();

  const nifMatch = textoPdf.match(/NIF\s+Apellidos.*?\n(\w+)\s/);
  if (nifMatch) datos.nif_declarante = nifMatch[1];

  // Extraer ejercicio y periodo
  const ejPeriodoMatch = textoPdf.match(/(\d{4})\s+(1T|2T|3T|4T|0A)/);
  if (ejPeriodoMatch) {
    datos.ejercicio = ejPeriodoMatch[1];
    datos.periodo = ejPeriodoMatch[2];
  }

  // Estrategia: buscar números de casilla seguidos de valores
  // El PDF de cotejo tiene formato: "casilla_num ... valor_decimal"

  // Para modelo 303 - extraer casillas conocidas del texto
  if (modelo === '303') {
    parsearCasillas303(textoPdf, datos);
  } else if (modelo === '130') {
    parsearCasillasGenerico(textoPdf, datos);
  } else if (modelo === '111') {
    parsearCasillasGenerico(textoPdf, datos);
  } else if (modelo === '115') {
    parsearCasillasGenerico(textoPdf, datos);
  } else {
    parsearCasillasGenerico(textoPdf, datos);
  }

  return datos;
}

/**
 * Parsear casillas del modelo 303 desde texto de PDF de cotejo
 */
function parsearCasillas303(texto, datos) {
  // El texto del PDF contiene números de casilla y valores mezclados
  // Buscamos patrones de casilla seguidos de valores numéricos

  // Extraer todos los importes con formato español (X.XXX,XX o XXX,XX)
  const importes = [];
  const importeRegex = /(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  let m;
  while ((m = importeRegex.exec(texto)) !== null) {
    importes.push({
      valor: parseFloat(m[1].replace(/\./g, '').replace(',', '.')),
      pos: m.index,
      raw: m[1],
    });
  }

  // Buscar casillas específicas del 303 por contexto
  // Casilla 27 - Total cuota devengada
  const cas27 = buscarValorCercaCasilla(texto, importes, '27', 'Total cuota devengada');
  if (cas27 !== null) datos.casilla_27 = cas27;

  // Casilla 45 - Total a deducir
  const cas45 = buscarValorCercaCasilla(texto, importes, '45', 'Total a deducir');
  if (cas45 !== null) datos.casilla_45 = cas45;

  // Casilla 46 - Resultado régimen general
  const cas46 = buscarValorCercaCasilla(texto, importes, '46', 'Resultado régimen general');
  if (cas46 !== null) datos.casilla_46 = cas46;

  // Casilla 64 - Suma de resultados
  const cas64 = buscarValorCercaCasilla(texto, importes, '64', 'Suma de resultados');
  if (cas64 !== null) datos.casilla_64 = cas64;

  // Casilla 66 - Atribuible a la Administración
  const cas66 = buscarValorCercaCasilla(texto, importes, '66', 'Atribuible a la Administración');
  if (cas66 !== null) datos.casilla_66 = cas66;

  // Casilla 78 - Cuotas a compensar aplicadas
  const cas78 = buscarValorCercaCasilla(texto, importes, '78', 'Cuotas a compensar.*aplicadas');
  if (cas78 !== null) datos.casilla_78 = cas78;

  // Casilla 110 - Cuotas a compensar pendientes
  const cas110 = buscarValorCercaCasilla(texto, importes, '110', 'Cuotas a compensar pendientes');
  if (cas110 !== null) datos.casilla_110 = cas110;

  // Casilla 69 - Resultado autoliquidación
  const cas69 = buscarValorCercaCasilla(texto, importes, '69', 'Resultado de la autoliquidación');
  if (cas69 !== null) datos.casilla_69 = cas69;

  // Casilla 71 - Resultado
  const cas71 = buscarValorCercaCasilla(texto, importes, '71', 'Resultado.*\\(69');
  if (cas71 !== null) datos.casilla_71 = cas71;

  // Casillas de IVA devengado por tipos
  // Buscar patrones: base tipo% cuota (ej: 5.050,00 21,00 1.060,50)
  const ivaRegex = /([\d.,]+)\s+(4,00|10,00|21,00)\s+([\d.,]+)/g;
  let ivaMatch;
  while ((ivaMatch = ivaRegex.exec(texto)) !== null) {
    const base = parseFloat(ivaMatch[1].replace(/\./g, '').replace(',', '.'));
    const tipo = parseFloat(ivaMatch[2].replace(',', '.'));
    const cuota = parseFloat(ivaMatch[3].replace(/\./g, '').replace(',', '.'));

    if (tipo === 4) {
      datos.casilla_01 = base; datos.casilla_03 = cuota;
    } else if (tipo === 10) {
      datos.casilla_04 = base; datos.casilla_06 = cuota;
    } else if (tipo === 21) {
      datos.casilla_07 = base; datos.casilla_09 = cuota;
    }
  }

  // IVA deducible - buscar "28 29" cerca de importes
  const cas29 = buscarValorCercaCasilla(texto, importes, '29', 'operaciones interiores corrientes');
  if (cas29 !== null) datos.casilla_29 = cas29;

  // Casilla 71 es el resultado final a ingresar/devolver
  // También buscar en la zona de ingreso/devolución
  const ingresoMatch = texto.match(/Importe[:\s]*([\d.,]+)/);
  if (ingresoMatch && !datos.casilla_71) {
    datos.casilla_71 = parseFloat(ingresoMatch[1].replace(/\./g, '').replace(',', '.'));
  }

  // IBAN
  const ibanMatch = texto.match(/(ES\d{22})/);
  if (ibanMatch) datos.iban = ibanMatch[1];
}

/**
 * Buscar el valor numérico más cercano a una casilla en el texto
 */
function buscarValorCercaCasilla(texto, importes, numeroCasilla, patronContexto) {
  // Buscar la casilla por número y contexto
  const casillaRegex = new RegExp(`${patronContexto}[^\\d]*?([\\d.,]+)`, 'i');
  const match = texto.match(casillaRegex);
  if (match) {
    const val = parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
    if (!isNaN(val)) return val;
  }

  // Buscar por número de casilla directamente: "... NN valor"
  const numRegex = new RegExp(`\\b${numeroCasilla}\\b[^\\d]*?(\\d{1,3}(?:\\.\\d{3})*,\\d{2})`);
  const numMatch = texto.match(numRegex);
  if (numMatch) {
    return parseFloat(numMatch[1].replace(/\./g, '').replace(',', '.'));
  }

  return null;
}

/**
 * Parser genérico para cualquier modelo: extrae pares casilla-valor
 */
function parsearCasillasGenerico(texto, datos) {
  // Buscar patrones "número_casilla ... importe_español"
  const lines = texto.split('\n');
  const importeRegex = /(\d{1,3}(?:\.\d{3})*,\d{2})/g;

  for (const line of lines) {
    const importes = [...line.matchAll(importeRegex)];
    if (importes.length > 0) {
      // El último importe de cada línea suele ser el valor de la casilla
      const ultimoImporte = importes[importes.length - 1];
      const valor = parseFloat(ultimoImporte[1].replace(/\./g, '').replace(',', '.'));
      // Buscar número de casilla antes del importe
      const antes = line.substring(0, ultimoImporte.index);
      const casillaMatch = antes.match(/\b(\d{1,3})\s*$/);
      if (casillaMatch) {
        datos[`casilla_${casillaMatch[1]}`] = valor;
      }
    }
  }
}

// =========================
// PARSERS BOE
// =========================

/**
 * Parsear fichero BOE según tipo de modelo
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
 */
function parsearAutoliquidacion(contenido, modelo) {
  const datos = { _formato: 'boe_ses', _modelo: modelo };
  const lineas = contenido.split('\n');

  for (const linea of lineas) {
    // Tags <T###> valor
    const tagMatches = linea.matchAll(/<T(\d{3})>\s*([\d.,+-]+)/g);
    for (const match of tagMatches) {
      const casilla = match[1];
      const valor = match[2].replace(/\./g, '').replace(',', '.');
      datos[`casilla_${casilla}`] = parseFloat(valor) || 0;
    }

    if (linea.startsWith('<T')) {
      const parts = linea.split('>');
      if (parts.length >= 2) {
        const tag = parts[0].replace('<T', '').trim();
        const valor = parts[1].trim();
        if (tag && valor) datos[`T${tag}`] = valor;
      }
    }
  }

  if (Object.keys(datos).length <= 2) {
    return parsearAnchoFijo(contenido, modelo);
  }

  return datos;
}

/**
 * Parsear formato de ancho fijo
 */
function parsearAnchoFijo(contenido, modelo) {
  const datos = { _formato: 'boe_fijo', _modelo: modelo };
  const lineas = contenido.split(/\r?\n/).filter(l => l.trim().length > 0);

  for (const linea of lineas) {
    const tipo = linea.substring(0, 1);
    if (tipo === '1' || tipo === 'T') {
      datos.nif_declarante = linea.substring(1, 10).trim();
      datos.ejercicio = linea.substring(10, 14).trim();
    } else if (tipo === '2') {
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
 * Parsear declaración informativa (.190, .180, .347, .349)
 */
function parsearInformativa(contenido, modelo) {
  const datos = { _formato: 'boe_informativa', _modelo: modelo, declarante: null, registros: [] };

  let registros;
  const lineas = contenido.split(/\r?\n/).filter(l => l.trim().length > 0);

  if (lineas.length > 0 && lineas[0].length >= 250) {
    registros = lineas;
  } else {
    registros = [];
    const clean = contenido.replace(/\r?\n/g, '');
    for (let i = 0; i < clean.length; i += 500) {
      const bloque = clean.substring(i, i + 500);
      if (bloque.trim().length > 0) registros.push(bloque);
    }
  }

  for (const reg of registros) {
    const tipo = reg.substring(0, 1);

    if (tipo === '1') {
      datos.declarante = {
        tipo_registro: '1',
        modelo: reg.substring(1, 4).trim(),
        ejercicio: reg.substring(4, 8).trim(),
        nif: reg.substring(8, 17).trim(),
        nombre: reg.substring(17, 57).trim(),
        total_registros: parseInt(reg.substring(57, 66).trim()) || 0,
      };

      if (modelo === '190') {
        datos.declarante.total_retenciones = parseImporte(reg, 66, 81);
        datos.declarante.total_retribuciones = parseImporte(reg, 81, 96);
      } else if (modelo === '180') {
        datos.declarante.total_retenciones = parseImporte(reg, 66, 81);
        datos.declarante.total_rentas = parseImporte(reg, 81, 96);
      } else if (modelo === '347') {
        datos.declarante.total_operaciones = parseImporte(reg, 66, 81);
      }
    } else if (tipo === '2') {
      const detalle = {
        tipo_registro: '2',
        nif: reg.substring(17, 26).trim(),
        nombre: reg.substring(26, 66).trim(),
      };

      if (modelo === '190') {
        detalle.clave_percepcion = reg.substring(66, 68).trim();
        detalle.retribuciones = parseImporte(reg, 68, 83);
        detalle.retenciones = parseImporte(reg, 83, 98);
      } else if (modelo === '180') {
        detalle.renta_anual = parseImporte(reg, 66, 81);
        detalle.retencion = parseImporte(reg, 81, 96);
      } else if (modelo === '347') {
        detalle.importe_anual = parseImporte(reg, 66, 81);
        detalle.importe_1T = parseImporte(reg, 81, 96);
        detalle.importe_2T = parseImporte(reg, 96, 111);
        detalle.importe_3T = parseImporte(reg, 111, 126);
        detalle.importe_4T = parseImporte(reg, 126, 141);
      }

      datos.registros.push(detalle);
    }
  }
  return datos;
}

function parseImporte(reg, desde, hasta) {
  const campo = reg.substring(desde, hasta).trim();
  if (!campo) return 0;
  const signo = campo.charAt(0);
  const numStr = campo.substring(1).replace(/^0+/, '') || '0';
  const valor = parseInt(numStr) / 100;
  return signo === 'N' ? -valor : valor;
}
