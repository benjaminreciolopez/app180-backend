import crypto from 'crypto';
import https from 'https';
import http from 'http';
import forge from 'node-forge';
import logger from '../utils/logger.js';

/**
 * Cliente RFC 3161 (Time-Stamp Protocol) para sellar el XML XAdES-EPES.
 *
 * Flujo:
 *   1. Calcular SHA-256 del XML firmado.
 *   2. Construir TimeStampReq (ASN.1 DER) con ese hash.
 *   3. POST al endpoint TSA con `Content-Type: application/timestamp-query`.
 *   4. Recibir TimeStampResp (DER) → extraer TimeStampToken (PKCS#7).
 *   5. Devolver el token base64 + timestamp.
 *
 * Si no hay TSA_URL configurada, devuelve un sello local (stub) que sirve
 * para auditoría interna mientras no se contrata TSA cualificada en producción.
 *
 * Configuración (vars de entorno):
 *   - TSA_URL: endpoint RFC 3161 (ej: https://tsa.example.com/tsa)
 *   - TSA_USERNAME, TSA_PASSWORD: opcional para Basic Auth
 *   - TSA_REQUEST_CERT: true/false — pedir el certificado en la respuesta (default true)
 */

const TSA_URL = process.env.TSA_URL || null;
const TSA_USER = process.env.TSA_USERNAME || null;
const TSA_PWD = process.env.TSA_PASSWORD || null;
const TSA_REQUEST_CERT = process.env.TSA_REQUEST_CERT !== 'false';

// OID SHA-256
const OID_SHA256 = '2.16.840.1.101.3.4.2.1';

function buildTimeStampRequest(hashBuffer, requestCert = true) {
    const asn1 = forge.asn1;
    const algorithmIdentifier = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(OID_SHA256).getBytes()),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
    ]);

    const messageImprint = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        algorithmIdentifier,
        asn1.create(
            asn1.Class.UNIVERSAL,
            asn1.Type.OCTETSTRING,
            false,
            forge.util.binary.raw.encode(new Uint8Array(hashBuffer))
        ),
    ]);

    const nonce = forge.util.bytesToHex(forge.random.getBytesSync(8));

    const tsReq = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        // version INTEGER { v1(1) }
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(1).getBytes()),
        messageImprint,
        // nonce (opcional, recomendado para evitar replay attacks)
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, forge.util.hexToBytes(nonce)),
        // certReq (opcional, BOOLEAN)
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.BOOLEAN, false, requestCert ? '\u0001' : '\u0000'),
    ]);

    return Buffer.from(asn1.toDer(tsReq).getBytes(), 'binary');
}

function postTsa(url, derRequest) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const lib = u.protocol === 'https:' ? https : http;
        const headers = {
            'Content-Type': 'application/timestamp-query',
            'Content-Length': derRequest.length,
            Accept: 'application/timestamp-reply',
        };
        if (TSA_USER && TSA_PWD) {
            headers.Authorization = 'Basic ' + Buffer.from(`${TSA_USER}:${TSA_PWD}`).toString('base64');
        }
        const req = lib.request(
            {
                hostname: u.hostname,
                port: u.port || (u.protocol === 'https:' ? 443 : 80),
                path: u.pathname + (u.search || ''),
                method: 'POST',
                headers,
                timeout: 15000,
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        return reject(new Error(`TSA HTTP ${res.statusCode}`));
                    }
                    resolve(Buffer.concat(chunks));
                });
            }
        );
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('TSA timeout')));
        req.write(derRequest);
        req.end();
    });
}

function parseTsaResponse(derResponse) {
    const asn1 = forge.asn1;
    const obj = asn1.fromDer(forge.util.binary.raw.encode(new Uint8Array(derResponse)));
    // TimeStampResp ::= SEQUENCE { status PKIStatusInfo, timeStampToken TimeStampToken OPTIONAL }
    const status = obj.value[0];
    const statusValue = parseInt(forge.util.bytesToHex(status.value[0].value), 16);
    if (statusValue !== 0 && statusValue !== 1) {
        throw new Error(`TSA rechazó la solicitud (status=${statusValue})`);
    }
    if (!obj.value[1]) throw new Error('TSA respondió sin timeStampToken');
    const token = asn1.toDer(obj.value[1]).getBytes();
    return Buffer.from(token, 'binary');
}

/**
 * Obtiene un sello de tiempo para el XML firmado.
 * Si no hay TSA_URL configurada, devuelve un sello local (stub).
 *
 * @param {string} xmlFirmado - XML XAdES-EPES ya firmado
 * @returns {Promise<{token, timestampAt, hashAlgorithm, hashValue, provider}>}
 */
export async function selloTiempo(xmlFirmado) {
    const hash = crypto.createHash('sha256').update(xmlFirmado, 'utf8').digest();
    const hashB64 = hash.toString('base64');
    const ahora = new Date().toISOString();

    if (!TSA_URL) {
        return {
            token: null,
            timestampAt: ahora,
            hashAlgorithm: 'SHA-256',
            hashValue: hashB64,
            provider: 'local-stub',
        };
    }

    try {
        const reqDer = buildTimeStampRequest(hash, TSA_REQUEST_CERT);
        const respDer = await postTsa(TSA_URL, reqDer);
        const token = parseTsaResponse(respDer);
        return {
            token: token.toString('base64'),
            timestampAt: ahora,
            hashAlgorithm: 'SHA-256',
            hashValue: hashB64,
            provider: TSA_URL,
        };
    } catch (error) {
        logger.warn('TSA request failed, falling back to local stub', {
            url: TSA_URL,
            message: error.message,
        });
        return {
            token: null,
            timestampAt: ahora,
            hashAlgorithm: 'SHA-256',
            hashValue: hashB64,
            provider: 'local-stub-fallback',
            error: error.message,
        };
    }
}
