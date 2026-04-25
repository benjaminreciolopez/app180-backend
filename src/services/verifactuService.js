import { sql } from '../db.js';
import crypto from 'crypto';
import { firmarRegistroDoble } from './firmaDigitalService.js';
import { firmarXadesEpes } from './xadesService.js';
import { selloTiempo } from './tsaService.js';
import {
    construirFragmentoRegistroAlta,
    construirFragmentoRegistroAnulacion,
} from './verifactuAeatService.js';
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

        // Firma XAdES-EPES + sello de tiempo del registro recién creado
        // (no bloquea la transacción si falla — fire-and-log internal).
        await firmarYPersistirXmlRegistro(nuevoRegistro.id, tx);

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
 * Firma XAdES-EPES del fragmento de registro y persistencia en BD.
 *
 * Se llama tras INSERT de un registro (alta o anulación). Si no hay
 * certificado del cliente disponible, se omite silenciosamente — el registro
 * queda con `xml_firmado = NULL` y se podrá firmar a posteriori. Esto evita
 * que un fallo de certificado bloquee la creación del registro.
 *
 * @param {number} registroId - ID del registro recién insertado
 * @param {object} tx - Conexión de transacción (sql) opcional
 */
async function firmarYPersistirXmlRegistro(registroId, tx = sql) {
    try {
        const [registro] = await tx`
            SELECT * FROM registroverifactu_180 WHERE id = ${registroId}
        `;
        if (!registro) return;

        const [factura] = await tx`SELECT * FROM factura_180 WHERE id = ${registro.factura_id}`;
        if (!factura) return;

        const [emisor] = await tx`SELECT * FROM emisor_180 WHERE empresa_id = ${registro.empresa_id}`;
        if (!emisor) return;

        const [config] = await tx`
            SELECT verifactu_certificado_data, verifactu_certificado_password
            FROM configuracionsistema_180 WHERE empresa_id = ${registro.empresa_id}
        `;

        const certData = config?.verifactu_certificado_data || emisor.certificado_data || null;
        const certPwd = config?.verifactu_certificado_password || null;
        if (!certData) {
            logger.info('xades skip: no certificate', { registroId });
            return;
        }

        let facturaAnterior = null;
        if (registro.hash_anterior) {
            const [regAnt] = await tx`
                SELECT f.numero, f.fecha
                FROM registroverifactu_180 r
                JOIN factura_180 f ON f.id = r.factura_id
                WHERE r.empresa_id = ${registro.empresa_id}
                  AND r.hash_actual = ${registro.hash_anterior}
                LIMIT 1
            `;
            if (regAnt) facturaAnterior = { numero: regAnt.numero, fecha: regAnt.fecha };
        }

        let cliente = null;
        if (factura.cliente_id) {
            const [cl] = await tx`
                SELECT nombre, COALESCE(NULLIF(TRIM(nif),''), NULLIF(TRIM(nif_cif),'')) AS nif
                FROM clients_180 WHERE id = ${factura.cliente_id} LIMIT 1
            `;
            if (cl) {
                if (cl.nif) cl.nif = cl.nif.replace(/[\s.\-]/g, '').toUpperCase();
                cliente = cl;
            }
        }

        const fragmento = registro.tipo_registro === 'ANULACION'
            ? construirFragmentoRegistroAnulacion(registro, factura, emisor, facturaAnterior)
            : construirFragmentoRegistroAlta(registro, factura, emisor, facturaAnterior, cliente);

        const xmlFirmado = firmarXadesEpes(fragmento, `reg-${registro.id}`, certData, certPwd);
        const tsa = await selloTiempo(xmlFirmado);

        await tx`
            UPDATE registroverifactu_180
            SET xml_firmado = ${xmlFirmado},
                tsa_timestamp_token = ${tsa.token},
                tsa_timestamp_at = ${tsa.timestampAt}
            WHERE id = ${registroId}
        `;

        logger.info('xades signed and persisted', { registroId, tsaProvider: tsa.provider });
    } catch (error) {
        // No fallar la transacción del registro si la firma XAdES falla —
        // se podrá refirmar mediante un job de mantenimiento.
        logger.warn('xades sign failed, registro queda sin xml_firmado', {
            registroId,
            message: error.message,
        });
    }
}

/**
 * Genera la huella SHA-256 para RegistroAnulacion (RD 1007/2023).
 *
 * Cadena oficial AEAT (orden fijo):
 *   IDEmisorFacturaAnulada=X&NumSerieFacturaAnulada=X
 *   &FechaExpedicionFacturaAnulada=DD-MM-YYYY
 *   &Huella=HASH_ANTERIOR
 *   &FechaHoraHusoGenRegistro=YYYY-MM-DDTHH:MM:SS+01:00
 *
 * Importante: la cadena de encadenamiento de ANULACION comparte cola con la
 * de ALTA — ambas usan `hash_anterior` del último registro de la empresa en
 * el mismo modo, sea ALTA o ANULACION.
 */
function generarHashAnulacion(facturaAnulada, nifEmisor, fechaGeneracion, hashAnterior) {
    if (!facturaAnulada.numero) throw new Error('Factura sin número');
    if (!facturaAnulada.fecha) throw new Error('Factura sin fecha');

    const fechaExp = new Date(facturaAnulada.fecha);
    const day = String(fechaExp.getDate()).padStart(2, '0');
    const month = String(fechaExp.getMonth() + 1).padStart(2, '0');
    const year = fechaExp.getFullYear();
    const fechaExpStr = `${day}-${month}-${year}`;

    const y = fechaGeneracion.getFullYear();
    const mo = String(fechaGeneracion.getMonth() + 1).padStart(2, '0');
    const d = String(fechaGeneracion.getDate()).padStart(2, '0');
    const h = String(fechaGeneracion.getHours()).padStart(2, '0');
    const mi = String(fechaGeneracion.getMinutes()).padStart(2, '0');
    const s = String(fechaGeneracion.getSeconds()).padStart(2, '0');
    const fechaHoraHuso = `${y}-${mo}-${d}T${h}:${mi}:${s}+01:00`;

    const cadena = [
        `IDEmisorFacturaAnulada=${nifEmisor.trim().toUpperCase()}`,
        `NumSerieFacturaAnulada=${(facturaAnulada.numero || '').trim()}`,
        `FechaExpedicionFacturaAnulada=${fechaExpStr}`,
        `Huella=${(hashAnterior || '').toUpperCase()}`,
        `FechaHoraHusoGenRegistro=${fechaHoraHuso}`
    ].join('&');

    return crypto.createHash('sha256').update(cadena, 'utf8').digest('hex').toUpperCase();
}

/**
 * Crea un RegistroAnulacion en BD para una factura previamente enviada.
 * Igual que verificarVerifactu pero genera el registro de cancelación que
 * exige la AEAT cuando se invalida una factura ya remitida.
 *
 * @param {object} factura - Factura original (ya validada y enviada)
 * @param {string} motivo - Texto libre de auditoría interna
 * @param {object} tx - Transacción SQL opcional
 * @returns {{ registroId, hash, config } | null}
 */
export async function crearRegistroAnulacion(factura, motivo = null, tx = sql) {
    try {
        const empresaId = factura.empresa_id;
        if (!empresaId) throw new Error('Factura sin empresa_id');

        const config = await getConfig(empresaId);
        if (!config || !config.verifactu_activo || config.verifactu_modo === 'OFF') {
            logger.info('verifactu off, anulacion not registered');
            return null;
        }

        const emisor = await getEmisor(empresaId);
        if (!emisor || !emisor.nif) throw new Error('Emisor sin NIF configurado');

        const fechaGeneracion = new Date();
        const modoActual = config.verifactu_modo;
        const hashAnterior = await obtenerHashAnterior(empresaId, modoActual);

        const nuevoHash = generarHashAnulacion(factura, emisor.nif, fechaGeneracion, hashAnterior);

        const [nuevoRegistro] = await tx`
            INSERT INTO registroverifactu_180 (
                factura_id, numero_factura, fecha_factura, total_factura,
                hash_actual, hash_anterior, fecha_registro, estado_envio, empresa_id,
                modo_verifactu, tipo_registro, factura_anulada_id, motivo_anulacion
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
                'ANULACION',
                ${factura.id},
                ${motivo}
            )
            RETURNING id
        `;

        logger.info('verifactu anulacion record created', { facturaId: factura.id, motivo });

        await firmarYPersistirXmlRegistro(nuevoRegistro.id, tx);

        return {
            registroId: nuevoRegistro.id,
            hash: nuevoHash,
            config
        };
    } catch (error) {
        logger.error('crearRegistroAnulacion failed', { message: error.message });
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
