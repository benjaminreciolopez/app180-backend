import { sql } from '../db.js';
import crypto from 'crypto';

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
 * Obtiene el hash anterior encadenado
 */
async function obtenerHashAnterior(empresaId) {
    const [ultimo] = await sql`
    SELECT hash_actual FROM registroverifactu_180
    WHERE empresa_id = ${empresaId}
    ORDER BY fecha_registro DESC
    LIMIT 1
  `;
    return ultimo ? ultimo.hash_actual : "";
}

/**
 * Genera el hash SHA-256 según especificación Veri*Factu
 */
function generarHashVerifactu(factura, nifEmisor, fechaGeneracion, hashAnterior) {
    if (!factura.numero) throw new Error("Factura sin número");
    if (!factura.fecha) throw new Error("Factura sin fecha");

    // Payload canónico
    const payload = {
        emisor: {
            nif: nifEmisor.trim().toUpperCase(),
        },
        factura: {
            numero: factura.numero.trim(),
            fecha: new Date(factura.fecha).toISOString().slice(0, 10), // YYYY-MM-DD
            total: parseFloat(factura.total || 0),
        },
        registro: {
            fecha_registro_utc: fechaGeneracion.toISOString(),
            hash_anterior: hashAnterior || "",
        },
    };

    // Serialización determinista (equivalente a sort_keys=True, ensure_ascii=False)
    // En JS JSON.stringify no garantiza orden de claves, debemos hacerlo manualmente o usar librería.
    // Para simplificar, construiremos el objeto con orden fijo o usaremos una función deepSort.
    // La especificación Veri*Factu real es más compleja (XML), esto es una adaptación interna.

    // Vamos a usar un enfoque simple: serializar keys ordenadas.
    const canonico = canonicalJsonStringify(payload);

    return crypto.createHash('sha256').update(canonico, 'utf8').digest('hex');
}

function canonicalJsonStringify(obj) {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
        return JSON.stringify(obj);
    }
    const keys = Object.keys(obj).sort();
    const result = {};
    for (const key of keys) {
        result[key] = canonicalJsonStringify(obj[key]);
    }
    // Remove quotes around values for recursive calls to match JSON.stringify structure but sorted
    // Actually, better to just construct the string manually or use JSON.stringify on the sorted object.
    // JSON.stringify respects insertion order for non-integer keys in modern JS engines.
    const sortedObj = {};
    keys.forEach(key => {
        // Recursive sort
        if (typeof obj[key] === 'object' && obj[key] !== null) {
            sortedObj[key] = JSON.parse(canonicalJsonStringify(obj[key])); // Hacky but ensures order
        } else {
            sortedObj[key] = obj[key];
        }
    });
    return JSON.stringify(sortedObj);
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
            console.log("ℹ️ Veri*Factu OFF o no configurado");
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
        const hashAnterior = await obtenerHashAnterior(empresaId);

        const nuevoHash = generarHashVerifactu(
            factura,
            emisor.nif,
            fechaGeneracion,
            hashAnterior
        );

        // Guardar registro
        await tx`
      INSERT INTO registroverifactu_180 (
        factura_id, numero_factura, fecha_factura, total_factura,
        hash_actual, hash_anterior, fecha_registro, estado_envio, empresa_id
      ) VALUES (
        ${factura.id},
        ${factura.numero},
        ${factura.fecha},
        ${factura.total},
        ${nuevoHash},
        ${hashAnterior},
        ${fechaGeneracion},
        'PENDIENTE',
        ${empresaId}
      )
    `;

        // Actualizar factura con hash
        await tx`
      UPDATE factura_180
      SET verifactu_hash = ${nuevoHash},
          verifactu_fecha_generacion = ${fechaGeneracion}
      WHERE id = ${factura.id}
    `;

        // TODO: Enviar a AEAT (usando verifactu_envio logic)
        // Por ahora solo generamos el hash encadenado.

        console.log(`✅ Veri*Factu: Registro generado para factura ${factura.numero}`);

    } catch (error) {
        console.error("❌ Error en verificarVerifactu:", error);
        // En un sistema fiscal estricto, esto debería fallar la transacción.
        throw error;
    }
}
