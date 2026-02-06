import crypto from "crypto";
import { sql } from "../db.js";

// Generar invitación de instalación para un empleado
export const generateEmployeeInvite = async (req, res) => {
  try {
    const { id: empleadoId } = req.params; // id de employees_180

    // Buscar empresa del admin que hace la petición
    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res
        .status(400)
        .json({ error: "El usuario no es una empresa válida" });
    }

    const empresaId = empresa[0].id;

    // Validar que el empleado pertenece a esta empresa
    const empleado = await sql`
      SELECT id FROM employees_180
      WHERE id = ${empleadoId} AND empresa_id = ${empresaId}
    `;

    if (empleado.length === 0) {
      return res
        .status(404)
        .json({ error: "Empleado no encontrado en esta empresa" });
    }

    // Desactivar invitaciones anteriores de este empleado
    await sql`
      UPDATE invite_180
      SET usado = true, usado_en = now()
      WHERE empleado_id = ${empleadoId} AND usado = false
    `;

    // Desactivar dispositivos anteriores (por seguridad)
    await sql`
      UPDATE employee_devices_180
      SET activo = false
      WHERE empleado_id = ${empleadoId} AND activo = true
    `;
    const empleadoData = await sql`
    SELECT user_id FROM employees_180
    WHERE id = ${empleadoId}
  `;

    const empleadoUserId = empleadoData[0].user_id;

    // Generar nuevo token
    const rawToken = crypto.randomBytes(32).toString("hex");

    const invite = await sql`
  INSERT INTO invite_180 (empleado_id, empresa_id, user_id, token)
  VALUES (${empleadoId}, ${empresaId}, ${empleadoUserId}, ${rawToken})
  RETURNING id, token, creado
`;

    const generated = invite[0];

    // Aquí podrías construir la URL real de la PWA de empleado
    const installUrl = `${process.env.FRONTEND_URL}/empleado/instalar?token=${generated.token}`;

    return res.json({
      success: true,
      token: generated.token,
      installUrl,
      creado: generated.creado,
    });
  } catch (err) {
    console.error("❌ Error en generateEmployeeInvite:", err);
    return res.status(500).json({ error: "Error al generar invitación" });
  }
};

// Activar / desactivar dispositivos de un empleado (empresa puede desactivar PWA)
export const updateEmployeeDeviceStatus = async (req, res) => {
  try {
    const { id: empleadoId } = req.params; // employees_180.id
    const { activo } = req.body;

    if (typeof activo !== "boolean") {
      return res.status(400).json({ error: "Valor 'activo' debe ser boolean" });
    }

    // Comprobar que el empleado pertenece a la empresa del admin
    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res
        .status(400)
        .json({ error: "El usuario no es una empresa válida" });
    }

    const empresaId = empresa[0].id;

    const empleado = await sql`
      SELECT id FROM employees_180
      WHERE id = ${empleadoId} AND empresa_id = ${empresaId}
    `;

    if (empleado.length === 0) {
      return res
        .status(404)
        .json({ error: "Empleado no encontrado en esta empresa" });
    }

    const updated = await sql`
      UPDATE employee_devices_180
      SET activo = ${activo}
      WHERE empleado_id = ${empleadoId}
      RETURNING id, empleado_id, device_hash, activo
    `;

    return res.json({
      success: true,
      dispositivos_actualizados: updated,
    });
  } catch (err) {
    console.error("❌ Error en updateEmployeeDeviceStatus:", err);
    return res
      .status(500)
      .json({ error: "Error al actualizar estado del dispositivo" });
  }
};
