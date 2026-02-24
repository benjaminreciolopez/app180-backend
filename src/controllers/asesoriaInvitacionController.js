// backend/src/controllers/asesoriaInvitacionController.js
// Invitation and connection flow between asesorias and clients
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sql } from "../db.js";
import { config } from "../config.js";

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
    } = req.body;

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
          created_at
        )
        VALUES (
          ${nombre.trim()},
          ${cif || null},
          ${email_contacto.trim().toLowerCase()},
          ${telefono || null},
          ${direccion || null},
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

      return { user, asesoria };
    });

    // Generate JWT token
    const token = jwt.sign(
      {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
        nombre: result.user.nombre,
        asesoria_id: result.asesoria.id,
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
