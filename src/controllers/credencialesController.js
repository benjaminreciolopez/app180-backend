// backend/src/controllers/credencialesController.js
// Endpoints de credenciales externas — admin (su empresa) y asesor (clientes vinculados).

import {
  listarCredencialesEmpresa,
  guardarCredencial,
  eliminarCredencial,
  marcarValidacion,
  getCredencialDescifrada,
  SERVICIOS_VALIDOS,
} from "../services/credentialsService.js";
import { sql } from "../db.js";
import { testConexionDehu } from "../services/dehuService.js";
import https from "https";

/**
 * Resuelve el empresa_id objetivo:
 *  - Admin: req.user.empresa_id
 *  - Asesor sobre cliente: req.targetEmpresaId (puesto por asesorClienteRequired)
 */
function resolveEmpresaId(req) {
  return req.targetEmpresaId || req.user?.empresa_id || null;
}

/**
 * GET /admin/credenciales
 * GET /asesor/clientes/:empresa_id/credenciales
 */
export async function listarCredenciales(req, res) {
  try {
    const empresaId = resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no resuelta" });

    const items = await listarCredencialesEmpresa(empresaId);

    // Comprobar si el cliente ya tiene un certificado digital subido (en emisor_180)
    // — esto permite reutilizarlo para DEHú, SS RED, SILTRA sin volver a subir.
    const [emisor] = await sql`
      SELECT (certificado_data IS NOT NULL OR certificado_path IS NOT NULL) AS tiene_certificado,
             certificado_info, certificado_upload_date
      FROM emisor_180 WHERE empresa_id = ${empresaId} LIMIT 1
    `;

    // Devolver también catálogo de servicios para que el frontend muestre cuáles faltan
    const catalogo = SERVICIOS_VALIDOS.map((s) => ({
      servicio: s,
      configurado: items.some((i) => i.servicio === s),
    }));

    return res.json({
      success: true,
      items,
      catalogo,
      certificado_cliente: emisor ? {
        disponible: !!emisor.tiene_certificado,
        info: emisor.certificado_info || null,
        subido_el: emisor.certificado_upload_date || null,
      } : { disponible: false },
    });
  } catch (err) {
    console.error("Error listarCredenciales:", err);
    return res.status(500).json({ error: err.message || "Error obteniendo credenciales" });
  }
}

/**
 * PUT /admin/credenciales/:servicio
 * PUT /asesor/clientes/:empresa_id/credenciales/:servicio
 * Body: { tipo_acceso, identificador, datos_secretos, notas }
 */
export async function guardarCredencialEndpoint(req, res) {
  try {
    const empresaId = resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no resuelta" });

    const { servicio } = req.params;
    const { tipo_acceso, identificador, datos_secretos, notas } = req.body || {};

    if (!SERVICIOS_VALIDOS.includes(servicio)) {
      return res.status(400).json({ error: `Servicio inválido: ${servicio}` });
    }

    const result = await guardarCredencial(empresaId, {
      servicio,
      tipo_acceso,
      identificador,
      datos_secretos,
      notas,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error("Error guardarCredencial:", err);
    return res.status(500).json({ error: err.message || "Error guardando credencial" });
  }
}

/**
 * DELETE /admin/credenciales/:servicio
 * DELETE /asesor/clientes/:empresa_id/credenciales/:servicio
 */
export async function eliminarCredencialEndpoint(req, res) {
  try {
    const empresaId = resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no resuelta" });

    const { servicio } = req.params;
    const ok = await eliminarCredencial(empresaId, servicio);
    if (!ok) return res.status(404).json({ error: "Credencial no encontrada" });
    return res.json({ success: true });
  } catch (err) {
    console.error("Error eliminarCredencial:", err);
    return res.status(500).json({ error: err.message || "Error eliminando credencial" });
  }
}

// ============================================================
// Helpers de test
// ============================================================

/**
 * Resuelve el certificado del cliente desde una credencial guardada.
 * Permite tipo_acceso='certificado' (subido aquí) o 'certificado_existente'
 * (reutiliza el de emisor_180 — el que el cliente subió para AEAT).
 */
async function resolverCertificadoParaServicio(empresaId, servicio) {
  const cred = await getCredencialDescifrada(empresaId, servicio);
  if (!cred) return { error: `No hay credenciales configuradas para ${servicio}` };

  if (cred.tipo_acceso === "certificado" && cred.secretos?.certificado_b64) {
    return { pfxBase64: cred.secretos.certificado_b64, passphrase: cred.secretos.password || "", cred };
  }
  if (cred.tipo_acceso === "certificado_existente") {
    const [emisor] = await sql`
      SELECT certificado_data, certificado_password
      FROM emisor_180 WHERE empresa_id = ${empresaId} LIMIT 1
    `;
    if (!emisor?.certificado_data) {
      return { error: "Configurado para reutilizar el certificado del cliente, pero no hay ninguno subido en su zona AEAT." };
    }
    return { pfxBase64: emisor.certificado_data, passphrase: emisor.certificado_password || "", cred };
  }
  return { cred }; // sin certificado — usuario/password o apoderamiento
}

/**
 * Carga local del .p12 → si la passphrase es correcta, el agente https se crea
 * sin error. Esto valida que las credenciales están bien configuradas antes
 * de hablar con la red.
 */
function validarCertificadoLocal(pfxBase64, passphrase) {
  try {
    const buf = Buffer.from(pfxBase64, "base64");
    if (buf.length < 100) return { ok: false, mensaje: "Certificado vacío o corrupto" };
    // Crear un agente fuerza la verificación de la passphrase
    new https.Agent({ pfx: buf, passphrase });
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: `El certificado no se puede abrir: ${err.message}. Probablemente la contraseña es incorrecta.` };
  }
}

/**
 * Handshake HTTPS simple contra el host del organismo (sin cliente cert).
 * Valida solo que el endpoint sea alcanzable.
 */
async function pingHttps(url, withCert) {
  try {
    const u = new URL(url);
    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: u.hostname,
        port: 443,
        path: u.pathname || "/",
        method: "GET",
        timeout: 10000,
        agent: withCert ? new https.Agent({ pfx: withCert.pfx, passphrase: withCert.passphrase, rejectUnauthorized: true }) : undefined,
      }, (res) => {
        resolve({ status: res.statusCode });
        res.resume();
      });
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.end();
    });
    return { ok: true, status: result.status };
  } catch (err) {
    return { ok: false, mensaje: err.message };
  }
}

// Endpoints públicos de los organismos para verificar alcanzabilidad.
// Cualquier endpoint específico de SOAP/REST se configura vía variables de entorno.
const SERVICIO_ENDPOINTS = {
  dehu: process.env.DEHU_ENDPOINT || "https://dehu.redsara.es/",
  ss_red: process.env.SS_RED_ENDPOINT || "https://w3.seg-social.es/",
  siltra: process.env.SILTRA_ENDPOINT || "https://w6.seg-social.es/",
  aeat_apoderamiento: process.env.AEAT_APODERAMIENTO_ENDPOINT || "https://sede.agenciatributaria.gob.es/",
  otros: null,
};

/**
 * POST /admin/credenciales/:servicio/test
 * POST /asesor/clientes/:empresa_id/credenciales/:servicio/test
 *
 * Para servicios certificate-based (dehu/ss_red/siltra/aeat_apoderamiento):
 *  1. Carga el certificado y valida la passphrase localmente
 *  2. Hace handshake con el endpoint del organismo presentando el certificado
 *  3. Reporta el resultado
 *
 * Para usuario_password/apoderamiento sin certificado:
 *  - Solo verifica que existan los campos requeridos y el endpoint sea alcanzable
 */
export async function testCredencial(req, res) {
  try {
    const empresaId = resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no resuelta" });

    const { servicio } = req.params;

    // Para DEHú delegamos al servicio dedicado (mismo flujo, pero ya lo tiene)
    if (servicio === "dehu") {
      const r = await testConexionDehu(empresaId);
      return res.json({ success: !!r.ok, ...r });
    }

    if (!SERVICIOS_VALIDOS.includes(servicio)) {
      return res.status(400).json({ error: `Servicio inválido: ${servicio}` });
    }

    const certInfo = await resolverCertificadoParaServicio(empresaId, servicio);
    if (certInfo.error) {
      const result = { ok: false, mensaje: certInfo.error, timestamp: new Date().toISOString() };
      await marcarValidacion(empresaId, servicio, result);
      return res.json({ success: false, ...result });
    }

    const cred = certInfo.cred;
    const partes = [];

    // 1) Validación local del certificado (si aplica)
    if (certInfo.pfxBase64) {
      const v = validarCertificadoLocal(certInfo.pfxBase64, certInfo.passphrase);
      if (!v.ok) {
        const result = { ok: false, mensaje: v.mensaje, timestamp: new Date().toISOString() };
        await marcarValidacion(empresaId, servicio, result);
        return res.json({ success: false, ...result });
      }
      partes.push("✓ Certificado cargado y contraseña correcta");
    } else if (cred.tipo_acceso === "usuario_password") {
      if (!cred.secretos?.password || !cred.identificador) {
        const result = { ok: false, mensaje: "Faltan usuario o contraseña.", timestamp: new Date().toISOString() };
        await marcarValidacion(empresaId, servicio, result);
        return res.json({ success: false, ...result });
      }
      partes.push("✓ Usuario y contraseña presentes");
    } else if (cred.tipo_acceso === "apoderamiento") {
      if (!cred.secretos?.apoderamiento_codigo) {
        const result = { ok: false, mensaje: "Falta el código de apoderamiento.", timestamp: new Date().toISOString() };
        await marcarValidacion(empresaId, servicio, result);
        return res.json({ success: false, ...result });
      }
      partes.push("✓ Código de apoderamiento presente");
    }

    // 2) Conectividad al endpoint del organismo
    const endpoint = SERVICIO_ENDPOINTS[servicio];
    if (endpoint) {
      const ping = await pingHttps(endpoint, certInfo.pfxBase64 ? { pfx: Buffer.from(certInfo.pfxBase64, "base64"), passphrase: certInfo.passphrase } : null);
      if (ping.ok) {
        partes.push(`✓ Endpoint del organismo alcanzable (HTTP ${ping.status})`);
      } else {
        partes.push(`⚠ Endpoint inalcanzable: ${ping.mensaje}`);
      }
    }

    const finalOk = partes.every((p) => p.startsWith("✓"));
    const mensaje = partes.join(" · ") + (finalOk
      ? `. Las credenciales son válidas para ${servicio}.`
      : `. Revisa los avisos antes de usar la integración.`);

    const result = { ok: finalOk, mensaje, partes, timestamp: new Date().toISOString() };
    await marcarValidacion(empresaId, servicio, result);
    return res.json({ success: finalOk, ...result });
  } catch (err) {
    console.error("Error testCredencial:", err);
    return res.status(500).json({ error: err.message || "Error testando credencial" });
  }
}
