// backend/src/controllers/asesoriaInvitacionController.js
// Invitation and connection flow between asesorias and clients
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sql } from "../db.js";
import { config } from "../config.js";
import { crearNotificacionSistema } from "./notificacionesController.js";
import { crearNotificacionAsesor } from "./asesorNotificacionesController.js";

// ============================================================
// DEFAULT PERMISSIONS: all read=true, all write=false
// ============================================================
const DEFAULT_PERMISOS = {
  facturas: { read: true, write: false },
  gastos: { read: true, write: false },
  clientes: { read: true, write: false },
  empleados: { read: true, write: false },
  nominas: { read: true, write: false },
  fiscal: { read: true, write: false },
  contabilidad: { read: true, write: false },
  configuracion: { read: true, write: false },
};

/**
 * POST /admin/asesoria/invitar
 * Client (admin) invites an asesoria by email
 */
export async function invitarAsesoriaDesdeCliente(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { email } = req.body;

    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email de la asesoría requerido" });
    }

    // Look up asesoria by email_contacto
    const asesorias = await sql`
      SELECT id, nombre, email_contacto
      FROM asesorias_180
      WHERE email_contacto = ${email.trim().toLowerCase()}
      LIMIT 1
    `;

    if (asesorias.length === 0) {
      return res.status(404).json({
        error: "Asesoría no registrada. Verifica el email o pide a tu asesor que se registre en la plataforma.",
      });
    }

    const asesoria = asesorias[0];

    // Check if there's already an active or pending link
    const existing = await sql`
      SELECT id, estado
      FROM asesoria_clientes_180
      WHERE asesoria_id = ${asesoria.id}
        AND empresa_id = ${empresaId}
        AND estado IN ('activo', 'pendiente')
      LIMIT 1
    `;

    if (existing.length > 0) {
      if (existing[0].estado === "activo") {
        return res.status(409).json({ error: "Ya tienes un vínculo activo con esta asesoría" });
      }
      return res.status(409).json({ error: "Ya existe una invitación pendiente con esta asesoría" });
    }

    // Create vinculo with estado='pendiente'
    const [vinculo] = await sql`
      INSERT INTO asesoria_clientes_180 (
        asesoria_id,
        empresa_id,
        estado,
        invitado_por,
        permisos,
        created_at
      )
      VALUES (
        ${asesoria.id},
        ${empresaId},
        'pendiente',
        'empresa',
        ${sql.json(DEFAULT_PERMISOS)},
        now()
      )
      RETURNING id, estado, created_at
    `;

    // Notificar a todos los usuarios de la asesoría (tabla notificaciones_asesor_180)
    const empresaNombre = req.user.nombre || "Una empresa";
    const asesorUsers = await sql`
      SELECT user_id FROM asesoria_usuarios_180
      WHERE asesoria_id = ${asesoria.id} AND activo = true
    `;
    for (const au of asesorUsers) {
      await sql`
        INSERT INTO notificaciones_asesor_180 (
          asesoria_id, user_id, empresa_id, tipo, titulo, mensaje, leida, accion_url, accion_label, metadata
        ) VALUES (
          ${asesoria.id},
          ${au.user_id},
          ${empresaId},
          'invitacion_cliente',
          ${"Nueva solicitud de cliente"},
          ${`${empresaNombre} quiere vincularse con tu asesoría`},
          false,
          '/asesor/clientes',
          'Ver solicitud',
          ${sql.json({ vinculo_id: vinculo.id, empresa_id: empresaId })}::jsonb
        )
      `;
    }

    return res.status(201).json({
      success: true,
      data: {
        vinculo_id: vinculo.id,
        asesoria_nombre: asesoria.nombre,
        asesoria_email: asesoria.email_contacto,
        estado: vinculo.estado,
        created_at: vinculo.created_at,
      },
    });
  } catch (err) {
    console.error("Error invitarAsesoriaDesdeCliente:", err);
    return res.status(500).json({ error: "Error enviando invitación a la asesoría" });
  }
}

/**
 * POST /asesor/clientes/invitar
 * Asesor invites a client (empresa) by email
 */
export async function invitarClienteDesdeAsesor(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    const { empresa_email } = req.body;

    if (!empresa_email || typeof empresa_email !== "string") {
      return res.status(400).json({ error: "Email de la empresa requerido" });
    }

    const emailNorm = empresa_email.trim().toLowerCase();

    // Look up empresa by admin user email or empresa email
    let empresa = null;

    // First try: find admin user with this email and their empresa
    const userRows = await sql`
      SELECT e.id AS empresa_id, e.nombre
      FROM users_180 u
      JOIN empresa_180 e ON e.user_id = u.id
      WHERE u.email = ${emailNorm}
        AND u.role = 'admin'
      LIMIT 1
    `;

    if (userRows.length > 0) {
      empresa = userRows[0];
    }

    if (!empresa) {
      return res.status(404).json({
        error: "No se encontró ninguna empresa con ese email. El administrador debe estar registrado en la plataforma.",
      });
    }

    // Check if there's already an active or pending link
    const existing = await sql`
      SELECT id, estado
      FROM asesoria_clientes_180
      WHERE asesoria_id = ${asesoriaId}
        AND empresa_id = ${empresa.empresa_id}
        AND estado IN ('activo', 'pendiente')
      LIMIT 1
    `;

    if (existing.length > 0) {
      if (existing[0].estado === "activo") {
        return res.status(409).json({ error: "Ya tienes un vínculo activo con esta empresa" });
      }
      return res.status(409).json({ error: "Ya existe una invitación pendiente con esta empresa" });
    }

    // Create vinculo
    const [vinculo] = await sql`
      INSERT INTO asesoria_clientes_180 (
        asesoria_id,
        empresa_id,
        estado,
        invitado_por,
        permisos,
        created_at
      )
      VALUES (
        ${asesoriaId},
        ${empresa.empresa_id},
        'pendiente',
        'asesoria',
        ${sql.json(DEFAULT_PERMISOS)},
        now()
      )
      RETURNING id, estado, created_at
    `;

    // Notificar al admin de la empresa
    const asesoriaNombre = req.user.asesoria_nombre || "Una asesoría";
    await crearNotificacionSistema({
      empresaId: empresa.empresa_id,
      tipo: "invitacion_asesoria",
      titulo: "Nueva solicitud de asesoría",
      mensaje: `${asesoriaNombre} quiere vincularse con tu empresa`,
      accionUrl: "/admin/mi-asesoria",
      accionLabel: "Ver solicitud",
      metadata: { vinculo_id: vinculo.id, asesoria_id: asesoriaId },
    });

    return res.status(201).json({
      success: true,
      data: {
        vinculo_id: vinculo.id,
        empresa_nombre: empresa.nombre,
        estado: vinculo.estado,
        created_at: vinculo.created_at,
      },
    });
  } catch (err) {
    console.error("Error invitarClienteDesdeAsesor:", err);
    return res.status(500).json({ error: "Error enviando invitación al cliente" });
  }
}

/**
 * PUT /asesor/clientes/aceptar/:id
 * Asesor accepts a pending vinculo (invited by empresa)
 */
export async function aceptarVinculoDesdeAsesor(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    const vinculoId = req.params.id;

    const [updated] = await sql`
      UPDATE asesoria_clientes_180
      SET estado = 'activo',
          connected_at = now()
      WHERE id = ${vinculoId}
        AND asesoria_id = ${asesoriaId}
        AND estado = 'pendiente'
      RETURNING id, empresa_id, estado, connected_at
    `;

    if (!updated) {
      return res.status(404).json({ error: "Vínculo pendiente no encontrado" });
    }

    // Get empresa name for response
    const [empresa] = await sql`
      SELECT nombre FROM empresa_180 WHERE id = ${updated.empresa_id}
    `;

    // Mark related notification as read
    await sql`
      UPDATE notificaciones_asesor_180
      SET leida = TRUE, leida_at = NOW()
      WHERE asesoria_id = ${asesoriaId}
        AND tipo = 'invitacion_cliente'
        AND leida = FALSE
        AND metadata->>'vinculo_id' = ${vinculoId}
    `;

    // Notificar a la empresa que la asesoría aceptó
    const asesoriaNombre = req.user.asesoria_nombre || "Tu asesoría";
    await crearNotificacionSistema({
      empresaId: updated.empresa_id,
      tipo: "vinculo_aceptado",
      titulo: "Solicitud aceptada",
      mensaje: `${asesoriaNombre} ha aceptado tu solicitud de vinculación`,
      accionUrl: "/admin/mi-asesoria",
      accionLabel: "Ver vínculo",
      metadata: { vinculo_id: updated.id, asesoria_id: asesoriaId },
    });

    return res.json({
      success: true,
      data: {
        vinculo_id: updated.id,
        estado: updated.estado,
        connected_at: updated.connected_at,
        empresa_nombre: empresa?.nombre || null,
      },
    });
  } catch (err) {
    console.error("Error aceptarVinculoDesdeAsesor:", err);
    return res.status(500).json({ error: "Error aceptando vínculo" });
  }
}

/**
 * PUT /asesor/clientes/rechazar/:id
 * Asesor rejects a pending vinculo
 */
export async function rechazarVinculoDesdeAsesor(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    const vinculoId = req.params.id;

    const [updated] = await sql`
      UPDATE asesoria_clientes_180
      SET estado = 'rechazado'
      WHERE id = ${vinculoId}
        AND asesoria_id = ${asesoriaId}
        AND estado = 'pendiente'
      RETURNING id, estado
    `;

    if (!updated) {
      return res.status(404).json({ error: "Vínculo pendiente no encontrado" });
    }

    // Mark related notification as read
    await sql`
      UPDATE notificaciones_asesor_180
      SET leida = TRUE, leida_at = NOW()
      WHERE asesoria_id = ${asesoriaId}
        AND tipo = 'invitacion_cliente'
        AND leida = FALSE
        AND metadata->>'vinculo_id' = ${vinculoId}
    `;

    // Notificar a la empresa que la asesoría rechazó — necesitamos empresa_id
    const [vinculoData] = await sql`
      SELECT empresa_id FROM asesoria_clientes_180 WHERE id = ${vinculoId}
    `;
    if (vinculoData) {
      const asesoriaNombre = req.user.asesoria_nombre || "La asesoría";
      await crearNotificacionSistema({
        empresaId: vinculoData.empresa_id,
        tipo: "vinculo_rechazado",
        titulo: "Solicitud rechazada",
        mensaje: `${asesoriaNombre} ha rechazado tu solicitud de vinculación`,
        accionUrl: "/admin/mi-asesoria",
        accionLabel: "Ver detalle",
        metadata: { vinculo_id: parseInt(vinculoId), asesoria_id: asesoriaId },
      });
    }

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("Error rechazarVinculoDesdeAsesor:", err);
    return res.status(500).json({ error: "Error rechazando vínculo" });
  }
}

/**
 * PUT /admin/asesoria/aceptar/:id
 * Admin (empresa) accepts a pending vinculo
 */
export async function aceptarVinculo(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const vinculoId = req.params.id;

    const [updated] = await sql`
      UPDATE asesoria_clientes_180
      SET estado = 'activo',
          connected_at = now()
      WHERE id = ${vinculoId}
        AND empresa_id = ${empresaId}
        AND estado = 'pendiente'
      RETURNING id, asesoria_id, estado, connected_at
    `;

    if (!updated) {
      return res.status(404).json({ error: "Vínculo pendiente no encontrado" });
    }

    // Get asesoria name for response
    const [asesoria] = await sql`
      SELECT nombre FROM asesorias_180 WHERE id = ${updated.asesoria_id}
    `;

    // Notificar a todos los usuarios de la asesoría
    const empresaNombre = req.user.nombre || "Una empresa";
    const asesorUsers = await sql`
      SELECT user_id FROM asesoria_usuarios_180
      WHERE asesoria_id = ${updated.asesoria_id} AND activo = true
    `;
    for (const au of asesorUsers) {
      await crearNotificacionAsesor({
        asesoriaId: updated.asesoria_id,
        userId: au.user_id,
        empresaId: empresaId,
        tipo: "vinculo_aceptado",
        titulo: "Invitación aceptada",
        mensaje: `${empresaNombre} ha aceptado tu invitación de vinculación`,
        accionUrl: "/asesor/clientes",
        accionLabel: "Ver cliente",
        metadata: { vinculo_id: updated.id, empresa_id: empresaId },
      });
    }

    return res.json({
      success: true,
      data: {
        vinculo_id: updated.id,
        estado: updated.estado,
        connected_at: updated.connected_at,
        asesoria_nombre: asesoria?.nombre || null,
      },
    });
  } catch (err) {
    console.error("Error aceptarVinculo:", err);
    return res.status(500).json({ error: "Error aceptando vínculo" });
  }
}

/**
 * PUT /admin/asesoria/rechazar/:id
 * Admin (empresa) rejects a pending vinculo
 */
export async function rechazarVinculo(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const vinculoId = req.params.id;

    const [updated] = await sql`
      UPDATE asesoria_clientes_180
      SET estado = 'rechazado'
      WHERE id = ${vinculoId}
        AND empresa_id = ${empresaId}
        AND estado = 'pendiente'
      RETURNING id, estado
    `;

    if (!updated) {
      return res.status(404).json({ error: "Vínculo pendiente no encontrado" });
    }

    // Notificar a la asesoría que la empresa rechazó
    const [vinculoInfo] = await sql`
      SELECT asesoria_id FROM asesoria_clientes_180 WHERE id = ${vinculoId}
    `;
    if (vinculoInfo) {
      const empresaNombre = req.user.nombre || "Una empresa";
      const asesorUsers = await sql`
        SELECT user_id FROM asesoria_usuarios_180
        WHERE asesoria_id = ${vinculoInfo.asesoria_id} AND activo = true
      `;
      for (const au of asesorUsers) {
        await crearNotificacionAsesor({
          asesoriaId: vinculoInfo.asesoria_id,
          userId: au.user_id,
          empresaId: empresaId,
          tipo: "vinculo_rechazado",
          titulo: "Invitación rechazada",
          mensaje: `${empresaNombre} ha rechazado tu invitación de vinculación`,
          accionUrl: "/asesor/clientes",
          accionLabel: "Ver clientes",
          metadata: { vinculo_id: parseInt(vinculoId), empresa_id: empresaId },
        });
      }
    }

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("Error rechazarVinculo:", err);
    return res.status(500).json({ error: "Error rechazando vínculo" });
  }
}

/**
 * DELETE /admin/asesoria/revocar
 * Admin (empresa) revokes the active vinculo with its asesoria
 */
export async function revocarAcceso(req, res) {
  try {
    const empresaId = req.user.empresa_id;

    const [updated] = await sql`
      UPDATE asesoria_clientes_180
      SET estado = 'revocado'
      WHERE empresa_id = ${empresaId}
        AND estado = 'activo'
      RETURNING id, asesoria_id, estado
    `;

    if (!updated) {
      return res.status(404).json({ error: "No hay vínculo activo para revocar" });
    }

    // Notificar a la asesoría que la empresa revocó el acceso
    const empresaNombre = req.user.nombre || "Una empresa";
    const asesorUsers = await sql`
      SELECT user_id FROM asesoria_usuarios_180
      WHERE asesoria_id = ${updated.asesoria_id} AND activo = true
    `;
    for (const au of asesorUsers) {
      await crearNotificacionAsesor({
        asesoriaId: updated.asesoria_id,
        userId: au.user_id,
        empresaId: empresaId,
        tipo: "vinculo_revocado",
        titulo: "Acceso revocado",
        mensaje: `${empresaNombre} ha revocado el acceso de tu asesoría`,
        accionUrl: "/asesor/clientes",
        accionLabel: "Ver clientes",
        metadata: { vinculo_id: updated.id, empresa_id: empresaId },
      });
    }

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("Error revocarAcceso:", err);
    return res.status(500).json({ error: "Error revocando acceso" });
  }
}

/**
 * PUT /admin/asesoria/permisos
 * Admin (empresa) updates the permissions granted to its asesoria
 */
export async function actualizarPermisos(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { permisos } = req.body;

    if (!permisos || typeof permisos !== "object") {
      return res.status(400).json({ error: "Permisos requeridos (objeto JSON)" });
    }

    const [updated] = await sql`
      UPDATE asesoria_clientes_180
      SET permisos = ${sql.json(permisos)}
      WHERE empresa_id = ${empresaId}
        AND estado = 'activo'
      RETURNING id, permisos
    `;

    if (!updated) {
      return res.status(404).json({ error: "No hay vínculo activo para actualizar permisos" });
    }

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("Error actualizarPermisos:", err);
    return res.status(500).json({ error: "Error actualizando permisos" });
  }
}

/**
 * GET /admin/asesoria/vinculo
 * Get the current active or pending vinculo for the empresa,
 * with asesoria details
 */
export async function getVinculoActual(req, res) {
  try {
    const empresaId = req.user.empresa_id;

    const vinculos = await sql`
      SELECT
        ac.id,
        ac.asesoria_id,
        ac.estado,
        ac.invitado_por,
        ac.permisos,
        ac.connected_at,
        ac.created_at,
        a.nombre AS asesoria_nombre,
        a.cif AS asesoria_cif,
        a.email_contacto AS asesoria_email,
        a.telefono AS asesoria_telefono,
        a.direccion AS asesoria_direccion
      FROM asesoria_clientes_180 ac
      JOIN asesorias_180 a ON a.id = ac.asesoria_id
      WHERE ac.empresa_id = ${empresaId}
        AND ac.estado IN ('activo', 'pendiente')
      ORDER BY
        CASE ac.estado
          WHEN 'activo' THEN 1
          WHEN 'pendiente' THEN 2
        END
      LIMIT 1
    `;

    if (vinculos.length === 0) {
      return res.json({ success: true, data: null });
    }

    return res.json({ success: true, data: vinculos[0] });
  } catch (err) {
    console.error("Error getVinculoActual:", err);
    return res.status(500).json({ error: "Error obteniendo vínculo actual" });
  }
}

/**
 * POST /asesor/registro
 * Public endpoint: register a new asesoria with its first user
 * Creates: user (role='asesor'), asesoria, asesoria_usuarios link
 * Returns JWT token
 */
export async function registrarAsesoria(req, res) {
  try {
    const {
      nombre,
      cif,
      email_contacto,
      telefono,
      direccion,
      user_nombre,
      user_email,
      user_password,
      modulos: modulosInput,
    } = req.body;

    // Default modules for asesoria — todo activado por defecto
    const defaultModulos = {
      empleados: true,
      fichajes: true,
      calendario: true,
      calendario_import: true,
      clientes: true,
      worklogs: true,
      facturacion: true,
      pagos: true,
      fiscal: true,
      contable: true,
    };
    const finalModulos = modulosInput ? { ...defaultModulos, ...modulosInput } : defaultModulos;

    // Validate required fields
    if (!nombre || !email_contacto || !user_nombre || !user_email || !user_password) {
      return res.status(400).json({
        error: "Campos requeridos: nombre, email_contacto, user_nombre, user_email, user_password",
      });
    }

    if (user_password.length < 6) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
    }

    // Check for duplicate user email
    const [existingUser] = await sql`
      SELECT id FROM users_180 WHERE email = ${user_email.trim().toLowerCase()} LIMIT 1
    `;
    if (existingUser) {
      return res.status(409).json({ error: "Ya existe una cuenta con este email" });
    }

    // Check for duplicate asesoria email_contacto
    const [existingAsesoria] = await sql`
      SELECT id FROM asesorias_180 WHERE email_contacto = ${email_contacto.trim().toLowerCase()} LIMIT 1
    `;
    if (existingAsesoria) {
      return res.status(409).json({ error: "Ya existe una asesoría registrada con este email de contacto" });
    }

    const hash = await bcrypt.hash(user_password, 10);

    // Use a transaction to create everything atomically
    const result = await sql.begin(async (tx) => {
      // 1. Create user with role='asesor'
      const [user] = await tx`
        INSERT INTO users_180 (
          email,
          password,
          nombre,
          role,
          password_forced
        )
        VALUES (
          ${user_email.trim().toLowerCase()},
          ${hash},
          ${user_nombre.trim()},
          'asesor',
          false
        )
        RETURNING id, email, nombre, role
      `;

      // 2. Create asesoria
      const [asesoria] = await tx`
        INSERT INTO asesorias_180 (
          nombre,
          cif,
          email_contacto,
          telefono,
          direccion,
          modulos,
          created_at
        )
        VALUES (
          ${nombre.trim()},
          ${cif || null},
          ${email_contacto.trim().toLowerCase()},
          ${telefono || null},
          ${direccion || null},
          ${sql.json(finalModulos)},
          now()
        )
        RETURNING id, nombre
      `;

      // 3. Link user to asesoria
      await tx`
        INSERT INTO asesoria_usuarios_180 (
          asesoria_id,
          user_id,
          rol_interno,
          activo,
          created_at
        )
        VALUES (
          ${asesoria.id},
          ${user.id},
          'admin_asesoria',
          true,
          now()
        )
      `;

      // 4. Create empresa_180 for the asesoria's own business operations
      const [empresa] = await tx`
        INSERT INTO empresa_180 (user_id, nombre, activo, plan_status, tipo_contribuyente)
        VALUES (${user.id}, ${nombre.trim()}, true, 'active', 'sociedad')
        RETURNING id
      `;

      // 5. Create empresa_config_180 with same modules
      await tx`
        INSERT INTO empresa_config_180 (empresa_id, modulos)
        VALUES (${empresa.id}, ${sql.json({
          empleados: finalModulos.empleados !== false,
          fichajes: finalModulos.fichajes !== false,
          worklogs: finalModulos.worklogs !== false,
          ausencias: true,
          facturacion: finalModulos.facturacion === true,
          calendario: finalModulos.calendario !== false,
          calendario_import: finalModulos.calendario_import !== false,
          pagos: finalModulos.pagos === true,
          fiscal: finalModulos.fiscal === true,
          contable: finalModulos.contable === true,
        })})
      `;

      // 6. Link empresa to asesoria
      await tx`
        UPDATE asesorias_180 SET empresa_id = ${empresa.id} WHERE id = ${asesoria.id}
      `;

      return { user, asesoria, empresa };
    });

    // Generate JWT token
    const token = jwt.sign(
      {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
        nombre: result.user.nombre,
        asesoria_id: result.asesoria.id,
        empresa_id: result.empresa.id,
        modulos: finalModulos,
        password_forced: false,
      },
      config.jwtSecret,
      { expiresIn: "10h" },
    );

    return res.status(201).json({
      success: true,
      token,
      user: {
        id: result.user.id,
        email: result.user.email,
        nombre: result.user.nombre,
        role: result.user.role,
        asesoria_id: result.asesoria.id,
        asesoria_nombre: result.asesoria.nombre,
        empresa_id: result.empresa.id,
        modulos: finalModulos,
        password_forced: false,
      },
    });
  } catch (err) {
    console.error("Error registrarAsesoria:", err);

    // Handle unique constraint violations
    if (err.code === "23505") {
      if (err.constraint_name?.includes("email")) {
        return res.status(409).json({ error: "Este email ya está en uso" });
      }
      return res.status(409).json({ error: "Ya existe un registro con estos datos" });
    }

    return res.status(500).json({ error: "Error registrando asesoría" });
  }
}
