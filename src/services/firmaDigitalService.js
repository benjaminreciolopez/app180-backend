import forge from 'node-forge';
import fs from 'fs/promises';
import crypto from 'crypto';

/**
 * Servicio de Firma Digital para VeriFactu
 *
 * Sistema de DOBLE FIRMA:
 * 1. Firma del CLIENTE (usuario final) - Certificado del contribuyente
 * 2. Firma del FABRICANTE (productor) - Certificado del desarrollador
 *
 * Requisito: RD 1007/2023 para venta/distribución de software
 */

/**
 * Carga un certificado digital .p12/.pfx
 *
 * @param {string} certificadoPath - Ruta al archivo .p12
 * @param {string} password - Contraseña del certificado
 * @returns {Object} { privateKey, certificate, certChain }
 */
async function cargarCertificado(certificadoPath, password) {
  try {
    const p12Buffer = await fs.readFile(certificadoPath);
    const p12Der = forge.util.binary.raw.encode(new Uint8Array(p12Buffer));
    const p12Asn1 = forge.asn1.fromDer(p12Der);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

    // Obtener clave privada
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag][0];
    const privateKey = keyBag.key;

    // Obtener certificado
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBag = certBags[forge.pki.oids.certBag][0];
    const certificate = certBag.cert;

    // Cadena de certificados (si existe)
    const certChain = certBags[forge.pki.oids.certBag].map(bag => bag.cert);

    return {
      privateKey,
      certificate,
      certChain
    };

  } catch (error) {
    console.error('❌ Error al cargar certificado:', error.message);
    throw new Error(`Error al cargar certificado: ${error.message}`);
  }
}

/**
 * Firma un hash con un certificado digital
 *
 * @param {string} hash - Hash SHA-256 a firmar
 * @param {Object} cert - Certificado cargado (de cargarCertificado)
 * @returns {string} Firma en base64
 */
function firmarHash(hash, cert) {
  try {
    const md = forge.md.sha256.create();
    md.update(hash, 'utf8');

    const signature = cert.privateKey.sign(md);
    return forge.util.encode64(signature);

  } catch (error) {
    console.error('❌ Error al firmar hash:', error.message);
    throw new Error(`Error al firmar: ${error.message}`);
  }
}

/**
 * Verifica una firma digital
 *
 * @param {string} hash - Hash original
 * @param {string} signature - Firma en base64
 * @param {Object} certificate - Certificado público
 * @returns {boolean} true si la firma es válida
 */
function verificarFirma(hash, signature, certificate) {
  try {
    const md = forge.md.sha256.create();
    md.update(hash, 'utf8');

    const signatureBytes = forge.util.decode64(signature);
    return certificate.publicKey.verify(md.digest().bytes(), signatureBytes);

  } catch (error) {
    console.error('❌ Error al verificar firma:', error.message);
    return false;
  }
}

/**
 * Obtiene información del certificado
 *
 * @param {Object} certificate - Certificado
 * @returns {Object} Información del certificado
 */
function obtenerInfoCertificado(certificate) {
  const subject = certificate.subject.attributes.reduce((acc, attr) => {
    acc[attr.shortName] = attr.value;
    return acc;
  }, {});

  const issuer = certificate.issuer.attributes.reduce((acc, attr) => {
    acc[attr.shortName] = attr.value;
    return acc;
  }, {});

  return {
    subject: {
      CN: subject.CN || '',  // Common Name
      O: subject.O || '',    // Organization
      OU: subject.OU || '',  // Organizational Unit
      serialNumber: subject.serialNumber || '' // NIF
    },
    issuer: {
      CN: issuer.CN || '',
      O: issuer.O || '',
      C: issuer.C || ''      // Country
    },
    validFrom: certificate.validity.notBefore,
    validTo: certificate.validity.notAfter,
    serialNumber: certificate.serialNumber,
    fingerprint: forge.md.sha256.create()
      .update(forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes())
      .digest()
      .toHex()
  };
}

/**
 * Firma un registro VeriFactu con DOBLE FIRMA
 *
 * 1. Firma del CLIENTE (certificado del usuario/empresa)
 * 2. Firma del FABRICANTE (certificado del productor de software)
 *
 * @param {string} hash - Hash del registro
 * @param {string} certificadoClientePath - Ruta al certificado del cliente
 * @param {string} certificadoClientePassword - Contraseña del certificado del cliente
 * @param {string} certificadoFabricantePath - Ruta al certificado del fabricante
 * @param {string} certificadoFabricantePassword - Contraseña del certificado del fabricante
 * @returns {Object} { firmaCliente, firmaFabricante, infoCliente, infoFabricante }
 */
export async function firmarRegistroDoble(
  hash,
  certificadoClientePath,
  certificadoClientePassword,
  certificadoFabricantePath,
  certificadoFabricantePassword
) {
  try {
    // Cargar certificado del CLIENTE
    const certCliente = await cargarCertificado(
      certificadoClientePath,
      certificadoClientePassword
    );

    // Cargar certificado del FABRICANTE
    const certFabricante = await cargarCertificado(
      certificadoFabricantePath,
      certificadoFabricantePassword
    );

    // Firmar con certificado del CLIENTE
    const firmaCliente = firmarHash(hash, certCliente);

    // Firmar con certificado del FABRICANTE
    const firmaFabricante = firmarHash(hash, certFabricante);

    // Obtener información de los certificados
    const infoCliente = obtenerInfoCertificado(certCliente.certificate);
    const infoFabricante = obtenerInfoCertificado(certFabricante.certificate);

    return {
      firmaCliente,
      firmaFabricante,
      infoCliente,
      infoFabricante,
      algoritmo: 'SHA-256-RSA',
      fechaFirma: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ Error en firma doble:', error.message);
    throw error;
  }
}

/**
 * Verifica las firmas de un registro
 *
 * @param {string} hash - Hash original
 * @param {string} firmaCliente - Firma del cliente en base64
 * @param {string} firmaFabricante - Firma del fabricante en base64
 * @param {string} certificadoClientePath - Ruta al certificado del cliente
 * @param {string} certificadoFabricantePath - Ruta al certificado del fabricante
 * @returns {Object} { clienteValida, fabricanteValida }
 */
export async function verificarFirmasDobles(
  hash,
  firmaCliente,
  firmaFabricante,
  certificadoClientePath,
  certificadoFabricantePath
) {
  try {
    // Cargar certificados (sin password, solo parte pública)
    const certCliente = await cargarCertificado(certificadoClientePath, '');
    const certFabricante = await cargarCertificado(certificadoFabricantePath, '');

    // Verificar firma del cliente
    const clienteValida = verificarFirma(hash, firmaCliente, certCliente.certificate);

    // Verificar firma del fabricante
    const fabricanteValida = verificarFirma(hash, firmaFabricante, certFabricante.certificate);

    return {
      clienteValida,
      fabricanteValida,
      ambasValidas: clienteValida && fabricanteValida
    };

  } catch (error) {
    console.error('❌ Error al verificar firmas:', error.message);
    return {
      clienteValida: false,
      fabricanteValida: false,
      ambasValidas: false,
      error: error.message
    };
  }
}

/**
 * Obtiene el NIF del certificado
 *
 * @param {string} certificadoPath - Ruta al certificado
 * @param {string} password - Contraseña
 * @returns {string} NIF extraído del certificado
 */
export async function obtenerNIFCertificado(certificadoPath, password) {
  try {
    const cert = await cargarCertificado(certificadoPath, password);
    const info = obtenerInfoCertificado(cert.certificate);
    return info.subject.serialNumber || '';
  } catch (error) {
    console.error('❌ Error al obtener NIF:', error.message);
    return '';
  }
}

/**
 * Valida que un certificado sea válido y no haya expirado
 *
 * @param {string} certificadoPath - Ruta al certificado
 * @param {string} password - Contraseña
 * @returns {Object} { valido, mensaje, info }
 */
export async function validarCertificado(certificadoPath, password) {
  try {
    const cert = await cargarCertificado(certificadoPath, password);
    const info = obtenerInfoCertificado(cert.certificate);

    const ahora = new Date();
    const valido = ahora >= info.validFrom && ahora <= info.validTo;

    if (!valido) {
      return {
        valido: false,
        mensaje: ahora < info.validFrom
          ? 'Certificado aún no válido'
          : 'Certificado expirado',
        info
      };
    }

    return {
      valido: true,
      mensaje: 'Certificado válido',
      info
    };

  } catch (error) {
    return {
      valido: false,
      mensaje: `Error: ${error.message}`,
      info: null
    };
  }
}
