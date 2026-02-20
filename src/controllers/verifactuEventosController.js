import { sql } from '../db.js';
import crypto from 'crypto';

/**
 * Registra un evento de auditoría técnica Veri*Factu
 * @param {object} params - { empresaId, userId, tipoEvento, descripcion, metaData }
 */
export async function registrarEventoVerifactu({ empresaId, userId, tipoEvento, tipo_evento, descripcion, metaData = {} }) {
    try {
        const evType = tipoEvento || tipo_evento;
        if (!empresaId) throw new Error("empresaId es obligatorio para registrar evento Veri*Factu");
        if (!evType) throw new Error("tipoEvento es obligatorio para registrar evento Veri*Factu");

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
            tipo_evento: evType,
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
                ${empresaId}, ${userId || null}, ${evType}, ${descripcion || ""},
                ${fechaEvento}, ${hashAnterior}, ${hashActual}, ${sql.json(metaData)}
            )
        `;

        console.log(`🔒 [Veri*Factu Evento] Registrado: ${evType} para empresa ${empresaId}`);

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
            const { limit = 50, offset = 0, fecha_desde, fecha_hasta, tipo_evento, sort = 'desc' } = req.query;

            const query = sql`
                SELECT e.*, u.nombre as user_nombre 
                FROM registroverifactueventos_180 e
                LEFT JOIN users_180 u ON u.id = e.user_id
                WHERE e.empresa_id = ${empresaId}
                ${fecha_desde ? sql`AND e.fecha_evento >= ${fecha_desde}` : sql``}
                ${fecha_hasta ? sql`AND e.fecha_evento <= ${fecha_hasta}` : sql``}
                ${tipo_evento ? sql`AND e.tipo_evento = ${tipo_evento}` : sql``}
                ORDER BY e.fecha_evento ${sort === 'asc' ? sql`ASC` : sql`DESC`}
                LIMIT ${parseInt(limit)}
                OFFSET ${parseInt(offset)}
            `;

            const eventos = await query;

            res.json({ success: true, data: eventos });
        } catch (error) {
            console.error("Error getEventos:", error);
            res.status(500).json({ success: false, error: "Error obteniendo eventos" });
        }
    },

    async exportJSON(req, res) {
        try {
            const empresaId = req.user.empresa_id;
            const { fecha_desde, fecha_hasta, tipo_evento } = req.query;

            const eventos = await sql`
                SELECT e.*, u.nombre as user_nombre 
                FROM registroverifactueventos_180 e
                LEFT JOIN users_180 u ON u.id = e.user_id
                WHERE e.empresa_id = ${empresaId}
                ${fecha_desde ? sql`AND e.fecha_evento >= ${fecha_desde}` : sql``}
                ${fecha_hasta ? sql`AND e.fecha_evento <= ${fecha_hasta}` : sql``}
                ${tipo_evento ? sql`AND e.tipo_evento = ${tipo_evento}` : sql``}
                ORDER BY e.fecha_evento ASC
            `;

            res.header("Content-Type", "application/json");
            res.attachment(`auditoria_fiscal_${new Date().toISOString().slice(0, 10)}.json`);
            res.send(JSON.stringify(eventos, null, 2));
        } catch (error) {
            res.status(500).json({ success: false, error: "Error exportando JSON" });
        }
    },

    async exportXML(req, res) {
        try {
            const empresaId = req.user.empresa_id;
            const { fecha_desde, fecha_hasta, tipo_evento } = req.query;

            const eventos = await sql`
                SELECT e.*, u.nombre as user_nombre 
                FROM registroverifactueventos_180 e
                LEFT JOIN users_180 u ON u.id = e.user_id
                WHERE e.empresa_id = ${empresaId}
                ${fecha_desde ? sql`AND e.fecha_evento >= ${fecha_desde}` : sql``}
                ${fecha_hasta ? sql`AND e.fecha_evento <= ${fecha_hasta}` : sql``}
                ${tipo_evento ? sql`AND e.tipo_evento = ${tipo_evento}` : sql``}
                ORDER BY e.fecha_evento ASC
            `;

            // Generación XML simple (Esquema Veri*Factu básico)
            let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
            xml += '<AuditoriaFiscalVerifactu>\n';
            eventos.forEach(ev => {
                xml += '  <Evento>\n';
                xml += `    <ID>${ev.id}</ID>\n`;
                xml += `    <Fecha>${ev.fecha_evento.toISOString()}</Fecha>\n`;
                xml += `    <Tipo>${ev.tipo_evento}</Tipo>\n`;
                xml += `    <Usuario>${ev.user_nombre || 'Sistema'}</Usuario>\n`;
                xml += `    <Descripcion>${ev.descripcion || ''}</Descripcion>\n`;
                xml += `    <HashActual>${ev.hash_actual}</HashActual>\n`;
                xml += `    <HashAnterior>${ev.hash_anterior || ''}</HashAnterior>\n`;
                xml += '  </Evento>\n';
            });
            xml += '</AuditoriaFiscalVerifactu>';

            res.header("Content-Type", "application/xml");
            res.attachment(`auditoria_fiscal_${new Date().toISOString().slice(0, 10)}.xml`);
            res.send(xml);
        } catch (error) {
            res.status(500).json({ success: false, error: "Error exportando XML" });
        }
    },

    async registrarEventoManual(req, res) {
        try {
            const { tipoEvento, descripcion, metaData } = req.body;
            const empresaId = req.user.empresa_id;

            if (!tipoEvento) {
                return res.status(400).json({ error: "tipoEvento es obligatorio" });
            }

            // Llamamos a la función interna que ya tiene la lógica de hash encadenado
            await registrarEventoVerifactu({
                empresaId,
                userId: req.user.id,
                tipoEvento,
                descripcion: descripcion || "Evento registrado desde el frontend",
                metaData: metaData || {}
            });

            return res.json({ success: true });
        } catch (error) {
            console.error("❌ Error en registrarEventoManual:", error.message);
            return res.status(500).json({ error: "Error registrando evento" });
        }
    }
};
