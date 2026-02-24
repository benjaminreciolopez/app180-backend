import { sql } from "../db.js";
import { crearNotificacionSistema } from "./notificacionesController.js";

const FABRICANTE_EMAIL = process.env.FABRICANTE_EMAIL || "susanaybenjamin@gmail.com";

// Cache fabricante empresa_id
let _fabricanteEmpresaId = null;

async function getFabricanteEmpresaId() {
    if (_fabricanteEmpresaId) return _fabricanteEmpresaId;
    const [row] = await sql`
        SELECT e.id FROM empresa_180 e
        JOIN users_180 u ON u.id = e.user_id
        WHERE u.email = ${FABRICANTE_EMAIL}
        LIMIT 1
    `;
    if (row) _fabricanteEmpresaId = row.id;
    return _fabricanteEmpresaId;
}

let _fabricanteUserId = null;

async function getFabricanteUserId() {
    if (_fabricanteUserId) return _fabricanteUserId;
    const [user] = await sql`
        SELECT id FROM users_180 WHERE email = ${FABRICANTE_EMAIL} LIMIT 1
    `;
    if (user) _fabricanteUserId = user.id;
    return _fabricanteUserId;
}

function isFabricante(userId, fabricanteId) {
    return userId && fabricanteId && userId === fabricanteId;
}

// =============================================
// 1. Crear sugerencia (admin usuario)
// POST /admin/sugerencias
// =============================================
export async function crearSugerencia(req, res) {
    try {
        const empresaId = req.user.empresa_id;
        const userId = req.user.id;
        const { titulo, descripcion, categoria = "general" } = req.body;

        if (!titulo || !descripcion) {
            return res.status(400).json({ error: "Titulo y descripcion son obligatorios" });
        }

        const [sugerencia] = await sql`
            INSERT INTO sugerencias_180 (empresa_id, user_id, titulo, descripcion, categoria)
            VALUES (${empresaId}, ${userId}, ${titulo}, ${descripcion}, ${categoria})
            RETURNING *
        `;

        // Notificar al fabricante
        const fabricanteEmpresaId = await getFabricanteEmpresaId();
        if (fabricanteEmpresaId) {
            const [empresa] = await sql`SELECT nombre FROM empresa_180 WHERE id = ${empresaId} LIMIT 1`;
            await crearNotificacionSistema({
                empresaId: fabricanteEmpresaId,
                tipo: "info",
                titulo: "Nueva sugerencia",
                mensaje: `${req.user.nombre || "Usuario"} (${empresa?.nombre || "Empresa"}): ${titulo}`,
                accionUrl: "/admin/fabricante",
                accionLabel: "Ver sugerencias",
            });
        }

        res.status(201).json({ success: true, sugerencia });
    } catch (error) {
        console.error("Error crearSugerencia:", error);
        res.status(500).json({ error: "Error creando sugerencia" });
    }
}

// =============================================
// 2. Listar sugerencias de mi empresa
// GET /admin/sugerencias
// =============================================
export async function getSugerencias(req, res) {
    try {
        const empresaId = req.user.empresa_id;

        const sugerencias = await sql`
            SELECT s.*, u.nombre as user_nombre, u.email as user_email
            FROM sugerencias_180 s
            JOIN users_180 u ON u.id = s.user_id
            WHERE s.empresa_id = ${empresaId}
            ORDER BY s.created_at DESC
            LIMIT 50
        `;

        res.json({ success: true, data: sugerencias });
    } catch (error) {
        console.error("Error getSugerencias:", error);
        res.status(500).json({ error: "Error obteniendo sugerencias" });
    }
}

// =============================================
// 3. Fabricante: ver TODAS las sugerencias
// GET /api/admin/fabricante/sugerencias
// =============================================
export async function getAllSugerencias(req, res) {
    try {
        const userId = req.user.id;
        const fabricanteId = await getFabricanteUserId();

        if (!isFabricante(userId, fabricanteId)) {
            return res.status(403).json({ error: "No autorizado" });
        }

        const sugerencias = await sql`
            SELECT s.*, u.nombre as user_nombre, u.email as user_email,
                   e.nombre as empresa_nombre
            FROM sugerencias_180 s
            JOIN users_180 u ON u.id = s.user_id
            JOIN empresa_180 e ON e.id = s.empresa_id
            ORDER BY
                CASE s.estado WHEN 'nueva' THEN 0 WHEN 'leida' THEN 1 ELSE 2 END,
                s.created_at DESC
            LIMIT 100
        `;

        res.json({ success: true, data: sugerencias });
    } catch (error) {
        console.error("Error getAllSugerencias:", error);
        res.status(500).json({ error: "Error obteniendo sugerencias" });
    }
}

// =============================================
// 4. Fabricante: responder sugerencia
// PUT /api/admin/fabricante/sugerencias/:id/responder
// =============================================
export async function responderSugerencia(req, res) {
    try {
        const userId = req.user.id;
        const fabricanteId = await getFabricanteUserId();

        if (!isFabricante(userId, fabricanteId)) {
            return res.status(403).json({ error: "No autorizado" });
        }

        const { id } = req.params;
        const { respuesta } = req.body;

        if (!respuesta) {
            return res.status(400).json({ error: "Falta respuesta" });
        }

        const [sugerencia] = await sql`
            UPDATE sugerencias_180
            SET respuesta = ${respuesta},
                estado = 'respondida',
                respondida_at = NOW()
            WHERE id = ${id}
            RETURNING *
        `;

        if (!sugerencia) {
            return res.status(404).json({ error: "Sugerencia no encontrada" });
        }

        // Notificar al usuario que envio la sugerencia
        await crearNotificacionSistema({
            empresaId: sugerencia.empresa_id,
            userId: sugerencia.user_id,
            tipo: "success",
            titulo: "Respuesta a tu sugerencia",
            mensaje: `"${sugerencia.titulo}" - ${respuesta}`,
            accionUrl: "/admin/sugerencias",
            accionLabel: "Ver",
        });

        res.json({ success: true, sugerencia });
    } catch (error) {
        console.error("Error responderSugerencia:", error);
        res.status(500).json({ error: "Error respondiendo sugerencia" });
    }
}
