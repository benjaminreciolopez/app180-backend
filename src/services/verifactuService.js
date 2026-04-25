import { sql } from '../db.js';
import crypto from 'crypto';
import { firmarRegistroDoble } from './firmaDigitalService.js';
import logger from '../utils/logger.js';

/**
 * Servicio de Veri*Factu (Sistema de Emisión de Facturas Verificables)
 * Adaptación de control_verifactu.py
 */

/**
 * Obtiene la configuración del sistema para la empresa
 */
async function getConfig(empresaId) {
    const [config] = await sql`
    SELECT * FROM configuracionsistema_180
    WHERE empresa_id = ${empresaId}
    LIMIT 1
  `;
    return config;
}

/**
 * Obtiene el emisor de la empresa
 */
async function getEmisor(empresaId) {
    const [emisor] = await sql`
    SELECT * FROM emisor_180
    WHERE empresa_id = ${empresaId}
    LIMIT 1
  `;
    return emisor;
}

/**
 * Obtiene el hash anterior encadenado, filtrado por modo (TEST o PRODUCCION).
 * Esto garantiza que la cadena TEST y la cadena PRODUCCION son completamente independientes.
 */
async function obtenerHashAnterior(empresaId, modo = 'PRODUCCION') {
    const [ultimo] = await sql`
    SELECT hash_actual FROM registroverifactu_180
    WHERE empresa_id = ${empresaId}
      AND modo_verifactu = ${modo}
    ORDER BY fecha_registro DESC
    LIMIT 1
  `;
    return ultimo ? ultimo.hash_actual : "";
}

/**
 * Genera el hash SHA-256 según especificación Veri*Factu
 */
/**
 * Genera la huella SHA-256 según especificación VeriFactu de la AEAT.
 * Formato: IDEmisorFactura=X&NumSerieFactura=X&FechaExpedicionFactura=DD-MM-YYYY&TipoFactura=F1&CuotaTotal=X.XX&ImporteTotal=X.XX&Huella=HASH_ANTERIOR&FechaHoraHusoGenRegistro=YYYY-MM-DDTHH:MM:SS+01:00
 */
function generarHashVerifactu(factura, nifEmisor, fechaGeneracion, hashAnterior) {
    if (!factura.numero) throw new Error("Factura sin número");
    if (!factura.fecha) throw new Error("Factura sin fecha");

    // Formato fecha expedición: DD-MM-YYYY
    const fechaExp = new Date(factura.fecha);
    const day = String(fechaExp.getDate()).padStart(2, '0');
    const month = String(fechaExp.getMonth() + 1).padStart(2, '0');
    const year = fechaExp.getFullYear();
    const fechaExpStr = `${day}-${month}-${year}`;

    // Formato FechaHoraHusoGenRegistro: YYYY-MM-DDTHH:MM:SS+01:00
    const y = fechaGeneracion.getFullYear();
    const mo = String(fechaGeneracion.getMonth() + 1).padStart(2, '0');
    const d = String(fechaGeneracion.getDate()).padStart(2, '0');
    const h = String(fechaGeneracion.getHours()).padStart(2, '0');
    const mi = String(fechaGeneracion.getMinutes()).padStart(2, '0');
    const s = String(fechaGeneracion.getSeconds()).padStart(2, '0');
    const fechaHoraHuso = `${y}-${mo}-${d}T${h}:${mi}:${s}+01:00`;

    const cuotaTotal = Number(factura.iva_total || 0).toFixed(2);
    const importeTotal = Number(factura.total || 0).toFixed(2);

    // Concatenación según especificación AEAT
    const cadena = [
        `IDEmisorFactura=${nifEmisor.trim().toUpperCase()}`,
        `NumSerieFactura=${(factura.numero || '').trim()}`,
        `FechaExpedicionFactura=${fechaExpStr}`,
        `TipoFactura=F1`,
        `CuotaTotal=${cuotaTotal}`,
        `ImporteTotal=${importeTotal}`,
        `Huella=${(hashAnterior || '').toUpperCase()}`,
        `FechaHoraHusoGenRegistro=${fechaHoraHuso}`
    ].join('&');

    logger.debug('verifactu hash cadena built', { length: cadena.length });

    // AEAT calcula y compara hashes en MAYÚSCULAS
    return crypto.createHash('sha256').update(cadena, 'utf8').digest('hex').toUpperCase();
}

/**
 * Función principal: Verificar y registrar factura en Veri*Factu
 * @param {object} factura - Objeto factura completo
 * @param {object} tx - Transacción SQL opcional (si se llama dentro de una transacción)
 */
export async function verificarVerifactu(factura, tx = sql) {
    try {
        const empresaId = factura.empresa_id;
        if (!empresaId) throw new Error("Factura sin empresa_id");

        const config = await getConfig(empresaId);

        // Si no hay config o está OFF, salir
        if (!config || !config.verifactu_activo || config.verifactu_modo === 'OFF') {
            logger.info('verifactu off or not configured');
            return;
        }

        if (factura.estado !== 'VALIDADA') {
            // Nota: El original decía BORRADOR, pero se llama al VALIDAR. 
            // Al momento de llamar a esta función, la factura debería acabar de pasar a VALIDADA o estar en proceso.
            // Asumiremos que se llama DENTRO de la transacción de validación, por tanto ya tiene número y fecha.
        }

        const emisor = await getEmisor(empresaId);
        if (!emisor || !emisor.nif) {
            throw new Error("Emisor sin NIF configurado");
        }

        const fechaGeneracion = new Date(); // UTC
        const modoActual = config.verifactu_modo; // 'TEST' o 'PRODUCCION'
        const hashAnterior = await obtenerHashAnterior(empresaId, modoActual);

        const nuevoHash = generarHashVerifactu(
            factura,
            emisor.nif,
            fechaGeneracion,
            hashAnterior
        );

        // Firma digital (si ambos certificados están configurados)
        let firmaData = null;
        if (config.verifactu_certificado_path && config.verifactu_cert_fabricante_path) {
            try {
                firmaData = await firmarRegistroDoble(
                    nuevoHash,
                    config.verifactu_certificado_path,
                    config.verifactu_certificado_password,
                    config.verifactu_cert_fabricante_path,
                    config.verifactu_cert_fabricante_password
                );
                logger.info('verifactu signed: client + fabricante');
            } catch (error) {
                logger.warn('verifactu sign failed', { message: error.message });
                // No fallar la transacción por fallo de firma (aún puede enviarse sin firma)
            }
        } else {
            logger.info('verifactu sign skipped: no signature config');
        }

        // Guardar registro
        const [nuevoRegistro] = await tx`
      INSERT INTO registroverifactu_180 (
        factura_id, numero_factura, fecha_factura, total_factura,
        hash_actual, hash_anterior, fecha_registro, estado_envio, empresa_id,
        modo_verifactu,
        firma_cliente, firma_fabricante, info_cert_cliente, info_cert_fabricante,
        fecha_firma, algoritmo_firma
      ) VALUES (
        ${factura.id},
        ${factura.numero},
        ${factura.fecha},
        ${factura.total},
        ${nuevoHash},
        ${hashAnterior},
        ${fechaGeneracion},
        'PENDIENTE',
        ${empresaId},
        ${modoActual},
        ${firmaData?.firmaCliente || null},
        ${firmaData?.firmaFabricante || null},
        ${firmaData ? JSON.stringify(firmaData.infoCliente) : null},
        ${firmaData ? JSON.stringify(firmaData.infoFabricante) : null},
        ${firmaData?.fechaFirma || null},
        ${firmaData?.algoritmo || 'SHA-256-RSA'}
      )
      RETURNING id
    `;

        // Actualizar factura con hash
        await tx`
      UPDATE factura_180
      SET verifactu_hash = ${nuevoHash},
          verifactu_fecha_generacion = ${fechaGeneracion}
      WHERE id = ${factura.id}
    `;

        logger.info('verifactu record created', { facturaId: factura.id });

        // Retornar datos necesarios para el envío post-transacción
        return {
            registroId: nuevoRegistro.id,
            hash: nuevoHash,
            config,
        };

    } catch (error) {
        logger.error('verifactu verify failed', { message: error.message });
        // En un sistema fiscal estricto, esto debería fallar la transacción.
        throw error;
    }
}

/**
 * Construye la URL para el código QR de Veri*Factu
 * @param {object} factura
 * @param {object} emisor
 * @param {object} config
 * @param {string} entorno - 'PRUEBAS' | 'PRODUCCION'
 * @returns {string} URL completa
 */
export function construirUrlQr(factura, emisor, config, entorno = 'PRODUCCION') {
    const isTest = entorno === 'PRUEBAS' || config.verifactu_modo === 'TEST';

    // URLs oficiales AEAT para validación QR VeriFactu
    const baseUrl = isTest
        ? 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR'
        : 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR';

    const fechaObj = new Date(factura.fecha);
    const day = String(fechaObj.getDate()).padStart(2, '0');
    const month = String(fechaObj.getMonth() + 1).padStart(2, '0');
    const year = fechaObj.getFullYear();
    const fechaStr = `${day}-${month}-${year}`;

    const params = new URLSearchParams();
    params.append('nif', (emisor.nif || '').toUpperCase());
    params.append('numserie', (factura.numero || '').toUpperCase());
    params.append('fecha', fechaStr);
    params.append('importe', Number(factura.total || 0).toFixed(2));

    return `${baseUrl}?${params.toString()}`;
}
