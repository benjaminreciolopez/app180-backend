// backend/src/controllers/asesorCobrosPagosController.js
// Cobros y pagos del cliente vinculado, accesible desde el portal asesor.
// El vínculo y permisos se validan vía asesorClienteRequired.

import { sql } from "../db.js";

/**
 * GET /asesor/clientes/:empresa_id/cobros-pagos
 * Devuelve:
 *  - facturas_pendientes: validadas con saldo pendiente
 *  - pagos_recientes: últimos pagos registrados
 *  - resumen: KPIs (total pendiente, cobrado mes actual)
 */
export async function getCobrosPagos(req, res) {
  try {
    const empresaId = req.targetEmpresaId;
    const limite = Math.max(1, Math.min(parseInt(req.query.limite) || 20, 100));

    const facturasPendientes = await sql`
      SELECT
        f.id, f.numero, f.fecha, f.total::numeric AS total,
        COALESCE(f.pagado, 0)::numeric AS pagado,
        (f.total - COALESCE(f.pagado, 0))::numeric AS saldo,
        COALESCE(f.estado_pago, 'pendiente') AS estado_pago,
        f.cliente_id, c.nombre AS cliente_nombre, c.nif_cif AS cliente_nif
      FROM factura_180 f
      LEFT JOIN clients_180 c ON c.id = f.cliente_id
      WHERE f.empresa_id = ${empresaId}
        AND f.estado = 'VALIDADA'
        AND COALESCE(f.estado_pago, 'pendiente') != 'pagado'
        AND COALESCE(f.es_test, false) = false
      ORDER BY f.fecha ASC
      LIMIT ${limite}
    `;

    const pagosRecientes = await sql`
      SELECT
        p.id, p.fecha_pago, p.importe::numeric AS importe, p.metodo, p.referencia, p.notas,
        c.nombre AS cliente_nombre
      FROM payments_180 p
      LEFT JOIN clients_180 c ON c.id = p.cliente_id
      WHERE p.empresa_id = ${empresaId}
      ORDER BY p.fecha_pago DESC NULLS LAST, p.created_at DESC NULLS LAST
      LIMIT ${limite}
    `;

    const totalPendiente = facturasPendientes.reduce((s, f) => s + Number(f.saldo || 0), 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const [cobradoMes] = await sql`
      SELECT COALESCE(SUM(importe), 0)::numeric AS total
      FROM payments_180
      WHERE empresa_id = ${empresaId}
        AND fecha_pago >= ${monthStart.toISOString().slice(0, 10)}
    `;

    return res.json({
      success: true,
      data: {
        facturas_pendientes: facturasPendientes,
        pagos_recientes: pagosRecientes,
        resumen: {
          total_pendiente_cobro: totalPendiente,
          cobrado_mes: Number(cobradoMes?.total || 0),
          num_facturas_pendientes: facturasPendientes.length,
        },
      },
    });
  } catch (err) {
    console.error("Error asesor getCobrosPagos:", err);
    return res.status(500).json({ error: "Error obteniendo cobros y pagos" });
  }
}

/**
 * POST /asesor/clientes/:empresa_id/cobros-pagos/registrar
 * Registra un cobro y opcionalmente lo asigna a una factura concreta.
 * Body: { cliente_id, importe, metodo, fecha_pago?, referencia?, notas?, factura_id? }
 */
export async function registrarCobro(req, res) {
  try {
    const empresaId = req.targetEmpresaId;
    const { cliente_id, importe, metodo, fecha_pago, referencia, notas, factura_id } = req.body || {};

    if (!cliente_id || !importe || !metodo) {
      return res.status(400).json({ error: "cliente_id, importe y metodo son obligatorios" });
    }
    const metodosValidos = ["transferencia", "efectivo", "tarjeta", "bizum", "otro"];
    if (!metodosValidos.includes(metodo)) {
      return res.status(400).json({ error: "Método inválido" });
    }
    const importeNum = Number(importe);
    if (!(importeNum > 0)) {
      return res.status(400).json({ error: "Importe inválido" });
    }

    // Verificar cliente pertenece a la empresa
    const [cli] = await sql`
      SELECT id FROM clients_180 WHERE id = ${cliente_id} AND empresa_id = ${empresaId} LIMIT 1
    `;
    if (!cli) return res.status(404).json({ error: "Cliente no encontrado" });

    // Si hay factura, verificar también
    if (factura_id) {
      const [f] = await sql`
        SELECT id, total::numeric AS total, COALESCE(pagado, 0)::numeric AS pagado
        FROM factura_180 WHERE id = ${factura_id} AND empresa_id = ${empresaId} AND cliente_id = ${cliente_id}
        LIMIT 1
      `;
      if (!f) return res.status(404).json({ error: "Factura no encontrada o no corresponde al cliente" });
      const saldo = Number(f.total) - Number(f.pagado);
      if (importeNum - saldo > 0.01) {
        return res.status(400).json({ error: `Importe (${importeNum}€) excede el saldo pendiente (${saldo.toFixed(2)}€)` });
      }
    }

    const result = await sql.begin(async (tx) => {
      // 1) Crear pago
      const [pago] = await tx`
        INSERT INTO payments_180 (empresa_id, cliente_id, importe, metodo, fecha_pago, referencia, notas)
        VALUES (
          ${empresaId}, ${cliente_id}, ${importeNum}, ${metodo},
          ${fecha_pago || new Date().toISOString().slice(0, 10)},
          ${referencia || null}, ${notas || null}
        )
        RETURNING *
      `;

      // 2) Si hay factura, actualizar pagado/estado
      if (factura_id) {
        const [f] = await tx`
          SELECT total::numeric AS total, COALESCE(pagado, 0)::numeric AS pagado
          FROM factura_180 WHERE id = ${factura_id}
        `;
        const nuevoPagado = Number(f.pagado) + importeNum;
        const nuevoEstadoPago = nuevoPagado >= Number(f.total) - 0.01 ? "pagado" : "parcial";
        await tx`
          UPDATE factura_180
          SET pagado = ${nuevoPagado}, estado_pago = ${nuevoEstadoPago}, updated_at = NOW()
          WHERE id = ${factura_id}
        `;
        // Allocation
        await tx`
          INSERT INTO payment_allocations_180 (empresa_id, payment_id, factura_id, importe, created_at)
          VALUES (${empresaId}, ${pago.id}, ${factura_id}, ${importeNum}, NOW())
          ON CONFLICT DO NOTHING
        `;
      }

      return pago;
    });

    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    console.error("Error asesor registrarCobro:", err);
    return res.status(500).json({ error: err.message || "Error registrando cobro" });
  }
}
