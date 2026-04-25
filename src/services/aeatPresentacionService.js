// backend/src/services/aeatPresentacionService.js
// Core service for filing tax models with AEAT using client digital certificates

import https from 'https';
import forge from 'node-forge';
import { sql } from '../db.js';
import logger from '../utils/logger.js';
import { getCertificateForFiling, logUsage } from './certificadoService.js';
import { aeatService } from './aeatService.js';

// =========================
// AEAT SUBMISSION URLs
// =========================
const AEAT_URLS = {
  test: {
    "303": "https://www7.aeat.es/wlpl/OVPT-PRES/PresAutoliquidacionServlet",
    "130": "https://www7.aeat.es/wlpl/OVPT-PRES/PresAutoliquidacionServlet",
    "111": "https://www7.aeat.es/wlpl/OVPT-PRES/PresAutoliquidacionServlet",
    "115": "https://www7.aeat.es/wlpl/OVPT-PRES/PresAutoliquidacionServlet",
  },
  production: {
    "303": "https://www1.agenciatributaria.gob.es/wlpl/OVPT-PRES/PresAutoliquidacionServlet",
    "130": "https://www1.agenciatributaria.gob.es/wlpl/OVPT-PRES/PresAutoliquidacionServlet",
    "111": "https://www1.agenciatributaria.gob.es/wlpl/OVPT-PRES/PresAutoliquidacionServlet",
    "115": "https://www1.agenciatributaria.gob.es/wlpl/OVPT-PRES/PresAutoliquidacionServlet",
  }
};

/**
 * Submit BOE content to AEAT using a client certificate
 * @param {string} url - AEAT endpoint URL
 * @param {string} boeContent - BOE format content to submit
 * @param {Buffer} p12Buffer - .p12 certificate binary data
 * @param {string} password - Certificate password
 * @returns {Promise<object>} AEAT response parsed
 */
async function submitToAeat(url, boeContent, p12Buffer, password) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(boeContent),
      },
      rejectUnauthorized: !url.includes('www7'), // Relaxed for test environment
      timeout: 30000,
    };

    // Convert PKCS12 to PEM using node-forge (handles FNMT certificates)
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
        // Fallback to pfx/passphrase
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
        resolve(parseAeatResponse(data, res.statusCode));
      });
    });

    req.on('error', (e) => {
      reject(new Error(`Error de conexión con AEAT: ${e.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout: AEAT no respondió en 30 segundos'));
    });

    req.write(boeContent);
    req.end();
  });
}

/**
 * Parse AEAT response (CSV/text format for presentación)
 */
function parseAeatResponse(responseText, statusCode) {
  if (statusCode >= 200 && statusCode < 300) {
    // AEAT typically returns CSV-like responses
    // Format: "RESULTADO;CODIGO;CSV;MENSAJE"
    const lines = responseText.split('\n').filter(l => l.trim());

    // Check for common success patterns
    const hasCSV = responseText.match(/CSV[:\s]*([A-Z0-9-]+)/i);
    const hasError = responseText.match(/ERROR|RECHAZAD|INCORRECTO/i);

    if (hasError && !hasCSV) {
      return {
        success: false,
        mensaje: responseText.substring(0, 500),
        raw: responseText,
      };
    }

    return {
      success: true,
      csv: hasCSV ? hasCSV[1] : null,
      mensaje: 'Presentación enviada a AEAT',
      raw: responseText,
    };
  }

  return {
    success: false,
    mensaje: `Error HTTP ${statusCode}: ${responseText.substring(0, 300)}`,
    raw: responseText,
  };
}

/**
 * Present a tax model to AEAT
 * @param {string} empresaId
 * @param {string} certificadoId - ID of the certificate to use
 * @param {string} modelo - '303', '130', '111', '115'
 * @param {string} periodo - '1T', '2T', '3T', '4T'
 * @param {string} ejercicio - Year '2026'
 * @param {object} datosModelo - Calculated model data (from fiscal module)
 */
export async function presentarModelo(empresaId, certificadoId, modelo, periodo, ejercicio, datosModelo) {
  // 1. Get certificate
  const cert = await getCertificateForFiling(empresaId, certificadoId);

  // 2. Get emisor data
  const [emisor] = await sql`
    SELECT nif, nombre, nombre_comercial
    FROM emisor_180
    WHERE empresa_id = ${empresaId}
    LIMIT 1
  `;

  if (!emisor) {
    throw new Error('Emisor no encontrado. Configure los datos del emisor primero.');
  }

  // 3. Generate BOE content using existing aeatService
  const trimestre = periodo.replace('T', '');
  const boeData = {
    year: ejercicio,
    trimestre,
    nif: emisor.nif,
    nombre: emisor.nombre || emisor.nombre_comercial,
    ...datosModelo,
  };

  let contenidoBOE;
  switch (modelo) {
    case '303':
      contenidoBOE = aeatService.generarBOE303(boeData);
      break;
    case '130':
      contenidoBOE = aeatService.generarBOE130(boeData);
      break;
    case '111':
      contenidoBOE = aeatService.generarBOE111(boeData);
      break;
    case '115':
      contenidoBOE = aeatService.generarBOE115(boeData);
      break;
    default:
      throw new Error(`Modelo ${modelo} no soportado para presentación telemática`);
  }

  // 4. Determine environment
  const usarTest = process.env.AEAT_ENTORNO !== 'produccion';
  const urls = usarTest ? AEAT_URLS.test : AEAT_URLS.production;
  const url = urls[modelo];

  if (!url) {
    throw new Error(`No hay URL configurada para modelo ${modelo}`);
  }

  logger.info(`Presentando modelo ${modelo} ${periodo} ${ejercicio} a AEAT`, {
    empresaId, certificadoId, entorno: usarTest ? 'test' : 'produccion',
  });

  // 5. Submit to AEAT
  let resultado;
  try {
    resultado = await submitToAeat(url, contenidoBOE, cert.p12Buffer, cert.password);
  } catch (err) {
    // Log error
    await logUsage(
      certificadoId, empresaId, 'presentacion_modelo', modelo, periodo,
      'error', err.message, null
    );
    throw err;
  }

  // 6. Log usage
  await logUsage(
    certificadoId, empresaId, 'presentacion_modelo', modelo, periodo,
    resultado.success ? 'ok' : 'error',
    resultado.mensaje,
    null
  );

  // 7. Upsert fiscal_models_180: si existe lo actualizamos, si no lo creamos
  // con los datos calculados y la respuesta de AEAT. La columna correcta es
  // `ejercicio` (no `anio`).
  try {
    const ejercicioInt = parseInt(ejercicio);
    const [existing] = await sql`
      SELECT id FROM fiscal_models_180
      WHERE empresa_id = ${empresaId}
        AND modelo = ${modelo}
        AND periodo = ${periodo}
        AND ejercicio = ${ejercicioInt}
      LIMIT 1
    `;
    if (existing) {
      await sql`
        UPDATE fiscal_models_180
        SET estado = ${resultado.success ? 'PRESENTADO' : 'ERROR_PRESENTACION'},
            aeat_respuesta_json = ${JSON.stringify(resultado)},
            aeat_csv = ${resultado.csv || null},
            datos_json = ${JSON.stringify(datosModelo)},
            presentado_at = ${resultado.success ? sql`now()` : null},
            updated_at = now()
        WHERE id = ${existing.id}
      `;
    } else {
      await sql`
        INSERT INTO fiscal_models_180 (
          empresa_id, modelo, ejercicio, periodo, estado,
          datos_json, aeat_respuesta_json, aeat_csv,
          presentado_at, created_at, updated_at
        ) VALUES (
          ${empresaId}, ${modelo}, ${ejercicioInt}, ${periodo},
          ${resultado.success ? 'PRESENTADO' : 'ERROR_PRESENTACION'},
          ${JSON.stringify(datosModelo)},
          ${JSON.stringify(resultado)},
          ${resultado.csv || null},
          ${resultado.success ? sql`now()` : null},
          now(), now()
        )
      `;
    }
  } catch (updateErr) {
    logger.warn('Could not persist fiscal_models_180', { error: updateErr.message });
  }

  logger.info(`Presentación modelo ${modelo} ${periodo} ${ejercicio}: ${resultado.success ? 'OK' : 'ERROR'}`, {
    empresaId, csv: resultado.csv,
  });

  return {
    success: resultado.success,
    csv: resultado.csv,
    mensaje: resultado.mensaje,
    entorno: usarTest ? 'preproduccion' : 'produccion',
    modelo,
    periodo,
    ejercicio,
  };
}
