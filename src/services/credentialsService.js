// backend/src/services/credentialsService.js
// Cifrado y gestión de credenciales externas por empresa.
// Usa pgcrypto del lado servidor con una master key del entorno.
//
// La master key (CREDENTIALS_MASTER_KEY) se debe configurar en el servidor.
// Sin ella, los endpoints rechazarán guardar/leer credenciales.

import { sql } from "../db.js";
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getMasterKey() {
  const k = process.env.CREDENTIALS_MASTER_KEY || process.env.JWT_SECRET;
  if (!k || k.length < 16) {
    throw new Error("CREDENTIALS_MASTER_KEY (o JWT_SECRET fallback) no configurado en el servidor");
  }
  // Derivar 32 bytes a partir de la key (sha-256)
  return crypto.createHash("sha256").update(k).digest();
}

function encrypt(plaintextObj) {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const json = JSON.stringify(plaintextObj || {});
  const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: [iv (12)] + [tag (16)] + [ciphertext]
  return Buffer.concat([iv, tag, encrypted]);
}

function decrypt(buffer) {
  if (!buffer || buffer.length < IV_LENGTH + TAG_LENGTH) return null;
  const key = getMasterKey();
  const iv = buffer.slice(0, IV_LENGTH);
  const tag = buffer.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buffer.slice(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

// ============================================================
// API pública del servicio
// ============================================================

export const SERVICIOS_VALIDOS = ["dehu", "ss_red", "siltra", "aeat_apoderamiento", "otros"];
export const TIPOS_ACCESO = ["certificado", "certificado_existente", "usuario_password", "apoderamiento", "token_api"];

/**
 * Listar credenciales configuradas para una empresa (sin descifrar el secreto).
 */
export async function listarCredencialesEmpresa(empresaId) {
  const rows = await sql`
    SELECT id, empresa_id, servicio, tipo_acceso, identificador,
           activo, validado_at, validado_resultado, notas, created_at, updated_at,
           (datos_encriptados IS NOT NULL) AS tiene_secreto
    FROM credenciales_externas_180
    WHERE empresa_id = ${empresaId}
    ORDER BY servicio
  `;
  return rows.map((r) => ({
    id: r.id,
    servicio: r.servicio,
    tipo_acceso: r.tipo_acceso,
    identificador: r.identificador,
    activo: r.activo,
    validado_at: r.validado_at,
    validado_resultado: r.validado_resultado,
    notas: r.notas,
    tiene_secreto: r.tiene_secreto,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

/**
 * Guardar credencial: si existe la actualiza, si no la crea.
 * datosSecretos es un objeto que se cifra completo (puede tener password, certificado, etc.).
 */
export async function guardarCredencial(empresaId, {
  servicio,
  tipo_acceso,
  identificador,
  datos_secretos,
  notas,
}) {
  if (!SERVICIOS_VALIDOS.includes(servicio)) {
    throw new Error(`Servicio inválido: ${servicio}`);
  }
  if (!TIPOS_ACCESO.includes(tipo_acceso)) {
    throw new Error(`Tipo de acceso inválido: ${tipo_acceso}`);
  }

  let encrypted = null;
  if (datos_secretos && Object.keys(datos_secretos).length > 0) {
    encrypted = encrypt(datos_secretos);
  }

  const [existing] = await sql`
    SELECT id, datos_encriptados FROM credenciales_externas_180
    WHERE empresa_id = ${empresaId} AND servicio = ${servicio}
    LIMIT 1
  `;

  if (existing) {
    // Si no se envían nuevos datos secretos, mantener los existentes
    const finalEncrypted = encrypted || existing.datos_encriptados;
    const [updated] = await sql`
      UPDATE credenciales_externas_180
      SET tipo_acceso = ${tipo_acceso},
          identificador = ${identificador || null},
          datos_encriptados = ${finalEncrypted},
          notas = ${notas || null},
          activo = true,
          updated_at = now()
      WHERE id = ${existing.id}
      RETURNING id, servicio, tipo_acceso, identificador, activo, validado_at, notas
    `;
    return updated;
  }

  const [created] = await sql`
    INSERT INTO credenciales_externas_180
      (empresa_id, servicio, tipo_acceso, identificador, datos_encriptados, notas)
    VALUES
      (${empresaId}, ${servicio}, ${tipo_acceso}, ${identificador || null}, ${encrypted}, ${notas || null})
    RETURNING id, servicio, tipo_acceso, identificador, activo, validado_at, notas
  `;
  return created;
}

/**
 * Obtener credencial descifrada (uso interno: servicios DEHú, SS RED, etc.).
 * Devuelve { servicio, tipo_acceso, identificador, secretos: {...}, ... }
 */
export async function getCredencialDescifrada(empresaId, servicio) {
  const [row] = await sql`
    SELECT id, servicio, tipo_acceso, identificador, datos_encriptados, activo, notas
    FROM credenciales_externas_180
    WHERE empresa_id = ${empresaId} AND servicio = ${servicio} AND activo = true
    LIMIT 1
  `;
  if (!row) return null;
  let secretos = null;
  if (row.datos_encriptados) {
    try {
      secretos = decrypt(row.datos_encriptados);
    } catch (e) {
      console.error(`[credentials] Error descifrando ${servicio}:`, e.message);
      return null;
    }
  }
  return {
    id: row.id,
    servicio: row.servicio,
    tipo_acceso: row.tipo_acceso,
    identificador: row.identificador,
    secretos,
    activo: row.activo,
    notas: row.notas,
  };
}

/**
 * Eliminar credencial.
 */
export async function eliminarCredencial(empresaId, servicio) {
  const [deleted] = await sql`
    DELETE FROM credenciales_externas_180
    WHERE empresa_id = ${empresaId} AND servicio = ${servicio}
    RETURNING id
  `;
  return !!deleted;
}

/**
 * Marcar el último resultado de validación (test de conexión).
 */
export async function marcarValidacion(empresaId, servicio, resultado) {
  await sql`
    UPDATE credenciales_externas_180
    SET validado_at = now(),
        validado_resultado = ${sql.json(resultado)}
    WHERE empresa_id = ${empresaId} AND servicio = ${servicio}
  `;
}
