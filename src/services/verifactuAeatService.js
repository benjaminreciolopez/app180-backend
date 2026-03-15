import crypto from 'crypto';
import https from 'https';
import fs from 'fs';
import forge from 'node-forge';
import { sql } from '../db.js';

/**
 * Servicio de envío de registros VeriFactu a la AEAT
 *
 * Documentación oficial:
 * https://sede.agenciatributaria.gob.es/Sede/procedimientoini/GI57.shtml
 */

// URLs de los servicios AEAT VeriFactu (del WSDL oficial SistemaFacturacion.wsdl)
const ENDPOINTS = {
  PRUEBAS: 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  PRODUCCION: 'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP'
};

/**
 * Construye el XML para el envío a AEAT según especificación VeriFactu
 * @param {object} registro - Registro de VeriFactu de la BD
 * @param {object} factura - Datos completos de la factura
 * @param {object} emisor - Datos del emisor
 * @returns {string} XML formateado según XSD de AEAT
 */
function construirXmlRegistro(registro, factura, emisor, facturaAnterior = null) {
  const fechaExpedicion = new Date(factura.fecha);
  const fechaRegistro = new Date(registro.fecha_registro);

  const formatFecha = (date) => {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}-${m}-${y}`;
  };

  // Formato ISO datetime con timezone para FechaHoraHusoGenRegistro
  const formatDateTime = (date) => {
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${mo}-${d}T${h}:${mi}:${s}+01:00`;
  };

  // Calcular desglose IVA desde líneas de factura
  const subtotal = Number(factura.subtotal || 0);
  const ivaTotal = Number(factura.iva_total || factura.iva_global || 0);
  const total = Number(factura.total || 0);
  const ivaPct = subtotal > 0 ? Math.round((ivaTotal / subtotal) * 10000) / 100 : 21;

  // Determinar si es primer registro
  let encadenamiento;
  if (registro.hash_anterior && facturaAnterior) {
    const fechaAnt = new Date(facturaAnterior.fecha);
    encadenamiento = `<sf:RegistroAnterior>
            <sf:IDEmisorFactura>${emisor.nif}</sf:IDEmisorFactura>
            <sf:NumSerieFactura>${escaparXml(facturaAnterior.numero)}</sf:NumSerieFactura>
            <sf:FechaExpedicionFactura>${formatFecha(fechaAnt)}</sf:FechaExpedicionFactura>
            <sf:Huella>${registro.hash_anterior}</sf:Huella>
          </sf:RegistroAnterior>`;
  } else {
    encadenamiento = `<sf:PrimerRegistro>S</sf:PrimerRegistro>`;
  }

  const nsLR = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd';
  const nsSF = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd';

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sfLR="${nsLR}"
                  xmlns:sf="${nsSF}">
  <soapenv:Header/>
  <soapenv:Body>
    <sfLR:RegFactuSistemaFacturacion>
      <sfLR:Cabecera>
        <sf:ObligadoEmision>
          <sf:NombreRazon>${escaparXml(emisor.nombre || emisor.nombre_comercial)}</sf:NombreRazon>
          <sf:NIF>${emisor.nif}</sf:NIF>
        </sf:ObligadoEmision>
      </sfLR:Cabecera>
      <sfLR:RegistroFactura>
        <sf:RegistroAlta>
          <sf:IDVersion>1.0</sf:IDVersion>
          <sf:IDFactura>
            <sf:IDEmisorFactura>${emisor.nif}</sf:IDEmisorFactura>
            <sf:NumSerieFactura>${escaparXml(factura.numero)}</sf:NumSerieFactura>
            <sf:FechaExpedicionFactura>${formatFecha(fechaExpedicion)}</sf:FechaExpedicionFactura>
          </sf:IDFactura>
          <sf:NombreRazonEmisor>${escaparXml(emisor.nombre || emisor.nombre_comercial)}</sf:NombreRazonEmisor>
          <sf:TipoFactura>F1</sf:TipoFactura>
          <sf:DescripcionOperacion>${escaparXml(factura.concepto || factura.descripcion || 'Prestacion de servicios')}</sf:DescripcionOperacion>
          <sf:Desglose>
            <sf:DetalleDesglose>
              <sf:Impuesto>01</sf:Impuesto>
              <sf:ClaveRegimen>01</sf:ClaveRegimen>
              <sf:CalificacionOperacion>S1</sf:CalificacionOperacion>
              <sf:TipoImpositivo>${ivaPct.toFixed(2)}</sf:TipoImpositivo>
              <sf:BaseImponibleOimporteNoSujeto>${subtotal.toFixed(2)}</sf:BaseImponibleOimporteNoSujeto>
              <sf:CuotaRepercutida>${ivaTotal.toFixed(2)}</sf:CuotaRepercutida>
            </sf:DetalleDesglose>
          </sf:Desglose>
          <sf:CuotaTotal>${ivaTotal.toFixed(2)}</sf:CuotaTotal>
          <sf:ImporteTotal>${total.toFixed(2)}</sf:ImporteTotal>
          <sf:Encadenamiento>
            ${encadenamiento}
          </sf:Encadenamiento>
          <sf:SistemaInformatico>
            <sf:NombreRazon>Contendo Gestiones</sf:NombreRazon>
            <sf:NIF>${emisor.nif}</sf:NIF>
            <sf:NombreSistemaInformatico>APP180</sf:NombreSistemaInformatico>
            <sf:IdSistemaInformatico>01</sf:IdSistemaInformatico>
            <sf:Version>1.0</sf:Version>
            <sf:NumeroInstalacion>INST-001</sf:NumeroInstalacion>
            <sf:TipoUsoPosibleSoloVerifactu>S</sf:TipoUsoPosibleSoloVerifactu>
            <sf:TipoUsoPosibleMultiOT>N</sf:TipoUsoPosibleMultiOT>
            <sf:IndicadorMultiplesOT>N</sf:IndicadorMultiplesOT>
          </sf:SistemaInformatico>
          <sf:FechaHoraHusoGenRegistro>${formatDateTime(fechaRegistro)}</sf:FechaHoraHusoGenRegistro>
          <sf:TipoHuella>01</sf:TipoHuella>
          <sf:Huella>${registro.hash_actual}</sf:Huella>
        </sf:RegistroAlta>
      </sfLR:RegistroFactura>
    </sfLR:RegFactuSistemaFacturacion>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Escapa caracteres especiales XML
 */
function escaparXml(texto) {
  if (!texto) return '';
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Envía un registro VeriFactu a la AEAT
 * @param {number} registroId - ID del registro en registroverifactu_180
 * @param {string} entorno - 'PRUEBAS' | 'PRODUCCION'
 * @param {string} certificadoPath - Ruta al certificado digital (.p12/.pfx)
 * @param {string} certificadoPassword - Contraseña del certificado
 * @returns {Promise<object>} Respuesta de la AEAT
 */
export async function enviarRegistroAeat(registroId, entorno = 'PRUEBAS', certificadoPath = null, certificadoPassword = null) {
  try {
    // 1. Obtener datos del registro
    const [registro] = await sql`
      SELECT * FROM registroverifactu_180
      WHERE id = ${registroId}
      LIMIT 1
    `;

    if (!registro) {
      throw new Error(`Registro VeriFactu ${registroId} no encontrado`);
    }

    if (registro.estado_envio === 'ENVIADO') {
      console.log(`⚠️ Registro ${registroId} ya fue enviado anteriormente`);
      return {
        success: true,
        mensaje: 'Ya enviado previamente',
        estado: registro.estado_envio
      };
    }

    // 2. Obtener factura completa
    const [factura] = await sql`
      SELECT * FROM factura_180
      WHERE id = ${registro.factura_id}
      LIMIT 1
    `;

    if (!factura) {
      throw new Error(`Factura ${registro.factura_id} no encontrada`);
    }

    // 3. Obtener emisor
    const [emisor] = await sql`
      SELECT * FROM emisor_180
      WHERE empresa_id = ${registro.empresa_id}
      LIMIT 1
    `;

    if (!emisor) {
      throw new Error('Emisor no encontrado');
    }

    // 4. Verificar modo TEST vs PRODUCCIÓN y obtener certificado de BD
    const [config] = await sql`
      SELECT verifactu_modo, verifactu_certificado_data, verifactu_cert_fabricante_data
      FROM configuracionsistema_180
      WHERE empresa_id = ${registro.empresa_id}
      LIMIT 1
    `;

    const esModoTest = config?.verifactu_modo === 'TEST';
    const endpoint = entorno === 'PRODUCCION' && !esModoTest
      ? ENDPOINTS.PRODUCCION
      : ENDPOINTS.PRUEBAS;

    // Obtener certificado data: primero de configuracionsistema, luego de emisor
    let certData = config?.verifactu_certificado_data || null;
    if (!certData && emisor?.certificado_data) {
      certData = emisor.certificado_data;
    }

    console.log(`📡 Enviando a AEAT (${entorno}): ${factura.numero} [cert BD: ${certData ? 'SI' : 'NO'}]`);

    // 5. Obtener factura anterior para encadenamiento
    let facturaAnterior = null;
    if (registro.hash_anterior) {
      const [regAnterior] = await sql`
        SELECT r.factura_id, f.numero, f.fecha
        FROM registroverifactu_180 r
        JOIN factura_180 f ON f.id = r.factura_id
        WHERE r.empresa_id = ${registro.empresa_id}
          AND r.hash_actual = ${registro.hash_anterior}
        LIMIT 1
      `;
      if (regAnterior) {
        facturaAnterior = { numero: regAnterior.numero, fecha: regAnterior.fecha };
      }
    }

    // 6. Construir XML
    const xmlBody = construirXmlRegistro(registro, factura, emisor, facturaAnterior);

    // 6. Enviar a AEAT (SOAP) - pasar certificado data de BD
    const respuesta = await enviarSoapAeat(endpoint, xmlBody, certificadoPath, certificadoPassword, certData);

    // 7. Actualizar estado en BD
    if (respuesta.success) {
      await sql`
        UPDATE registroverifactu_180
        SET estado_envio = 'ENVIADO',
            fecha_envio = ${new Date()},
            respuesta_aeat = ${JSON.stringify(respuesta)}
        WHERE id = ${registroId}
      `;

      console.log(`✅ Registro ${registroId} enviado correctamente a AEAT`);
    } else {
      await sql`
        UPDATE registroverifactu_180
        SET estado_envio = 'ERROR',
            respuesta_aeat = ${JSON.stringify(respuesta)}
        WHERE id = ${registroId}
      `;

      console.error(`❌ Error al enviar registro ${registroId}:`, respuesta.mensaje);
    }

    return respuesta;

  } catch (error) {
    console.error('❌ Error en enviarRegistroAeat:', error);

    // Actualizar estado a ERROR
    await sql`
      UPDATE registroverifactu_180
      SET estado_envio = 'ERROR',
          respuesta_aeat = ${JSON.stringify({ error: error.message })}
      WHERE id = ${registroId}
    `;

    throw error;
  }
}

/**
 * Realiza la petición SOAP a la AEAT
 * @param {string} endpoint - URL del servicio AEAT
 * @param {string} xmlBody - Cuerpo XML de la petición
 * @param {string} certificadoPath - Ruta al certificado digital
 * @param {string} certificadoPassword - Contraseña del certificado
 * @returns {Promise<object>}
 */
async function enviarSoapAeat(endpoint, xmlBody, certificadoPath, certificadoPassword, certificadoData = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(xmlBody),
        'SOAPAction': ''
      }
    };

    // Cargar certificado y convertir PKCS#12 a PEM con node-forge
    // (Node.js https nativo no soporta todos los formatos PKCS#12, especialmente los de FNMT)
    let certLoaded = false;

    try {
      let p12Der = null;

      if (certificadoData) {
        p12Der = forge.util.decode64(certificadoData);
        console.log('🔐 Certificado cargado desde BD (base64)');
      } else if (certificadoPath && fs.existsSync(certificadoPath)) {
        const fileBuffer = fs.readFileSync(certificadoPath);
        p12Der = forge.util.decode64(fileBuffer.toString('base64'));
        console.log('🔐 Certificado cargado desde filesystem');
      }

      if (p12Der) {
        const p12Asn1 = forge.asn1.fromDer(p12Der);
        const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, certificadoPassword || '', { strict: false });

        // Extraer certificados
        const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
        const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];

        if (certBags.length > 0 && keyBags.length > 0) {
          const certPem = forge.pki.certificateToPem(certBags[0].cert);
          const keyPem = forge.pki.privateKeyToPem(keyBags[0].key);

          options.cert = certPem;
          options.key = keyPem;
          options.rejectUnauthorized = endpoint.includes('prewww') ? false : true;
          certLoaded = true;
          console.log('🔐 Certificado convertido a PEM correctamente');
        } else {
          console.warn('⚠️ No se encontraron certificado/clave en el PKCS#12');
        }
      }
    } catch (error) {
      console.error('❌ Error al procesar certificado PKCS#12:', error.message);
      return reject(new Error(`Error al procesar certificado: ${error.message}`));
    }

    if (!certLoaded) {
      console.warn('⚠️ No se encontró certificado digital. La AEAT puede rechazar la petición.');
    }

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        // Parsear respuesta XML de la AEAT
        const resultado = parsearRespuestaAeat(data, res.statusCode);
        resolve(resultado);
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Error de conexión con AEAT: ${error.message}`));
    });

    req.write(xmlBody);
    req.end();
  });
}

/**
 * Parsea la respuesta XML de la AEAT
 * @param {string} xmlResponse - Respuesta XML del servicio
 * @param {number} statusCode - Código HTTP de la respuesta
 * @returns {object}
 */
function parsearRespuestaAeat(xmlResponse, statusCode) {
  try {
    // Detectar SOAP Fault (error de esquema, autenticación, etc.)
    if (xmlResponse.includes('Fault>') || xmlResponse.includes('<faultstring>')) {
      const faultMatch = xmlResponse.match(/<faultstring>([^<]+)<\/faultstring>/);
      return {
        success: false,
        mensaje: faultMatch ? faultMatch[1] : 'SOAP Fault desconocido',
        respuestaCompleta: xmlResponse
      };
    }

    if (statusCode === 200) {
      const tieneError = xmlResponse.includes('<CodigoError>') || xmlResponse.includes('<DescripcionError>');
      const esCorrecto = xmlResponse.includes('Correcto') || xmlResponse.includes('<CSV>');

      if (esCorrecto && !tieneError) {
        const csvMatch = xmlResponse.match(/<CSV>([^<]+)<\/CSV>/);
        return {
          success: true,
          mensaje: 'Registro aceptado por AEAT',
          csv: csvMatch ? csvMatch[1] : null,
          respuestaCompleta: xmlResponse
        };
      } else {
        const errorMatch = xmlResponse.match(/<DescripcionError>([^<]+)<\/DescripcionError>/);
        const codigoMatch = xmlResponse.match(/<CodigoError>([^<]+)<\/CodigoError>/);
        return {
          success: false,
          mensaje: errorMatch ? errorMatch[1] : 'Error en registro',
          codigoError: codigoMatch ? codigoMatch[1] : null,
          respuestaCompleta: xmlResponse
        };
      }
    } else {
      return {
        success: false,
        mensaje: `HTTP ${statusCode}: ${xmlResponse.substring(0, 300)}`,
        respuestaCompleta: xmlResponse
      };
    }
  } catch (error) {
    return {
      success: false,
      mensaje: `Error al parsear respuesta: ${error.message}`,
      respuestaCompleta: xmlResponse
    };
  }
}

/**
 * Envía todos los registros pendientes de una empresa
 * @param {number} empresaId
 * @param {string} entorno - 'PRUEBAS' | 'PRODUCCION'
 * @param {string} certificadoPath
 * @param {string} certificadoPassword
 * @returns {Promise<object>} Resumen del envío
 */
export async function enviarRegistrosPendientes(empresaId, entorno = 'PRUEBAS', certificadoPath = null, certificadoPassword = null) {
  const pendientes = await sql`
    SELECT id, numero_factura
    FROM registroverifactu_180
    WHERE empresa_id = ${empresaId}
      AND estado_envio = 'PENDIENTE'
    ORDER BY fecha_registro ASC
  `;

  if (pendientes.length === 0) {
    return {
      total: 0,
      enviados: 0,
      errores: 0,
      mensaje: 'No hay registros pendientes'
    };
  }

  console.log(`📤 Enviando ${pendientes.length} registros pendientes...`);

  let enviados = 0;
  let errores = 0;
  const resultados = [];

  for (const registro of pendientes) {
    try {
      const resultado = await enviarRegistroAeat(
        registro.id,
        entorno,
        certificadoPath,
        certificadoPassword
      );

      if (resultado.success) {
        enviados++;
      } else {
        errores++;
      }

      resultados.push({
        registroId: registro.id,
        numeroFactura: registro.numero_factura,
        resultado: resultado
      });

      // Esperar 500ms entre peticiones para no saturar la AEAT
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      errores++;
      resultados.push({
        registroId: registro.id,
        numeroFactura: registro.numero_factura,
        resultado: { success: false, mensaje: error.message }
      });
    }
  }

  return {
    total: pendientes.length,
    enviados,
    errores,
    resultados
  };
}

/**
 * Endpoint de testing para verificar conexión con AEAT
 */
export async function testConexionAeat(entorno = 'PRUEBAS', certificadoPath = null, certificadoPassword = null, certificadoData = null) {
  const endpoint = entorno === 'PRODUCCION'
    ? ENDPOINTS.PRODUCCION
    : ENDPOINTS.PRUEBAS;

  console.log(`🧪 Probando conexión con AEAT (${entorno})...`);
  console.log(`   Endpoint: ${endpoint}`);

  if (certificadoData) {
    console.log(`   Certificado: desde BD (base64)`);
  } else if (certificadoPath) {
    console.log(`   Certificado: ${certificadoPath}`);
  } else {
    console.warn(`   ⚠️ Sin certificado - la conexión puede fallar`);
  }

  return new Promise((resolve) => {
    const url = new URL(endpoint);

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'HEAD',
      timeout: 10000
    };

    // Cargar certificado: primero base64 de BD, luego filesystem
    let pfx = null;
    if (certificadoData) {
      pfx = Buffer.from(certificadoData, 'base64');
    } else if (certificadoPath && fs.existsSync(certificadoPath)) {
      pfx = fs.readFileSync(certificadoPath);
    }

    if (pfx) {
      options.pfx = pfx;
      options.passphrase = certificadoPassword;
      options.rejectUnauthorized = entorno === 'PRODUCCION';
    }

    const req = https.request(options, (res) => {
      resolve({
        success: res.statusCode < 500,
        mensaje: `Conectado - HTTP ${res.statusCode}`,
        endpoint: endpoint
      });
    });

    req.on('error', (error) => {
      resolve({
        success: false,
        mensaje: `Error de conexión: ${error.message}`,
        endpoint: endpoint
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        success: false,
        mensaje: 'Timeout - La AEAT no responde',
        endpoint: endpoint
      });
    });

    req.end();
  });
}
