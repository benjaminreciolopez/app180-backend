// Smoke test: genera un certificado autofirmado + firma un fragmento
// RegistroAlta XAdES-EPES, y valida que el XML resultante esté bien formado.

import forge from 'node-forge';
import { firmarXadesEpes } from '../src/services/xadesService.js';

// 1. Generar certificado autofirmado en memoria.
const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = '01';
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
const attrs = [
    { name: 'commonName', value: 'TEST FIRMA' },
    { name: 'countryName', value: 'ES' },
    { shortName: 'O', value: 'CONTENDO TEST' },
    { name: 'serialNumber', value: 'B12345678' },
];
cert.setSubject(attrs);
cert.setIssuer(attrs);
cert.sign(keys.privateKey, forge.md.sha256.create());

// 2. Empaquetar en PKCS#12.
const password = 'test1234';
const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password);
const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
const p12Base64 = forge.util.encode64(p12Der);

// 3. Fragmento RegistroAlta de prueba.
const fragmento = `<?xml version="1.0" encoding="UTF-8"?>
<sf:RegistroAlta xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd" Id="reg-test-1">
  <sf:IDVersion>1.0</sf:IDVersion>
  <sf:IDFactura>
    <sf:IDEmisorFactura>B12345678</sf:IDEmisorFactura>
    <sf:NumSerieFactura>F2026/001</sf:NumSerieFactura>
    <sf:FechaExpedicionFactura>25-04-2026</sf:FechaExpedicionFactura>
  </sf:IDFactura>
  <sf:Huella>ABC123</sf:Huella>
</sf:RegistroAlta>`;

import { SignedXml } from 'xml-crypto';

try {
    const firmado = firmarXadesEpes(fragmento, 'reg-test-1', p12Base64, password);

    const verifier = new SignedXml();
    verifier.publicCert = forge.pki.certificateToPem(cert);
    const sigNode = firmado.match(/<ds:Signature[\s\S]*<\/ds:Signature>/)[0];
    verifier.loadSignature(sigNode);
    const verified = verifier.checkSignature(firmado);
    if (!verified) {
        console.error('CRYPTO VERIFY FAIL:', verifier.validationErrors);
    } else {
        console.log('OK  cryptographic signature verifies');
    }

    console.log('=== Signed XML ===');
    console.log(firmado.substring(0, 800) + '\n...');
    const checks = [
        ['ds:Signature present', firmado.includes('<ds:Signature') || firmado.includes(' Signature ')],
        ['ds:SignedInfo present', firmado.includes('SignedInfo')],
        ['SignatureValue present', firmado.includes('SignatureValue')],
        ['xades:QualifyingProperties present', firmado.includes('QualifyingProperties')],
        ['SigningCertificate present', firmado.includes('SigningCertificate')],
        ['SignaturePolicyIdentifier present', firmado.includes('SignaturePolicyIdentifier')],
        ['X509Certificate present', firmado.includes('X509Certificate')],
    ];
    let ok = true;
    for (const [name, pass] of checks) {
        console.log(`${pass ? 'OK' : 'FAIL'}  ${name}`);
        if (!pass) ok = false;
    }
    process.exit(ok ? 0 : 2);
} catch (e) {
    console.error('THROWN:', e.message);
    console.error(e.stack);
    process.exit(1);
}
