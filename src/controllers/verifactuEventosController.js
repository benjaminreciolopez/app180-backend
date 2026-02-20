import { sql } from '../db.js';
import crypto from 'crypto';

/**
 * Registra un evento de auditoría técnica Veri*Factu
 * @param {object} params - { empresaId, userId, tipoEvento, descripcion, metaData }
 */
export async function registrarEventoVerifactu({ empresaId, userId, tipoEvento, descripcion, metaData = {} }) {
    try {
        if (!empresaId) throw new Error("empresaId es obligatorio para registrar evento Veri*Factu");

        // 1. Obtener hash anterior encadenado
        const [ultimo] = await sql`
            SELECT hash_actual FROM registroverifactueventos_180
            WHERE empresa_id = ${empresaId}
            ORDER BY fecha_evento DESC
            LIMIT 1
        `;
        const hashAnterior = ultimo ? ultimo.hash_actual : "";

        // 2. Generar payload canónico para el hash
        const fechaEvento = new Date();
        const payload = {
            tipo_evento: tipoEvento,
            descripcion: descripcion || "",
            fecha: fechaEvento.toISOString(),
            empresa_id: empresaId,
            user_id: userId || null,
            hash_anterior: hashAnterior
        };

        const canonico = JSON.stringify(payload, Object.keys(payload).sort());
        const hashActual = crypto.createHash('sha256').update(canonico, 'utf8').digest('hex');

        // 3. Insertar en BD
        await sql`
            INSERT INTO registroverifactueventos_180 (
                empresa_id, user_id, tipo_evento, descripcion, 
                fecha_evento, hash_anterior, hash_actual, meta_data
            ) VALUES (
                ${empresaId}, ${userId || null}, ${tipoEvento}, ${descripcion || ""},
                ${fechaEvento}, ${hashAnterior}, ${hashActual}, ${sql.json(metaData)}
            )
        `;

        console.log(`🔒 [Veri*Factu Evento] Registrado: ${tipoEvento} para empresa ${empresaId}`);

    } catch (error) {
        console.error("❌ Error en registrarEventoVerifactu:", error.message);
        // No bloqueamos el flujo principal de la app pero logueamos el fallo integral
    }
}

/**
 * Controlador para la API de eventos Veri*Factu
 */
export const verifactuEventosController = {
    async getEventos(req, res) {
        try {
            const empresaId = req.user.empresa_id;
            const { limit = 50, offset = 0 } = req.query;

            const eventos = await sql`
                SELECT e.*, u.nombre as user_nombre 
                FROM registroverifactueventos_180 e
                LEFT JOIN users_180 u ON u.id = e.user_id
                WHERE e.empresa_id = ${empresaId}
                ORDER BY e.fecha_evento DESC
                LIMIT ${parseInt(limit)}
                OFFSET ${parseInt(offset)}
            `;

            res.json({ success: true, data: eventos });
        } catch (error) {
            res.status(500).json({ success: false, error: "Error obteniendo eventos" });
        }
    },

    async exportXML(req, res) {
        // TODO: Implementar generación XML según esquema AEAT
        res.status(501).json({ success: false, message: "Exportación XML no implementada aún" });
    }
};
