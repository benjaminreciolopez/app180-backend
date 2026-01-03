import { sql } from "../db.js";
import bcrypt from "bcryptjs";

// ==========================
// CREAR EMPLEADO
// ==========================
export const createEmployee = async (req, res) => {
  try {
    // Obtenemos la empresa del admin
    const empresa = await sql`
  SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
`;

    if (empresa.length === 0) {
      return res.status(400).json({ error: "El usuario no es una empresa" });
    }

    const empresaId = empresa[0].id;
    const { email, password, nombre } = req.body;

    if (!email || !password || !nombre) {
      return res.status(400).json({ error: "Faltan datos" });
    }

    const hashed = await bcrypt.hash(password, 10);

    // Crear usuario del empleado
    const user = await sql`
      INSERT INTO users_180 (email, password, nombre, role)
      VALUES (${email}, ${hashed}, ${nombre}, 'empleado')
      RETURNING id
    `;

    const userId = user[0].id;

    // Registrar empleado asociado al admin
    const empleado = await sql`
      INSERT INTO employees_180 (user_id, empresa_id, nombre)
      VALUES (${userId}, ${empresaId}, ${nombre})
      RETURNING id, nombre, activo
    `;

    res.json({
      success: true,
      empleado: empleado[0],
    });
  } catch (err) {
    console.error("❌ Error en createEmployee:", err);
    res.status(500).json({ error: "Error al crear empleado" });
  }
};

// ==========================
// LISTAR EMPLEADOS DEL ADMIN
// ==========================
export const getEmployeesAdmin = async (req, res) => {
  try {
    const empleados = await sql`
      SELECT
        e.id,
        e.nombre,
        u.email,
        e.activo,
        t.nombre AS turno_nombre,
        d.activo AS dispositivo_activo,
        d.device_hash
      FROM employees_180 e
      JOIN users_180 u ON u.id = e.user_id
      LEFT JOIN turnos_180 t ON t.id = e.turno_id
      LEFT JOIN LATERAL (
        SELECT device_hash, activo
        FROM employee_devices_180
        WHERE empleado_id = e.id
        ORDER BY created_at DESC
        LIMIT 1
      ) d ON true
      ORDER BY e.nombre
    `;

    res.json(empleados);
  } catch (err) {
    console.error("❌ Error listando empleados:", err);
    res.status(500).json({ error: "Error obteniendo empleados" });
  }
};

// ==========================
// ACTIVAR / DESACTIVAR EMPLEADO
// ==========================
export const updateEmployeeStatus = async (req, res) => {
  try {
    const { id } = req.params; // id del empleado
    const { activo } = req.body; // true / false

    const empleado = await sql`
      UPDATE employees_180
      SET activo = ${activo}
      WHERE id = ${id}
      RETURNING id, nombre, activo
    `;

    res.json(empleado[0]);
  } catch (err) {
    console.error("❌ Error en updateEmployeeStatus:", err);
    res.status(500).json({ error: "Error al actualizar estado del empleado" });
  }
};
