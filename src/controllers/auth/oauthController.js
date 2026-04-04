// backend/src/controllers/auth/oauthController.js
// Google OAuth authentication handlers

import { sql } from "../../db.js";
import { config } from "../../config.js";
import jwt from "jsonwebtoken";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { encrypt } from "../../utils/encryption.js";
import { ensureSelfEmployee } from "../../services/ensureSelfEmployee.js";
import { backupService } from "../../services/backupService.js";
import { seedKnowledge } from "../../services/knowledgeSeedService.js";
import { registrarEventoVerifactu } from "../verifactuEventosController.js";

export const googleAuth = async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ error: "Falta credential de Google" });
    }

    // Verify ID token with Google
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = payload.email;
    const nombre = payload.name || email.split("@")[0];
    const avatarUrl = payload.picture || null;


    // Check if user exists by google_id
    let userRows = await sql`
      SELECT id, email, nombre, role, google_id, password_forced
      FROM users_180
      WHERE google_id = ${googleId}
    `;

    // Also check by email (user might exist with email+password)
    if (userRows.length === 0) {
      userRows = await sql`
        SELECT id, email, nombre, role, google_id, password_forced
        FROM users_180
        WHERE email = ${email}
      `;
    }

    let user;
    let empresaId;
    let isNewUser = false;

    if (userRows.length > 0) {
      // ---- EXISTING USER → LOGIN ----
      user = userRows[0];

      // Update google_id and always sync avatar_url
      await sql`
        UPDATE users_180
        SET google_id = ${googleId}, avatar_url = ${avatarUrl}, updated_at = now()
        WHERE id = ${user.id}
      `;

      // Get empresa
      if (user.role === "admin") {
        const empresaRows = await sql`
          SELECT id FROM empresa_180 WHERE user_id = ${user.id}
        `;
        if (empresaRows.length === 0) {
          return res.status(500).json({ error: "Empresa no encontrada" });
        }
        empresaId = empresaRows[0].id;
      } else {
        const empRows = await sql`
          SELECT empresa_id FROM employees_180 WHERE user_id = ${user.id}
        `;
        empresaId = empRows[0]?.empresa_id;
      }

    } else {
      // ---- NEW USER → Solo via QR VIP ----
      const { vip_session_token, empresa_nombre_vip } = req.body;

      if (!vip_session_token) {
        return res.status(403).json({
          error: "Registro no disponible. Contacta con el creador de Contendo para obtener acceso VIP."
        });
      }

      // Validar sesion VIP activada
      const [vipSession] = await sql`
        SELECT id, status FROM qr_sessions_180
        WHERE session_token = ${vip_session_token} AND status = 'activated'
        LIMIT 1
      `;

      if (!vipSession) {
        return res.status(400).json({
          error: "Sesion VIP invalida o no activada. Pide al fabricante que active tu QR."
        });
      }

      isNewUser = true;

      // Create user (no password - Google-only)
      const newUser = await sql`
        INSERT INTO users_180 (email, nombre, role, google_id, avatar_url, password_forced)
        VALUES (${email}, ${nombre}, 'admin', ${googleId}, ${avatarUrl}, false)
        RETURNING id, email, nombre, role
      `;

      user = newUser[0];

      // Obtener plan gratis
      const [planGratis] = await sql`
        SELECT id FROM plans_180 WHERE nombre = 'gratis' LIMIT 1
      `;

      // Create empresa VIP con todos los modulos
      const empresaNombre = empresa_nombre_vip || nombre;

      const empresa = await sql`
        INSERT INTO empresa_180 (user_id, nombre, plan_id, qr_vip, qr_vip_granted_at)
        VALUES (${user.id}, ${empresaNombre}, ${planGratis?.id || null}, true, NOW())
        RETURNING id
      `;

      empresaId = empresa[0].id;

      // Config VIP: TODOS los modulos activados
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
        VALUES (${empresaId}, ${sql.json(allModulos)}, 1000, 0, 0, 0)
      `;

      // Inicializar Base de Conocimiento
      seedKnowledge(empresaId).catch(err => {
        console.warn("Error seeding knowledge (Google VIP signup):", err.message);
      });

      // Marcar sesion QR como registrada
      await sql`
        UPDATE qr_sessions_180
        SET status = 'registered',
            registered_user_id = ${user.id},
            registered_at = NOW()
        WHERE id = ${vipSession.id}
      `;

    }

    // Load modules
    let modulos = {};
    if (empresaId) {
      const cfg = await sql`
        SELECT modulos, modulos_mobile FROM empresa_config_180
        WHERE empresa_id = ${empresaId} LIMIT 1
      `;
      modulos = cfg[0]?.modulos || {};

      // Si estamos en movil (hay device_hash en body) y existe config movil, usarla
      const device_hash_input = req.body.device_hash;
      if (device_hash_input && cfg[0]?.modulos_mobile) {
        modulos = { ...modulos, ...cfg[0].modulos_mobile };
      }
    }

    // Ensure self employee if module active
    let empleadoId = null;
    if (user.role === "admin" && empresaId && modulos.empleados !== false) {
      empleadoId = await ensureSelfEmployee({
        userId: user.id,
        empresaId,
        nombre: user.nombre,
      });
    }

    // ===================================
    // DEVICE REGISTRATION (Added for Google Login)
    // ===================================
    const device_hash = req.body.device_hash;
    const user_agent = req.body.user_agent;
    const ipActual = req.ip;


    if (empleadoId && device_hash) {
      const deviceRows = await sql`
        SELECT * FROM employee_devices_180 WHERE empleado_id = ${empleadoId}
      `;

      if (deviceRows.length === 0) {
        await sql`
          INSERT INTO employee_devices_180
            (user_id, empleado_id, empresa_id, device_hash, user_agent, activo, ip_habitual)
          VALUES
            (${user.id}, ${empleadoId}, ${empresaId}, ${device_hash},
             ${user_agent || null}, true, ${ipActual})
        `;
      } else {
        const device = deviceRows[0];
        if (device.device_hash !== device_hash) {
          // Si es admin o empleado, actualizamos para permitir cambio de dispositivo en login social
          // (O aplicar misma lógica estricta que login normal si se prefiere)
          await sql`
            UPDATE employee_devices_180
            SET device_hash = ${device_hash},
                user_agent = ${user_agent || device.user_agent},
                ip_habitual = ${ipActual},
                updated_at = now()
            WHERE id = ${device.id}
           `;
        }
      }
    }

    // ===================================
    // TRIGGER BACKUP SILENCIOSO (Google Auth)
    // ===================================
    if (user.role === "admin" && empresaId) {
      // No esperamos a que termine
      backupService.generateBackup(empresaId).catch(err => {
        console.error("Error en backup silencioso (Google Auth):", err.message);
      });

      // 🔒 Registro Veri*Factu: Inicio Sesión Google
      registrarEventoVerifactu({
        empresaId,
        userId: user.id,
        tipoEvento: 'INICIO_SESION',
        descripcion: `Inicio de sesión vía Google: ${user.email}`
      });
    }

    // Generate JWT
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        nombre: user.nombre,
        empresa_id: empresaId,
        empleado_id: empleadoId,
        modulos,
        password_forced: false,
      },
      config.jwtSecret,
      { expiresIn: "4h" }
    );

    const FABRICANTE_EMAIL_CHECK2 = process.env.FABRICANTE_EMAIL || "susanaybenjamin@gmail.com";
    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        role: user.role,
        empresa_id: empresaId,
        empleado_id: empleadoId,
        modulos,
        avatar_url: avatarUrl,
        password_forced: false,
        es_fabricante: user.email === FABRICANTE_EMAIL_CHECK2,
      },
      is_new_user: isNewUser,
    });
  } catch (err) {
    console.error("Error googleAuth:", err);
    return res.status(500).json({ error: "Error con autenticación de Google" });
  }
};

// =====================================================
// COMPLETE SETUP: OAuth2 con scopes Calendar + Gmail
// =====================================================
export const googleCompleteSetup = async (req, res) => {
  try {
    const { empresa_nombre } = req.body;
    const userId = req.user.id;
    const empresaId = req.user.empresa_id;

    // Update empresa name if provided
    if (empresa_nombre) {
      await sql`
        UPDATE empresa_180 SET nombre = ${empresa_nombre}
        WHERE id = ${empresaId}
      `;
    }

    // Generate OAuth2 URL with all scopes (Calendar + Gmail)
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );

    const scopes = [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/calendar",
      "https://mail.google.com/",
    ];

    const state = Buffer.from(
      JSON.stringify({
        userId,
        empresaId,
        type: "complete_setup",
      }),
    ).toString("base64");

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      state,
      prompt: "consent",
    });

    return res.json({ authUrl });
  } catch (err) {
    console.error("Error googleCompleteSetup:", err);
    return res.status(500).json({ error: "Error iniciando setup" });
  }
};

// =====================================================
// UNIFIED CALLBACK: Guarda Calendar + Gmail tokens
// =====================================================
export const handleUnifiedCallback = async (req, res) => {
  try {
    const { code, state, error: authError } = req.query;

    if (authError) {
      return res.send(callbackHTML("error", "Autenticación cancelada"));
    }

    if (!code || !state) {
      return res.status(400).send(callbackHTML("error", "Faltan parámetros"));
    }

    const { userId, empresaId, type } = JSON.parse(
      Buffer.from(state, "base64").toString(),
    );

    // Exchange code for tokens
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      return res.send(
        callbackHTML("error", "No se obtuvo refresh token. Intenta de nuevo."),
      );
    }

    // Get user email
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;

    const encryptedToken = encrypt(tokens.refresh_token);

    if (type === "complete_setup") {
      // Save BOTH Calendar and Gmail config

      // 1. Gmail config
      await sql`
        INSERT INTO empresa_email_config_180 (empresa_id, modo, oauth2_provider, oauth2_email, oauth2_refresh_token, oauth2_connected_at, from_name, from_email)
        VALUES (${empresaId}, 'oauth2', 'gmail', ${email}, ${encryptedToken}, now(), ${email.split("@")[0]}, ${email})
        ON CONFLICT (empresa_id) DO UPDATE SET
          modo = 'oauth2',
          oauth2_provider = 'gmail',
          oauth2_email = ${email},
          oauth2_refresh_token = ${encryptedToken},
          oauth2_connected_at = now(),
          from_email = ${email},
          updated_at = now()
      `;

      // 2. Calendar config
      await sql`
        INSERT INTO empresa_calendar_config_180 (empresa_id, oauth2_provider, oauth2_email, oauth2_refresh_token, oauth2_connected_at, sync_enabled)
        VALUES (${empresaId}, 'google', ${email}, ${encryptedToken}, now(), true)
        ON CONFLICT (empresa_id) DO UPDATE SET
          oauth2_email = ${email},
          oauth2_refresh_token = ${encryptedToken},
          oauth2_connected_at = now(),
          sync_enabled = true,
          updated_at = now()
      `;

    } else if (type === "calendar") {
      // Only Calendar
      await sql`
        INSERT INTO empresa_calendar_config_180 (empresa_id, oauth2_provider, oauth2_email, oauth2_refresh_token, oauth2_connected_at, sync_enabled)
        VALUES (${empresaId}, 'google', ${email}, ${encryptedToken}, now(), true)
        ON CONFLICT (empresa_id) DO UPDATE SET
          oauth2_email = ${email},
          oauth2_refresh_token = ${encryptedToken},
          oauth2_connected_at = now(),
          sync_enabled = true,
          updated_at = now()
      `;
    } else {
      // Only Gmail (existing flow)
      await sql`
        INSERT INTO empresa_email_config_180 (empresa_id, modo, oauth2_provider, oauth2_email, oauth2_refresh_token, oauth2_connected_at, from_name, from_email)
        VALUES (${empresaId}, 'oauth2', 'gmail', ${email}, ${encryptedToken}, now(), ${email.split("@")[0]}, ${email})
        ON CONFLICT (empresa_id) DO UPDATE SET
          modo = 'oauth2',
          oauth2_provider = 'gmail',
          oauth2_email = ${email},
          oauth2_refresh_token = ${encryptedToken},
          oauth2_connected_at = now(),
          from_email = ${email},
          updated_at = now()
      `;
    }

    return res.send(callbackHTML("success", "Servicios configurados correctamente"));
  } catch (err) {
    console.error("Error handleUnifiedCallback:", err);
    return res.status(500).send(callbackHTML("error", err.message));
  }
};


