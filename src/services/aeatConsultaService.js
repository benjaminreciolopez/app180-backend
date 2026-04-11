// backend/src/services/aeatConsultaService.js
// Servicio para consultar declaraciones presentadas en AEAT vía certificado electrónico
// y detectar discrepancias con los datos de la app

import https from 'https';
import forge from 'node-forge';
import { sql } from '../db.js';
import logger from '../utils/logger.js';
import { getCertificateForFiling, logUsage } from './certificadoService.js';

// =========================
// AEAT CONSULTATION URLs
// =========================
const AEAT_CONSULTA_URLS = {
  test: {
    // Consulta de declaraciones presentadas (autoliquidaciones)
    autoliquidacion: 'https://www7.aeat.es/wlpl/OVCT-CALC/ConsultaDeclaracionServlet',
    // Consulta de declaraciones informativas
    informativa: 'https://www7.aeat.es/wlpl/INOI-CONS/ConsultaDeclaracionServlet',
    // Consulta de datos fiscales del contribuyente
    datos_fiscales: 'https://www7.aeat.es/wlpl/PACO-GIC/DatosFiscalesServlet',
    // Consulta de censo
    censo: 'https://www7.aeat.es/wlpl/BURT-JDIT/ConsultaCensoServlet',
  },
  production: {
    autoliquidacion: 'https://www1.agenciatributaria.gob.es/wlpl/OVCT-CALC/ConsultaDeclaracionServlet',
    informativa: 'https://www1.agenciatributaria.gob.es/wlpl/INOI-CONS/ConsultaDeclaracionServlet',
    datos_fiscales: 'https://www1.agenciatributaria.gob.es/wlpl/PACO-GIC/DatosFiscalesServlet',
    censo: 'https://www1.agenciatributaria.gob.es/wlpl/BURT-JDIT/ConsultaCensoServlet',
  }
};

// Modelos que son autoliquidaciones vs informativas
const AUTOLIQUIDACIONES = ['303', '130', '111', '115', '390', '100', '200'];
const INFORMATIVAS = ['190', '180', '347', '349'];

/**
 * Obtener URLs según entorno
 */
function getUrls() {
  const env = process.env.AEAT_ENTORNO === 'produccion' ? 'production' : 'test';
  return AEAT_CONSULTA_URLS[env];
}

/**
 * Realizar petición HTTPS a AEAT con certificado electrónico
 * Reutiliza el patrón de aeatPresentacionService.js
 */
async function requestAeat(url, body, p12Buffer, password) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
      rejectUnauthorized: !url.includes('www7'),
      timeout: 30000,
    };

    // Convertir PKCS12 a PEM con node-forge (compatible con certificados FNMT)
    try {
      const p12Der = forge.util.decode64(p12Buffer.toString('base64'));
      const p12Asn1 = forge.asn1.fromDer(p12Der);
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password || '', { strict: false });

      const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
      const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];

      if (certBags.length > 0 && keyBags.length > 0) {
        options.cert = forge.pki.certificateToPem(certBags[0].cert);
        options.key = forge.pki.privateKeyToPem(keyBags[0].key);
      } else {
        options.pfx = p12Buffer;
        options.passphrase = password;
      }
    } catch (forgeErr) {
      logger.warn('node-forge PKCS12 conversion failed, using pfx fallback', { error: forgeErr.message });
      options.pfx = p12Buffer;
      options.passphrase = password;
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    });

    req.on('error', (e) => {
      reject(new Error(`Error de conexión con AEAT: ${e.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout: AEAT no respondió en 30 segundos'));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Parsear respuesta de consulta AEAT
 * AEAT puede devolver XML, HTML o CSV según el tipo de consulta
 */
function parseAeatResponse(responseBody, tipo) {
  const result = {
    raw: responseBody,
    parsed: null,
    error: null,
  };

  try {
    // Intentar parsear como XML/SOAP
    if (responseBody.includes('<?xml') || responseBody.includes('<soap:')) {
      result.parsed = parseXmlResponse(responseBody);
    }
    // Intentar parsear como CSV (formato AEAT: campo;valor)
    else if (responseBody.includes(';')) {
      result.parsed = parseCsvResponse(responseBody);
    }
    // Intentar parsear como formato de casillas (<T...> tags)
    else if (responseBody.includes('<T')) {
      result.parsed = parseTaggedResponse(responseBody);
    }
    // HTML u otro formato
    else {
      result.parsed = { formato: 'desconocido', contenido: responseBody.substring(0, 5000) };
    }
  } catch (e) {
    result.error = e.message;
    logger.warn('Error parseando respuesta AEAT', { error: e.message, tipo });
  }

  return result;
}

/**
 * Parsear respuesta XML simple (extraer campos clave)
 */
function parseXmlResponse(xml) {
  const campos = {};
  const regex = /<(\w+)>([^<]*)<\/\1>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    campos[match[1]] = match[2].trim();
  }
  return { formato: 'xml', campos };
}

/**
 * Parsear respuesta CSV (RESULTADO;CODIGO;CSV;MENSAJE)
 */
function parseCsvResponse(csv) {
  const lineas = csv.split('\n').filter(l => l.trim());
  const campos = {};
  for (const linea of lineas) {
    const partes = linea.split(';');
    if (partes.length >= 2) {
      campos[partes[0].trim()] = partes.slice(1).join(';').trim();
    }
  }
  return { formato: 'csv', campos };
}

/**
 * Parsear respuesta con formato de tags <T> (casillas de autoliquidación)
 */
function parseTaggedResponse(tagged) {
  const casillas = {};
  // Buscar patrones de casillas: posiciones con valores numéricos
  // El formato es posicional, así que extraemos las secciones principales
  const secciones = tagged.split('<T').filter(s => s.trim());

  for (const seccion of secciones) {
    const endTag = seccion.indexOf('>');
    if (endTag > 0) {
      const id = seccion.substring(0, endTag);
      const contenido = seccion.substring(endTag + 1);
      casillas[`T${id}`] = contenido.trim();
    }
  }

  return { formato: 'tagged', casillas };
}

// =========================
// FUNCIONES PRINCIPALES
// =========================

/**
 * Consultar una declaración presentada en AEAT
 * @param {string} empresaId
 * @param {string} certificadoId
 * @param {string} modelo - '303', '130', '111', '115', '349', '390', '190', '180', '347', '100', '200'
 * @param {number} ejercicio
 * @param {string} periodo - '1T', '2T', '3T', '4T', '0A'
 * @returns {object} Datos de la declaración según AEAT
 */
/**
 * Resolver certificado: desde certificados_digitales_180 o desde emisor_180 (fallback)
 */
async function resolveCert(empresaId, certificadoId, certFromEmisor) {
  if (certFromEmisor) {
    // Certificado viene de emisor_180 directamente
    return {
      id: null,
      p12Buffer: certFromEmisor.certificado_data,
      pfxBuffer: certFromEmisor.certificado_data,
      password: certFromEmisor.certificado_password,
      nif: certFromEmisor.nif || '',
    };
  }
  const cert = await getCertificateForFiling(empresaId, certificadoId);
  if (!cert) throw new Error('No se encontró certificado válido');
  return { ...cert, pfxBuffer: cert.p12Buffer };
}

export async function consultarDeclaracionPresentada(empresaId, certificadoId, modelo, ejercicio, periodo, certFromEmisor) {
  const cert = await resolveCert(empresaId, certificadoId, certFromEmisor);

  const urls = getUrls();
  const esAutoliquidacion = AUTOLIQUIDACIONES.includes(modelo);
  const baseUrl = esAutoliquidacion ? urls.autoliquidacion : urls.informativa;

  // Construir body de la petición
  const params = new URLSearchParams({
    modelo: modelo,
    ejercicio: ejercicio.toString(),
    periodo: periodo || '0A',
    nif: cert.nif || '',
    accion: 'CONSULTA',
  });

  const response = await requestAeat(baseUrl, params.toString(), cert.pfxBuffer || cert.p12Buffer, cert.password);

  // Log de uso del certificado
  if (certificadoId) {
    await logUsage(certificadoId, empresaId, `consulta_modelo_${modelo}`, {
      ejercicio, periodo, statusCode: response.statusCode,
    });
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`AEAT respondió con error HTTP ${response.statusCode}`);
  }

  const parsed = parseAeatResponse(response.body, `modelo_${modelo}`);

  logger.info(`Consulta AEAT modelo ${modelo}: empresa=${empresaId} ejercicio=${ejercicio} periodo=${periodo}`, {
    statusCode: response.statusCode,
    formato: parsed.parsed?.formato,
  });

  return parsed;
}

/**
 * Consultar datos fiscales del contribuyente en AEAT
 * Devuelve la visión de AEAT sobre ingresos, retenciones, etc.
 */
export async function consultarDatosFiscales(empresaId, certificadoId, ejercicio, certFromEmisor) {
  const cert = await resolveCert(empresaId, certificadoId, certFromEmisor);

  const urls = getUrls();
  const params = new URLSearchParams({
    ejercicio: ejercicio.toString(),
    nif: cert.nif || '',
    accion: 'CONSULTA_DATOS_FISCALES',
  });

  const response = await requestAeat(urls.datos_fiscales, params.toString(), cert.pfxBuffer || cert.p12Buffer, cert.password);

  if (certificadoId) {
    await logUsage(certificadoId, empresaId, 'consulta_datos_fiscales', { ejercicio, statusCode: response.statusCode });
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`AEAT respondió con error HTTP ${response.statusCode}`);
  }

  return parseAeatResponse(response.body, 'datos_fiscales');
}

/**
 * Consultar censo del contribuyente
 * Devuelve epígrafes IAE, obligaciones fiscales, etc.
 */
export async function consultarCenso(empresaId, certificadoId, certFromEmisor) {
  const cert = await resolveCert(empresaId, certificadoId, certFromEmisor);

  const urls = getUrls();
  const params = new URLSearchParams({
    nif: cert.nif || '',
    accion: 'CONSULTA_CENSO',
  });

  const response = await requestAeat(urls.censo, params.toString(), cert.pfxBuffer || cert.p12Buffer, cert.password);

  if (certificadoId) {
    await logUsage(certificadoId, empresaId, 'consulta_censo', { statusCode: response.statusCode });
  }

  return parseAeatResponse(response.body, 'censo');
}

/**
 * Realizar consulta completa: consultar AEAT + cargar datos app + detectar discrepancias
 * Esta es la función principal que orquesta todo el flujo
 */
export async function realizarConsultaCompleta(empresaId, certificadoId, modelo, ejercicio, periodo, userId, certFromEmisor) {
  // 1. Consultar AEAT
  const datosAeat = await consultarDeclaracionPresentada(empresaId, certificadoId, modelo, ejercicio, periodo, certFromEmisor);

  // 2. Cargar datos de la app para este modelo/periodo
  const datosApp = await cargarDatosApp(empresaId, modelo, ejercicio, periodo);

  // 3. Cargar mapeo de campos para este modelo
  const mapeos = await sql`
    SELECT * FROM aeat_campo_mapeo_180
    WHERE modelo = ${modelo}
    ORDER BY casilla
  `;

  // 4. Detectar discrepancias
  const discrepancias = detectarDiscrepancias(datosAeat.parsed, datosApp, mapeos);

  // 5. Guardar consulta en BD
  const resumen = {
    total: discrepancias.length,
    altas: discrepancias.filter(d => d.severidad === 'alta').length,
    medias: discrepancias.filter(d => d.severidad === 'media').length,
    bajas: discrepancias.filter(d => d.severidad === 'baja').length,
  };

  const [consulta] = await sql`
    INSERT INTO aeat_consultas_180 (
      empresa_id, ejercicio, modelo, periodo, certificado_id,
      tipo_consulta, datos_aeat, datos_app, discrepancias_resumen, estado
    ) VALUES (
      ${empresaId}, ${ejercicio}, ${modelo}, ${periodo || '0A'}, ${certificadoId},
      'declaracion', ${JSON.stringify(datosAeat)}, ${JSON.stringify(datosApp)},
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
        ${disc.valor_app}, ${disc.valor_aeat}, ${disc.diferencia}, ${disc.porcentaje},
        ${disc.severidad}
      )
    `;
  }

  logger.info(`Consulta AEAT completa: modelo=${modelo} ejercicio=${ejercicio} discrepancias=${resumen.total} (${resumen.altas} altas)`);

  return {
    consulta,
    discrepancias,
    resumen,
    datos_aeat: datosAeat,
    datos_app: datosApp,
  };
}

/**
 * Cargar datos de la app para un modelo/periodo específico
 */
async function cargarDatosApp(empresaId, modelo, ejercicio, periodo) {
  switch (modelo) {
    case '303':
    case '130':
    case '111':
    case '115':
    case '349': {
      // Modelos trimestrales: buscar en fiscal_models_180
      const trimestre = periodo?.replace('T', '') || '1';
      const [fiscal] = await sql`
        SELECT datos_json, resultado_importe, resultado_tipo
        FROM fiscal_models_180
        WHERE empresa_id = ${empresaId}
          AND modelo = ${modelo}
          AND ejercicio = ${parseInt(ejercicio)}
          AND periodo = ${periodo || `${trimestre}T`}
        ORDER BY updated_at DESC LIMIT 1
      `;
      return fiscal?.datos_json || null;
    }

    case '390':
    case '190':
    case '180':
    case '347': {
      // Modelos anuales: buscar en modelos_anuales_180
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

    case '100': {
      // Renta IRPF
      const [renta] = await sql`
        SELECT * FROM renta_irpf_180
        WHERE empresa_id = ${empresaId} AND ejercicio = ${parseInt(ejercicio)}
      `;
      return renta || null;
    }

    case '200': {
      // Impuesto Sociedades
      const [is200] = await sql`
        SELECT * FROM impuesto_sociedades_180
        WHERE empresa_id = ${empresaId} AND ejercicio = ${parseInt(ejercicio)}
      `;
      return is200 || null;
    }

    default:
      return null;
  }
}

/**
 * Detectar discrepancias entre datos AEAT y datos de la app
 * Usa el mapeo de campos para comparar casilla por casilla
 */
function detectarDiscrepancias(datosAeatParsed, datosApp, mapeos) {
  const discrepancias = [];

  if (!datosAeatParsed || !datosApp || !mapeos || mapeos.length === 0) {
    return discrepancias;
  }

  for (const mapeo of mapeos) {
    const valorApp = obtenerValorPorPath(datosApp, mapeo.campo_app);
    const valorAeat = obtenerValorAeat(datosAeatParsed, mapeo.casilla);

    // Si ambos valores son null/undefined, no hay discrepancia
    if (valorApp == null && valorAeat == null) continue;

    const vApp = parseFloat(valorApp) || 0;
    const vAeat = parseFloat(valorAeat) || 0;
    const diferencia = Math.abs(vApp - vAeat);
    const tolerancia = parseFloat(mapeo.tolerancia) || 0.01;

    if (diferencia > tolerancia) {
      const porcentaje = vAeat !== 0
        ? Math.round((diferencia / Math.abs(vAeat)) * 10000) / 100
        : (vApp !== 0 ? 100 : 0);

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
        valor_app: vApp,
        valor_aeat: vAeat,
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
 * Obtener valor de los datos AEAT parseados por casilla
 */
function obtenerValorAeat(datosAeatParsed, casilla) {
  if (!datosAeatParsed) return null;

  // Formato XML: buscar en campos
  if (datosAeatParsed.formato === 'xml' && datosAeatParsed.campos) {
    return datosAeatParsed.campos[casilla] || datosAeatParsed.campos[`casilla_${casilla}`];
  }

  // Formato CSV: buscar por clave
  if (datosAeatParsed.formato === 'csv' && datosAeatParsed.campos) {
    return datosAeatParsed.campos[casilla];
  }

  // Formato tagged: buscar en casillas
  if (datosAeatParsed.formato === 'tagged' && datosAeatParsed.casillas) {
    return datosAeatParsed.casillas[casilla];
  }

  return null;
}

/**
 * Actualizar datos de la app para que coincidan con AEAT
 * Aplica el valor de AEAT al campo correspondiente en la app
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

  logger.info(`Discrepancia corregida: id=${discrepanciaId} campo=${disc.campo_app} valor_aeat=${disc.valor_aeat}`);

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

  // Aplicar filtros adicionales en la consulta
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
