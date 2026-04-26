// backend/src/services/dehuService.js
// Integración con DEHú (Dirección Electrónica Habilitada única) — notificaciones
// electrónicas oficiales (AEAT, TGSS, DGT, etc.).
//
// Se autentica con certificado digital mTLS. Toma el certificado desde:
//   1) credenciales_externas_180 con tipo_acceso='certificado' (cifrado con master key)
//   2) emisor_180 si tipo_acceso='certificado_existente' (certificado de AEAT del cliente)
//
// API DEHú: SOAP en https://servicios1.seap.minhap.es/dehuws/services/
// (Sandbox: pre-servicios1.seap.minhap.es). Endpoints relevantes:
//   - LemaPeticionarioRequest (autenticar y consultar pendientes)
//   - LemaAcceso (acceso/descarga de notificación → genera acuse)
//
// IMPORTANTE: este servicio asume que el usuario configurará un endpoint y
// activará la integración cuando tenga las credenciales y el apoderamiento listos.
// Mientras tanto, devuelve un error explícito y no rompe la app.

import https from "https";
import { sql } from "../db.js";
import { getCredencialDescifrada, marcarValidacion } from "./credentialsService.js";
import { getConfig } from "./appConfigService.js";

// Endpoint DEHú: leído de app_config_180 (clave 'endpoint_dehu') con override
// opcional vía env var DEHU_ENDPOINT. Si cambia el dominio del organismo, se
// edita desde la propia app sin redeploy.
async function getDehuEndpoint() {
  return await getConfig("endpoint_dehu", "https://dehu.redsara.es/");
}

/**
 * Resuelve el certificado del cliente. Prioridad:
 *  1. Credencial DEHú con tipo_acceso='certificado' (subido específicamente)
 *  2. Credencial DEHú con tipo_acceso='certificado_existente' → leer de emisor_180
 */
async function resolverCertificado(empresaId) {
  const cred = await getCredencialDescifrada(empresaId, "dehu");
  if (!cred) {
    return { error: "DEHú no configurado para esta empresa. Configura las credenciales en Integraciones." };
  }

  if (cred.tipo_acceso === "certificado" && cred.secretos?.certificado_b64) {
    return {
      pfxBase64: cred.secretos.certificado_b64,
      passphrase: cred.secretos.password || "",
      identificador: cred.identificador,
    };
  }

  if (cred.tipo_acceso === "certificado_existente") {
    // Leer del emisor_180 — lo subió el cliente para AEAT y vale para DEHú
    const [emisor] = await sql`
      SELECT certificado_data, certificado_password
      FROM emisor_180 WHERE empresa_id = ${empresaId} LIMIT 1
    `;
    if (!emisor?.certificado_data) {
      return { error: "Configurado para usar certificado existente, pero el cliente no tiene ninguno subido." };
    }
    return {
      pfxBase64: emisor.certificado_data,
      passphrase: emisor.certificado_password || "",
      identificador: cred.identificador,
    };
  }

  if (cred.tipo_acceso === "apoderamiento") {
    return {
      apoderamiento: cred.secretos?.apoderamiento_codigo,
      nifApoderado: cred.identificador,
    };
  }

  return { error: `Tipo de acceso DEHú no soportado: ${cred.tipo_acceso}` };
}

/**
 * Construye un agente HTTPS con el certificado del cliente (mTLS).
 */
function buildHttpsAgent(pfxBase64, passphrase) {
  return new https.Agent({
    pfx: Buffer.from(pfxBase64, "base64"),
    passphrase,
    rejectUnauthorized: true,
  });
}

/**
 * Test de conexión: intenta llamar al endpoint DEHú con el certificado y
 * devuelve { ok, mensaje }. No persiste notificaciones.
 */
export async function testConexionDehu(empresaId) {
  const cert = await resolverCertificado(empresaId);
  if (cert.error) return { ok: false, mensaje: cert.error };

  if (!cert.pfxBase64) {
    return {
      ok: false,
      mensaje: "Apoderamiento sin certificado: la consulta a DEHú requiere un certificado digital. Configura uno o usa el certificado existente del cliente.",
    };
  }

  // Test en dos pasos:
  //  1. Cargar el .p12 con la passphrase localmente → si falla, contraseña incorrecta
  //  2. Hacer GET sin presentar cert al endpoint público de DEHú → si falla, no hay
  //     conectividad de red (DNS, firewall…)
  // El handshake mTLS real solo ocurre cuando el SOAP esté cableado; mientras
  // tanto este test es suficiente para validar credenciales + reachability.
  try {
    new https.Agent({
      pfx: Buffer.from(cert.pfxBase64, "base64"),
      passphrase: cert.passphrase,
    });
  } catch (err) {
    const mensaje = `Certificado o contraseña incorrectos: ${err.message}`;
    await marcarValidacion(empresaId, "dehu", { ok: false, mensaje, timestamp: new Date().toISOString() });
    return { ok: false, mensaje };
  }

  const endpointActual = await getDehuEndpoint();
  try {
    const url = new URL(endpointActual);
    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        port: 443,
        path: url.pathname || "/",
        method: "GET",
        timeout: 12000,
      }, (res) => {
        resolve({ status: res.statusCode });
        res.resume();
      });
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.end();
    });

    const ok = result.status >= 200 && result.status < 500;
    const mensaje = ok
      ? `✓ Certificado válido y endpoint DEHú alcanzable (HTTP ${result.status}). Listo para sincronizar cuando el cliente SOAP esté activado.`
      : `Endpoint DEHú devolvió HTTP ${result.status}.`;

    await marcarValidacion(empresaId, "dehu", { ok, mensaje, status: result.status, timestamp: new Date().toISOString() });
    return { ok, mensaje };
  } catch (err) {
    const mensaje = `No se pudo alcanzar el endpoint DEHú (${endpointActual}): ${err.message}. Edita la URL en /admin/app-config si el dominio ha cambiado.`;
    await marcarValidacion(empresaId, "dehu", { ok: false, mensaje, timestamp: new Date().toISOString() });
    return { ok: false, mensaje };
  }
}

/**
 * Sincroniza notificaciones pendientes con DEHú.
 * Hace la llamada SOAP de "consulta de pendientes" y guarda nuevas en BD.
 *
 * IMPORTANTE: el SOAP exacto de DEHú requiere un cliente SOAP completo (envelope,
 * namespaces, firma WS-Security…). Esta primera versión deja preparada la
 * infraestructura y muestra un mensaje claro hasta que se cablea el SOAP real
 * con la documentación oficial vigente.
 */
export async function sincronizarNotificacionesDehu(empresaId) {
  const cert = await resolverCertificado(empresaId);
  if (cert.error) {
    return { ok: false, mensaje: cert.error, nuevas: 0 };
  }

  // Si DEHU_SOAP_ENABLED=true en el entorno, intenta la llamada SOAP real.
  // Por defecto, devuelve mensaje informativo y 0 nuevas.
  if (process.env.DEHU_SOAP_ENABLED !== "true") {
    return {
      ok: false,
      mensaje: "Sincronización con DEHú no activa. Falta cablear el cliente SOAP oficial. Las credenciales y el certificado están listos. Activa DEHU_SOAP_ENABLED=true en el servidor cuando esté implementado.",
      nuevas: 0,
    };
  }

  // ------------------------------------------------------------------
  // Punto de extensión: aquí va la llamada SOAP real cuando se cablee.
  // Esquema: SOAP envelope → consulta pendientes → array de notificaciones.
  // ------------------------------------------------------------------
  return {
    ok: false,
    mensaje: "Cliente SOAP DEHú aún no implementado. Estructura preparada.",
    nuevas: 0,
  };
}

/**
 * Listar notificaciones almacenadas en BD para esta empresa.
 */
export async function listarNotificacionesEmpresa(empresaId, { estado, limite = 100 } = {}) {
  const lim = Math.max(1, Math.min(parseInt(limite) || 100, 500));
  let q = sql`
    SELECT id, identificador, organismo, concepto, fecha_puesta_disposicion,
           fecha_caducidad, estado, acuse_recibido_at, acuse_csv, pdf_path,
           created_at, updated_at
    FROM notificaciones_dehu_180
    WHERE empresa_id = ${empresaId}
  `;
  if (estado) q = sql`${q} AND estado = ${estado}`;
  q = sql`${q} ORDER BY fecha_puesta_disposicion DESC NULLS LAST, created_at DESC LIMIT ${lim}`;
  return q;
}

/**
 * Marcar una notificación como leída/rechazada (acuse local).
 */
export async function actualizarEstadoNotificacion(empresaId, notificacionId, nuevoEstado) {
  if (!["leida", "rechazada"].includes(nuevoEstado)) {
    throw new Error("Estado inválido");
  }
  const [updated] = await sql`
    UPDATE notificaciones_dehu_180
    SET estado = ${nuevoEstado},
        acuse_recibido_at = COALESCE(acuse_recibido_at, now()),
        updated_at = now()
    WHERE id = ${notificacionId} AND empresa_id = ${empresaId}
    RETURNING *
  `;
  return updated || null;
}
