// backend/src/controllers/kioskEmployeeController.js
//
// CRUD para asignación de empleados a dispositivos kiosko.

import { sql } from "../db.js";

/**
 * GET /api/kiosk/devices/:id/employees
 * Retorna empleados asignados a un dispositivo kiosko.
 */
export const getKioskEmployees = async (req, res) => {
  try {
    const { id } = req.params;
    const empresaId = req.user.empresa_id;

    // Verificar que el dispositivo pertenece a la empresa
    const [device] = await sql`
      SELECT id FROM kiosk_devices_180
      WHERE id = ${id} AND empresa_id = ${empresaId}
    `;
    if (!device) return res.status(404).json({ error: "Dispositivo no encontrado" });

    const empleados = await sql`
      SELECT e.id, e.nombre, e.codigo_empleado, e.foto_url, e.activo
      FROM kiosk_empleados_180 ke
      JOIN employees_180 e ON e.id = ke.empleado_id
      WHERE ke.kiosk_device_id = ${id}
        AND ke.empresa_id = ${empresaId}
      ORDER BY e.nombre ASC
    `;

    return res.json(empleados);
  } catch (err) {
    console.error("Error getKioskEmployees:", err);
    return res.status(500).json({ error: "Error al obtener empleados del kiosco" });
  }
};

/**
 * POST /api/kiosk/devices/:id/employees
 * Asigna empleados a un dispositivo (reemplaza asignaciones existentes).
 * Body: { empleado_ids: string[] }
 */
export const assignEmployeesToKiosk = async (req, res) => {
  try {
    const { id } = req.params;
    const { empleado_ids } = req.body;
    const empresaId = req.user.empresa_id;

    if (!Array.isArray(empleado_ids)) {
      return res.status(400).json({ error: "empleado_ids debe ser un array" });
    }

    // Verificar dispositivo
    const [device] = await sql`
      SELECT id FROM kiosk_devices_180
      WHERE id = ${id} AND empresa_id = ${empresaId}
    `;
    if (!device) return res.status(404).json({ error: "Dispositivo no encontrado" });

    await sql.begin(async (tx) => {
      // Eliminar asignaciones existentes
      await tx`
        DELETE FROM kiosk_empleados_180
        WHERE kiosk_device_id = ${id} AND empresa_id = ${empresaId}
      `;

      // Insertar nuevas si hay
      if (empleado_ids.length > 0) {
        // Validar que todos pertenecen a la empresa
        const valid = await tx`
          SELECT id FROM employees_180
          WHERE id = ANY(${empleado_ids}) AND empresa_id = ${empresaId}
        `;
        const validIds = valid.map((e) => e.id);

        if (validIds.length > 0) {
          const rows = validIds.map((empId) => ({
            kiosk_device_id: id,
            empleado_id: empId,
            empresa_id: empresaId,
          }));
          await tx`INSERT INTO kiosk_empleados_180 ${tx(rows)}`;
        }
      }
    });

    return res.json({ success: true, asignados: empleado_ids.length });
  } catch (err) {
    console.error("Error assignEmployeesToKiosk:", err);
    return res.status(500).json({ error: "Error al asignar empleados" });
  }
};

/**
 * DELETE /api/kiosk/devices/:id/employees/:empleado_id
 * Elimina una asignación individual.
 */
export const removeEmployeeFromKiosk = async (req, res) => {
  try {
    const { id, empleado_id } = req.params;
    const empresaId = req.user.empresa_id;

    await sql`
      DELETE FROM kiosk_empleados_180
      WHERE kiosk_device_id = ${id}
        AND empleado_id = ${empleado_id}
        AND empresa_id = ${empresaId}
    `;

    return res.json({ success: true });
  } catch (err) {
    console.error("Error removeEmployeeFromKiosk:", err);
    return res.status(500).json({ error: "Error al eliminar asignación" });
  }
};
