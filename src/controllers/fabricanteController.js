import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import { sql } from "../db.js";
import { config } from "../config.js";
import { ensureSelfEmployee } from "../services/ensureSelfEmployee.js";
import { seedKnowledge } from "../services/knowledgeSeedService.js";

const FABRICANTE_EMAIL = process.env.FABRICANTE_EMAIL || "susanaybenjamin@gmail.com";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://contendo.es";

// Cache fabricante user/empresa ID en memoria
let _fabricanteUserId = null;
let _fabricanteEmpresaId = null;

async function getFabricanteUserId() {
    if (_fabricanteUserId) return _fabricanteUserId;
    const [user] = await sql`
        SELECT id FROM users_180 WHERE email = ${FABRICANTE_EMAIL} LIMIT 1
    `;
    if (user) _fabricanteUserId = user.id;
    return _fabricanteUserId;
}

async function getFabricanteEmpresaId() {
    if (_fabricanteEmpresaId) return _fabricanteEmpresaId;
    const fabricanteUserId = await getFabricanteUserId();
    if (!fabricanteUserId) return null;
    const [row] = await sql`
        SELECT id FROM empresa_180 WHERE user_id = ${fabricanteUserId} LIMIT 1
    `;
    if (row) _fabricanteEmpresaId = row.id;
    return _fabricanteEmpresaId;
}

function isFabricante(userId, fabricanteId) {
    return userId && fabricanteId && userId === fabricanteId;
}

/**
 * Envia notificacion al fabricante cuando hay un error en el flujo VIP
 */
async function notificarFabricante(titulo, detalles, tipo = 'VIP_LOG') {
    try {
        const empresaId = await getFabricanteEmpresaId();
        if (!empresaId) return;
        await sql`
            INSERT INTO notificaciones_180 (empresa_id, tipo, titulo, mensaje, leida, metadata)
            VALUES (
                ${empresaId},
                ${tipo},
                ${titulo},
                ${detalles},
                false,
                ${JSON.stringify({ timestamp: new Date().toISOString(), source: 'fabricante_vip' })}
            )
        `;
    } catch (e) {
        console.error("Error creando notificacion VIP:", e);
    }
}

// =============================================
// 1. Crear sesion QR (publico)
// POST /api/public/qr-session
// =============================================
export async function createQRSession(req, res) {
    try {
        const sessionToken = crypto.randomBytes(32).toString("hex");
        const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
        const ua = req.headers["user-agent"] || "";

        const [session] = await sql`
            INSERT INTO qr_sessions_180 (session_token, ip_address, user_agent, expires_at)
            VALUES (${sessionToken}, ${ip}, ${ua}, NOW() + INTERVAL '30 minutes')
            RETURNING id, session_token, expires_at
        `;

        const qrUrl = `${FRONTEND_URL}/qr/${sessionToken}`;
        const qrDataUrl = await QRCode.toDataURL(qrUrl, {
            width: 300,
            margin: 2,
            color: { dark: "#1e293b", light: "#ffffff" },
        });

        res.json({
            success: true,
            session_token: session.session_token,
            qr_data_url: qrDataUrl,
            qr_url: qrUrl,
            expires_at: session.expires_at,
        });
    } catch (error) {
        console.error("Error createQRSession:", error);
        res.status(500).json({ success: false, error: "Error creando sesion QR" });
    }
}

// =============================================
// 2. Polling status sesion QR (publico)
// GET /api/public/qr-session/:token/status
// =============================================
export async function getQRSessionStatus(req, res) {
    try {
        const { token } = req.params;

        const [session] = await sql`
            SELECT status, activated_at, expires_at
            FROM qr_sessions_180
            WHERE session_token = ${token}
            LIMIT 1
        `;

        if (!session) {
            return res.status(404).json({ status: "not_found" });
        }

        if (session.status === "pending" && new Date(session.expires_at) < new Date()) {
            return res.json({ status: "expired" });
        }

        res.json({
            status: session.status,
            activated_at: session.activated_at,
        });
    } catch (error) {
        console.error("Error getQRSessionStatus:", error);
        res.status(500).json({ status: "error" });
    }
}

// =============================================
// 3. Fabricante activa sesion VIP (protegido)
// POST /api/admin/fabricante/activate-qr
// =============================================
export async function activateQRSession(req, res) {
    try {
        const userId = req.user.id;
        const fabricanteId = await getFabricanteUserId();

        if (!isFabricante(userId, fabricanteId)) {
            return res.status(403).json({ error: "No autorizado. Solo el fabricante." });
        }

        const { session_token } = req.body;
        if (!session_token) {
            return res.status(400).json({ error: "Falta session_token" });
        }

        const [session] = await sql`
            SELECT id, status, expires_at
            FROM qr_sessions_180
            WHERE session_token = ${session_token}
            LIMIT 1
        `;

        if (!session) {
            return res.status(404).json({ error: "Sesion QR no encontrada" });
        }
        if (session.status !== "pending") {
            return res.status(409).json({ error: "Sesion ya activada o registrada" });
        }
        if (new Date(session.expires_at) < new Date()) {
            return res.status(410).json({ error: "Sesion expirada" });
        }

        await sql`
            UPDATE qr_sessions_180
            SET status = 'activated',
                activated_by = ${userId},
                activated_at = NOW()
            WHERE id = ${session.id}
        `;

        res.json({ success: true, message: "Sesion VIP activada correctamente" });
    } catch (error) {
        console.error("Error activateQRSession:", error);
        await notificarFabricante(
            "Error al activar sesion QR",
            `Error interno al activar QR: ${error.message}`
        );
        res.status(500).json({ success: false, error: "Error activando sesion" });
    }
}

// =============================================
// 4. Registro VIP via QR (publico)
// POST /api/public/qr-vip-register
// =============================================
export async function registerVipUser(req, res) {
    try {
        const { email, password, nombre, empresa_nombre, session_token } = req.body;

        if (!email || !password || !nombre || !empresa_nombre || !session_token) {
            return res.status(400).json({ error: "Todos los campos son obligatorios" });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: "La contrasena debe tener al menos 6 caracteres" });
        }

        // Validar sesion activada
        const [session] = await sql`
            SELECT id, status FROM qr_sessions_180
            WHERE session_token = ${session_token} AND status = 'activated'
            LIMIT 1
        `;

        if (!session) {
            await notificarFabricante(
                "Registro VIP fallido - Sesion invalida",
                `Email: ${email}, Nombre: ${nombre}. La sesion QR no estaba activada o ya fue usada.`
            );
            return res.status(400).json({ error: "Sesion VIP invalida o no activada" });
        }

        // Verificar email duplicado
        const [existing] = await sql`
            SELECT id FROM users_180 WHERE email = ${email} LIMIT 1
        `;
        if (existing) {
            await notificarFabricante(
                "Registro VIP fallido - Email duplicado",
                `El email ${email} ya tiene cuenta. Nombre: ${nombre}, Empresa: ${empresa_nombre}`
            );
            return res.status(409).json({ error: "Ya existe una cuenta con este email" });
        }

        const hash = await bcrypt.hash(password, 10);

        // Obtener plan gratis
        const [planGratis] = await sql`
            SELECT id FROM plans_180 WHERE nombre = 'gratis' LIMIT 1
        `;

        // Crear usuario admin
        const [user] = await sql`
            INSERT INTO users_180 (email, password, nombre, role, password_forced)
            VALUES (${email}, ${hash}, ${nombre}, 'admin', false)
            RETURNING id, email, nombre, role
        `;

        // Crear empresa con qr_vip = true
        const [empresa] = await sql`
            INSERT INTO empresa_180 (user_id, nombre, plan_id, qr_vip, qr_vip_granted_at)
            VALUES (${user.id}, ${empresa_nombre}, ${planGratis?.id || null}, true, NOW())
            RETURNING id
        `;

        // Config con TODOS los modulos activados
        const allModulos = {
            clientes: true,
            fichajes: true,
            calendario: true,
            calendario_import: true,
            worklogs: true,
            empleados: true,
            facturacion: true,
            pagos: true,
            fiscal: true,
        };

        await sql`
            INSERT INTO empresa_config_180 (empresa_id, modulos, ai_tokens, ai_limite_diario, ai_limite_mensual, ai_creditos_extra)
            VALUES (${empresa.id}, ${sql.json(allModulos)}, 1000, 0, 0, 0)
        `;

        // Inicializar base de conocimiento
        await seedKnowledge(empresa.id);

        // Crear empleado para el admin
        const empleadoId = await ensureSelfEmployee({
            userId: user.id,
            empresaId: empresa.id,
            nombre: user.nombre,
        });

        // Marcar sesion como registrada
        await sql`
            UPDATE qr_sessions_180
            SET status = 'registered',
                registered_user_id = ${user.id},
                registered_at = NOW()
            WHERE id = ${session.id}
        `;

        // Generar JWT
        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                role: user.role,
                nombre: user.nombre,
                empresa_id: empresa.id,
                empleado_id: empleadoId,
                modulos: allModulos,
                password_forced: false,
            },
            config.jwtSecret,
            { expiresIn: "10h" }
        );

        // Notificar al fabricante del registro exitoso
        await notificarFabricante(
            "Nuevo usuario VIP registrado",
            `${nombre} (${email}) ha creado su cuenta VIP con empresa "${empresa_nombre}".`
        ).catch(() => {});

        res.status(201).json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                nombre: user.nombre,
                role: user.role,
                empresa_id: empresa.id,
                empleado_id: empleadoId,
                modulos: allModulos,
                password_forced: false,
            },
            is_new_user: true,
            is_vip: true,
        });
    } catch (error) {
        console.error("Error registerVipUser:", error);
        const { email, nombre, empresa_nombre } = req.body || {};
        await notificarFabricante(
            "Error critico al crear cuenta VIP",
            `Error: ${error.message}. Email: ${email || '?'}, Nombre: ${nombre || '?'}, Empresa: ${empresa_nombre || '?'}`
        );
        res.status(500).json({ success: false, error: "Error al crear la cuenta VIP" });
    }
}

// =============================================
// 5. Historial activaciones (protegido)
// GET /api/admin/fabricante/activations
// =============================================
export async function getRecentActivations(req, res) {
    try {
        const userId = req.user.id;
        const fabricanteId = await getFabricanteUserId();

        if (!isFabricante(userId, fabricanteId)) {
            return res.status(403).json({ error: "No autorizado" });
        }

        const activations = await sql`
            SELECT qs.session_token, qs.status, qs.created_at, qs.activated_at,
                   qs.registered_at, u.email as registered_email, u.nombre as registered_nombre
            FROM qr_sessions_180 qs
            LEFT JOIN users_180 u ON u.id = qs.registered_user_id
            WHERE qs.activated_by = ${userId}
            ORDER BY qs.created_at DESC
            LIMIT 50
        `;

        res.json({ success: true, data: activations });
    } catch (error) {
        console.error("Error getRecentActivations:", error);
        res.status(500).json({ success: false, error: "Error obteniendo activaciones" });
    }
}
