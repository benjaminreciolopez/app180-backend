import crypto from 'crypto';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import logger from '../utils/logger.js';

/**
 * Firma XAdES-EPES (Electronic Signature with Explicit Policy) para registros
 * VeriFactu. Cumple RD 1007/2023 para conservación de registros del sistema
 * informático de facturación.
 *
 * En modo VeriFactu el SOAP enviado a AEAT no necesita firma XML — la
 * integridad la garantiza el TLS mutuo + cadena de huellas. Pero el RIS
 * exige conservar el registro firmado durante 8 años para auditoría/
 * inspección. Esa firma es la que produce este servicio.
 *
 * Flujo:
 *  1. Cargar PKCS#12 → certificado + clave privada PEM.
 *  2. Construir bloque <xades:QualifyingProperties> con SignedSignatureProperties
 *     (SigningTime, SigningCertificate, SignaturePolicyIdentifier).
 *  3. Calcular Reference#1 sobre el RegistroAlta/RegistroAnulacion (transform
 *     enveloped + C14N exclusiva).
 *  4. Calcular Reference#2 sobre SignedProperties.
 *  5. Generar SignedInfo, canonicalizar, firmar con RSA-SHA256.
 *  6. Embeber <ds:Signature> dentro del registro y devolver el XML completo.
 */

// Política de firma XAdES-EPES de la AEAT para sistemas informáticos de
// facturación (publicada en sede.agenciatributaria.gob.es).
const XADES_POLICY = {
    identifier: 'https://sede.agenciatributaria.gob.es/static_files/Sede/Procedimiento_ayuda/GE0/Politica_de_firma_AGE_v1_9.pdf',
    description: 'Política de Firma de la AEAT para Sistemas Informáticos de Facturación',
    // SHA-256 de la política (placeholder — actualizar con el digest oficial cuando
    // la AEAT publique uno definitivo para VeriFactu en producción).
    digestValue: '7gE1tRFyEFL4mGyOGNuGsMNvfGqRNPNvz4ttMEcBXCM='
};

const NS = {
    ds: 'http://www.w3.org/2000/09/xmldsig#',
    xades: 'http://uri.etsi.org/01903/v1.3.2#',
};

function pkcs12ToPem(p12Base64, password) {
    const p12Der = forge.util.decode64(p12Base64);
    const p12Asn1 = forge.asn1.fromDer(p12Der);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password || '', { strict: false });

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];

    if (!certBags.length || !keyBags.length) {
        throw new Error('PKCS#12 sin certificado o clave privada');
    }

    const certificate = certBags[0].cert;
    const privateKey = keyBags[0].key;
    const certPem = forge.pki.certificateToPem(certificate);
    const keyPem = forge.pki.privateKeyToPem(privateKey);

    // SHA-256 del certificado en formato DER (necesario para SigningCertificate).
    const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();
    const certDigest = crypto.createHash('sha256').update(certDer, 'binary').digest('base64');

    // IssuerSerial (RFC 4519): emisor (DN) + serial del certificado.
    const issuerName = certificate.issuer.attributes
        .map((a) => `${a.shortName || a.name}=${a.value}`)
        .reverse()
        .join(',');
    const serialNumber = BigInt(`0x${certificate.serialNumber}`).toString(10);

    // Certificado en base64 (sin headers PEM) para X509Certificate.
    const certBase64 = certPem
        .replace(/-----BEGIN CERTIFICATE-----/, '')
        .replace(/-----END CERTIFICATE-----/, '')
        .replace(/\s+/g, '');

    return { certPem, keyPem, certBase64, certDigest, issuerName, serialNumber };
}

function buildSignedProperties(signatureId, signedPropsId, certInfo) {
    const signingTime = new Date().toISOString();
    return `<xades:SignedProperties xmlns:xades="${NS.xades}" xmlns:ds="${NS.ds}" Id="${signedPropsId}">
<xades:SignedSignatureProperties>
<xades:SigningTime>${signingTime}</xades:SigningTime>
<xades:SigningCertificate>
<xades:Cert>
<xades:CertDigest>
<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
<ds:DigestValue>${certInfo.certDigest}</ds:DigestValue>
</xades:CertDigest>
<xades:IssuerSerial>
<ds:X509IssuerName>${escapeXml(certInfo.issuerName)}</ds:X509IssuerName>
<ds:X509SerialNumber>${certInfo.serialNumber}</ds:X509SerialNumber>
</xades:IssuerSerial>
</xades:Cert>
</xades:SigningCertificate>
<xades:SignaturePolicyIdentifier>
<xades:SignaturePolicyId>
<xades:SigPolicyId>
<xades:Identifier>${XADES_POLICY.identifier}</xades:Identifier>
<xades:Description>${XADES_POLICY.description}</xades:Description>
</xades:SigPolicyId>
<xades:SigPolicyHash>
<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
<ds:DigestValue>${XADES_POLICY.digestValue}</ds:DigestValue>
</xades:SigPolicyHash>
</xades:SignaturePolicyId>
</xades:SignaturePolicyIdentifier>
</xades:SignedSignatureProperties>
</xades:SignedProperties>`;
}

function escapeXml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Firma un fragmento XML (RegistroAlta o RegistroAnulacion) en XAdES-EPES.
 * Devuelve el XML original con `<ds:Signature>` enveloped antes del cierre.
 *
 * @param {string} xmlContent - Fragmento XML a firmar (debe tener un Id en el root).
 * @param {string} rootId - Valor del atributo Id del nodo raíz del fragmento.
 * @param {string} certificadoBase64 - Certificado .p12 en base64 (lo que hay en BD).
 * @param {string} password - Contraseña del certificado.
 * @returns {string} XML firmado XAdES-EPES.
 */
export function firmarXadesEpes(xmlContent, rootId, certificadoBase64, password) {
    if (!certificadoBase64) {
        throw new Error('Certificado requerido para XAdES-EPES');
    }

    const certInfo = pkcs12ToPem(certificadoBase64, password);

    const signatureId = 'Signature-' + crypto.randomBytes(8).toString('hex');
    const signedPropsId = signatureId + '-SignedProperties';
    const signedProps = buildSignedProperties(signatureId, signedPropsId, certInfo);

    const sig = new SignedXml({
        privateKey: certInfo.keyPem,
        signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
        canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    });

    sig.addReference({
        xpath: `//*[@Id='${rootId}']`,
        digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
        transforms: [
            'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
            'http://www.w3.org/2001/10/xml-exc-c14n#',
        ],
    });

    sig.addReference({
        xpath: `//*[@Id='${signedPropsId}']`,
        digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
        transforms: ['http://www.w3.org/2001/10/xml-exc-c14n#'],
        type: 'http://uri.etsi.org/01903#SignedProperties',
    });

    sig.getKeyInfoContent = () =>
        `<ds:X509Data><ds:X509Certificate>${certInfo.certBase64}</ds:X509Certificate></ds:X509Data>`;

    // xml-crypto necesita encontrar la SignedProperties por xpath durante el
    // signing. La inyectamos en un wrapper temporal junto al fragmento, luego
    // movemos el bloque QualifyingProperties dentro de la <ds:Signature>.
    const fragSinDecl = xmlContent.replace(/^<\?xml[^>]*\?>\s*/, '');
    const wrapper = `<TmpWrap xmlns:ds="${NS.ds}" xmlns:xades="${NS.xades}">${fragSinDecl}${signedProps}</TmpWrap>`;

    sig.computeSignature(wrapper, {
        prefix: 'ds',
        location: { reference: `//*[@Id='${rootId}']`, action: 'append' },
    });

    let signedWrapper = sig.getSignedXml();

    // 1. Extraer el bloque SignedProperties del wrapper.
    const signedPropsRe = new RegExp(
        `<xades:SignedProperties[^>]*Id="${signedPropsId}"[\\s\\S]*?<\\/xades:SignedProperties>`
    );
    const signedPropsMatch = signedWrapper.match(signedPropsRe);
    if (!signedPropsMatch) throw new Error('SignedProperties no encontrada tras firmar');
    signedWrapper = signedWrapper.replace(signedPropsRe, '');

    // 2. Insertar el ds:Object con QualifyingProperties dentro de ds:Signature.
    const qualifyingProps = `<ds:Object><xades:QualifyingProperties xmlns:xades="${NS.xades}" Target="#${signatureId}">${signedPropsMatch[0]}</xades:QualifyingProperties></ds:Object>`;
    signedWrapper = signedWrapper.replace(/<\/ds:Signature>/, `${qualifyingProps}</ds:Signature>`);

    // 3. Asignar Id a la <ds:Signature> para que coincida con el Target.
    signedWrapper = signedWrapper.replace(
        /<ds:Signature(\s[^>]*)?>/,
        (m, attrs) => `<ds:Signature${attrs || ''} Id="${signatureId}">`
    );

    // 4. Quitar el TmpWrap y reañadir la declaración XML.
    const inner = signedWrapper
        .replace(/^<TmpWrap[^>]*>/, '')
        .replace(/<\/TmpWrap>$/, '');

    return `<?xml version="1.0" encoding="UTF-8"?>\n${inner}`;
}

/**
 * Stub de TSA: añade un placeholder de SignatureTimeStamp.
 * Implementación real pendiente — requiere cliente RFC 3161 contra una
 * Autoridad de Sellado de Tiempo cualificada (FNMT, etc.).
 *
 * Por ahora devuelve un timestamp local con marca de hora estructural,
 * suficiente para el campo `tsa_timestamp_at` y para auditoría interna
 * mientras se contrata la TSA en producción.
 */
export function generarSelloTiempoLocal(xmlFirmado) {
    const ahora = new Date().toISOString();
    const hash = crypto.createHash('sha256').update(xmlFirmado, 'utf8').digest('base64');
    return {
        token: null, // RFC 3161 token base64 cuando se integre la TSA real.
        timestampAt: ahora,
        hashAlgorithm: 'SHA-256',
        hashValue: hash,
        provider: 'local-stub',
    };
}

logger.debug('xadesService loaded');
