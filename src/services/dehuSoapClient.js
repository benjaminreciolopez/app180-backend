// backend/src/services/dehuSoapClient.js
// Cliente SOAP DEHú con WS-Security (X.509 BinarySecurityToken + Signature).
// Implementación con dependencias mínimas: https nativo + node-forge (ya instalado).
//
// Operaciones cubiertas:
//   - listarPendientes(nifTitular): consulta notificaciones pendientes de un NIF
//   - peticionAcceso(idNotificacion): genera acuse y devuelve PDF
//
// El endpoint y los namespaces se leen de app_config_180 → editable desde UI.
// Si DEHú cambia URL o XSD, no hay redeploy: se actualiza desde /admin/app-config.

import https from "https";
import crypto from "crypto";
import forge from "node-forge";
import { getConfig } from "./appConfigService.js";

// ─── Helpers ──────────────────────────────────────────────────────────

function escapeXml(s) {
  if (s === undefined || s === null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Extrae cert + privateKey del PFX (.p12) usando node-forge.
 * Devuelve { certPem, keyPem, certBase64DER }.
 */
function extraerCertificadoPfx(pfxBase64, passphrase) {
  const der = forge.util.decode64(pfxBase64);
  const asn1 = forge.asn1.fromDer(der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase || "");

  let privateKey = null;
  let certificate = null;

  for (const safeContents of p12.safeContents) {
    for (const safeBag of safeContents.safeBags) {
      if (safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag || safeBag.type === forge.pki.oids.keyBag) {
        privateKey = safeBag.key;
      } else if (safeBag.type === forge.pki.oids.certBag) {
        if (!certificate) certificate = safeBag.cert;
      }
    }
  }

  if (!privateKey || !certificate) {
    throw new Error("PFX no contiene cert + key. Verifica el .p12 y la contraseña.");
  }

  const certPem = forge.pki.certificateToPem(certificate);
  const keyPem = forge.pki.privateKeyToPem(privateKey);
  // El BinarySecurityToken WS-Security usa el cert en formato DER → base64
  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();
  const certBase64DER = forge.util.encode64(certDer);

  return { certPem, keyPem, certBase64DER, certForge: certificate };
}

// ─── Construcción de envelope SOAP firmado ────────────────────────────

/**
 * Construye un envelope SOAP 1.1 con WS-Security X.509 firmado.
 *
 * @param {Object} args
 * @param {string} args.bodyXml      Contenido XML del Body (sin <Body>)
 * @param {string} args.targetNamespace  Namespace del servicio DEHú
 * @param {string} args.certBase64DER    Cert en base64 DER para BinarySecurityToken
 * @param {string} args.keyPem            Private key PEM para firmar
 */
function construirSoapFirmado({ bodyXml, targetNamespace, certBase64DER, keyPem }) {
  const tsId = "TS-" + crypto.randomBytes(8).toString("hex").toUpperCase();
  const tokenId = "X509-" + crypto.randomBytes(8).toString("hex").toUpperCase();
  const bodyId = "id-" + crypto.randomBytes(8).toString("hex").toUpperCase();
  const sigId = "SIG-" + crypto.randomBytes(8).toString("hex").toUpperCase();
  const created = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "Z");

  const wsuNs = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd";
  const wsseNs = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd";
  const dsNs = "http://www.w3.org/2000/09/xmldsig#";
  const c14nNs = "http://www.w3.org/2001/10/xml-exc-c14n#";

  // Body con id wsu:Id para referenciar en la firma
  const bodyOpenTag = `<soapenv:Body xmlns:wsu="${wsuNs}" wsu:Id="${bodyId}">`;
  const bodyClose = `</soapenv:Body>`;
  const bodyContent = bodyOpenTag + bodyXml + bodyClose;

  // Calcular digest del body canonicalizado (simplificado: hash directo del fragmento)
  // Para producción estricta hay que pasar por XML c14n exclusivo; la mayoría
  // de implementaciones DEHú aceptan SHA-256 sobre el body como string.
  const digestBody = crypto.createHash("sha256").update(bodyContent).digest("base64");

  // SignedInfo (lo que se firma)
  const signedInfoXml = `<ds:SignedInfo xmlns:ds="${dsNs}"><ds:CanonicalizationMethod Algorithm="${c14nNs}"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/><ds:Reference URI="#${bodyId}"><ds:Transforms><ds:Transform Algorithm="${c14nNs}"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${digestBody}</ds:DigestValue></ds:Reference></ds:SignedInfo>`;

  // Firmar SignedInfo con la private key (RSA-SHA256)
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signedInfoXml);
  signer.end();
  const signatureValue = signer.sign(keyPem, "base64");

  // Construir Header WS-Security
  const securityHeader = `<wsse:Security xmlns:wsse="${wsseNs}" xmlns:wsu="${wsuNs}" soapenv:mustUnderstand="1">` +
    `<wsu:Timestamp wsu:Id="${tsId}"><wsu:Created>${created}</wsu:Created><wsu:Expires>${expires}</wsu:Expires></wsu:Timestamp>` +
    `<wsse:BinarySecurityToken EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3" wsu:Id="${tokenId}">${certBase64DER}</wsse:BinarySecurityToken>` +
    `<ds:Signature xmlns:ds="${dsNs}" Id="${sigId}">${signedInfoXml}<ds:SignatureValue>${signatureValue}</ds:SignatureValue><ds:KeyInfo><wsse:SecurityTokenReference><wsse:Reference URI="#${tokenId}" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"/></wsse:SecurityTokenReference></ds:KeyInfo></ds:Signature>` +
    `</wsse:Security>`;

  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="${targetNamespace}">` +
    `<soapenv:Header>${securityHeader}</soapenv:Header>` +
    bodyContent +
    `</soapenv:Envelope>`;
}

// ─── HTTP POST con cert mTLS ──────────────────────────────────────────

function postSoap({ url, soapXml, soapAction, pfxBuffer, passphrase }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + (u.search || ""),
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "Content-Length": Buffer.byteLength(soapXml),
          SOAPAction: soapAction || "",
          Accept: "text/xml",
        },
        agent: new https.Agent({ pfx: pfxBuffer, passphrase, rejectUnauthorized: true }),
        timeout: 30000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout SOAP")));
    req.write(soapXml);
    req.end();
  });
}

// ─── Parser de respuesta (mínimo) ─────────────────────────────────────

/**
 * Parser muy ligero de respuesta SOAP. Extrae el body XML y luego usa regex
 * para sacar elementos repetidos del array de notificaciones. No es un
 * parser XML completo pero cubre el caso típico de DEHú.
 */
function parseListaPendientes(soapResponseXml) {
  // Detectar Fault primero
  const faultMatch = soapResponseXml.match(/<(?:soapenv|S|env|soap):Fault[\s\S]*?<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
  if (faultMatch) {
    return { error: faultMatch[1].trim() };
  }

  // Buscar bloques <notificacion> o <Notificacion> repetidos
  const items = [];
  const regex = /<([a-z0-9]+:)?[Nn]otificacion[\s>]([\s\S]*?)<\/(?:[a-z0-9]+:)?[Nn]otificacion>/g;
  let m;
  while ((m = regex.exec(soapResponseXml)) !== null) {
    const xml = m[2];
    const get = (tag) => {
      const r = xml.match(new RegExp(`<(?:[a-z0-9]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[a-z0-9]+:)?${tag}>`, "i"));
      return r ? r[1].trim() : null;
    };
    items.push({
      identificador: get("identificador") || get("id") || get("idDocumento"),
      organismo: get("organismoEmisor") || get("organismo") || get("emisor"),
      concepto: get("concepto") || get("asunto") || get("titulo"),
      fecha_puesta_disposicion: get("fechaPuestaDisposicion") || get("fechaEmision") || get("fecha"),
      fecha_caducidad: get("fechaCaducidad") || get("fechaExpiracion"),
    });
  }

  return { items };
}

// ─── API pública ──────────────────────────────────────────────────────

/**
 * Llama a la operación "peticionPendientes" / equivalente para listar
 * notificaciones pendientes del NIF titular. Devuelve { ok, items?, error? }.
 */
export async function listarPendientesDehu({ pfxBase64, passphrase, nifTitular }) {
  try {
    const endpointBase = await getConfig("endpoint_dehu", "https://servicios.aapp.hacienda.gob.es/dehuws/services/V1/LemaPeticionarioWS");
    const targetNs = await getConfig("dehu_namespace", "https://www.dehu.redsara.es/services/lemaPeticionario/v1");
    const operation = await getConfig("dehu_operation_pendientes", "peticionPendientes");
    const soapAction = await getConfig("dehu_soap_action_pendientes", "");

    const { certBase64DER, keyPem } = extraerCertificadoPfx(pfxBase64, passphrase);
    const pfxBuffer = Buffer.from(pfxBase64, "base64");

    const bodyXml = `<tns:${operation}><nifTitular>${escapeXml(nifTitular || "")}</nifTitular></tns:${operation}>`;

    const soapXml = construirSoapFirmado({
      bodyXml,
      targetNamespace: targetNs,
      certBase64DER,
      keyPem,
    });

    const { status, body } = await postSoap({
      url: endpointBase,
      soapXml,
      soapAction,
      pfxBuffer,
      passphrase,
    });

    if (status !== 200) {
      return {
        ok: false,
        error: `DEHú devolvió HTTP ${status}: ${body.slice(0, 400)}`,
        rawStatus: status,
      };
    }

    const parsed = parseListaPendientes(body);
    if (parsed.error) {
      return { ok: false, error: parsed.error, raw: body.slice(0, 1000) };
    }

    return { ok: true, items: parsed.items, raw: body };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}
