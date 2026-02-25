/**
 * Servicio de Código Seguro de Verificación (CSV) - RD 8/2019
 *
 * Genera códigos únicos para exportaciones de fichajes que permiten
 * verificar la autenticidad del documento via endpoint público.
 * Patrón similar al CSV de la Administración electrónica española.
 */

import { sql } from "../db.js";
import crypto from "crypto";
import QRCode from "qrcode";

const FRONTEND_URL = process.env.FRONTEND_URL || "https://contendo.es";

// ─── CSV CODE GENERATION ────────────────────────────────────

/**
 * Genera un Código Seguro de Verificación único.
 * Formato: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX (26 chars + 5 guiones = 31)
 * Caracteres: alfanuméricos sin confusión (sin I, O, 0, 1)
 */
function generarCodigoCSV() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const segments = [4, 4, 4, 4, 4, 4, 2];
  let codigo = "";
  for (let i = 0; i < segments.length; i++) {
    for (let j = 0; j < segments[i]; j++) {
      codigo += chars.charAt(crypto.randomInt(chars.length));
    }
    if (i < segments.length - 1) codigo += "-";
  }
  return codigo;
}

// ─── CREATE VERIFICATION ────────────────────────────────────

/**
 * Crea un registro de verificación CSV para un export.
 *
 * @param {{ empresaId: string, tipoDocumento: string, parametrosExport: Object, contenidoExport: any, numRegistros: number }}
 * @returns {{ csv_code: string, verification_url: string, qr_data_url: string, expires_at: Date }}
 */
export async function crearVerificacionCSV({
  empresaId,
  tipoDocumento,
  parametrosExport,
  contenidoExport,
  numRegistros,
}) {
  // Generar código único
  let csvCode = generarCodigoCSV();
  let existente = await sql`SELECT 1 FROM fichaje_verificaciones_180 WHERE csv_code = ${csvCode} LIMIT 1`;
  let intentos = 0;
  while (existente.length > 0 && intentos < 5) {
    csvCode = generarCodigoCSV();
    existente = await sql`SELECT 1 FROM fichaje_verificaciones_180 WHERE csv_code = ${csvCode} LIMIT 1`;
    intentos++;
  }

  // Hash SHA-256 del contenido exportado
  const hashContenido = crypto
    .createHash("sha256")
    .update(JSON.stringify(contenidoExport), "utf8")
    .digest("hex");

  // Expiración: 4 años + 1 mes (requisito legal + margen)
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 4);
  expiresAt.setMonth(expiresAt.getMonth() + 1);

  // Guardar en BD
  await sql`
    INSERT INTO fichaje_verificaciones_180 (
      csv_code, empresa_id, tipo_documento,
      parametros_export, hash_contenido, num_registros,
      expires_at
    ) VALUES (
      ${csvCode}, ${empresaId}, ${tipoDocumento},
      ${JSON.stringify(parametrosExport)}, ${hashContenido}, ${numRegistros},
      ${expiresAt}
    )
  `;

  // Generar QR code
  const verificationUrl = `${FRONTEND_URL}/verificar/${csvCode}`;
  const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
    errorCorrectionLevel: "M",
    width: 200,
    margin: 1,
    color: { dark: "#1e293b", light: "#ffffff" },
  });

  return {
    csv_code: csvCode,
    verification_url: verificationUrl,
    qr_data_url: qrDataUrl,
    expires_at: expiresAt,
  };
}

// ─── VERIFY CSV CODE ────────────────────────────────────────

/**
 * Verifica un código CSV (para endpoint público).
 * Retorna info parcial (no expone datos sensibles).
 *
 * @param {string} csvCode
 * @returns {Object|null}
 */
export async function verificarCodigoCSV(csvCode) {
  const [verificacion] = await sql`
    SELECT
      v.*,
      e.nombre as empresa_nombre,
      e.nif as empresa_nif
    FROM fichaje_verificaciones_180 v
    JOIN empresa_180 e ON v.empresa_id = e.id
    WHERE v.csv_code = ${csvCode}
    LIMIT 1
  `;

  if (!verificacion) return null;

  // Comprobar expiración
  if (new Date(verificacion.expires_at) < new Date()) {
    return {
      valido: false,
      motivo: "expirado",
      expiro_el: verificacion.expires_at,
    };
  }

  // Incrementar contador
  await sql`
    UPDATE fichaje_verificaciones_180
    SET num_verificaciones = num_verificaciones + 1,
        verificado_at = COALESCE(verificado_at, NOW())
    WHERE csv_code = ${csvCode}
  `;

  // Info parcial (segura para público)
  const nif = verificacion.empresa_nif || "";
  const nifParcial = nif.length >= 5
    ? nif.substring(0, 3) + "****" + nif.slice(-2)
    : "***";

  return {
    valido: true,
    csv_code: verificacion.csv_code,
    tipo_documento: verificacion.tipo_documento,
    created_at: verificacion.created_at,
    expires_at: verificacion.expires_at,
    num_registros: verificacion.num_registros,
    empresa: {
      nombre: verificacion.empresa_nombre,
      nif_parcial: nifParcial,
    },
    parametros: {
      fecha_inicio: verificacion.parametros_export?.desde || verificacion.parametros_export?.fecha_inicio,
      fecha_fin: verificacion.parametros_export?.hasta || verificacion.parametros_export?.fecha_fin,
    },
    hash_contenido_parcial: verificacion.hash_contenido.substring(0, 16) + "...",
    num_verificaciones: verificacion.num_verificaciones + 1,
  };
}
