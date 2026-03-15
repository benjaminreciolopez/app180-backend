// backend/src/controllers/asesorDashboardConsolidadoController.js
// Dashboard consolidado del asesor con KPIs agregados de todos los clientes
import { sql } from "../db.js";

/**
 * GET /asesor/dashboard/consolidado
 * Devuelve datos agregados de todos los clientes activos del asesor
 */
export async function getDashboardConsolidado(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    const asesoriaEmpresaId = req.user.empresa_id; // empresa propia de la asesoria
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    // 1. Obtener empresa_ids de clientes activos
    const clientesActivos = await sql`
      SELECT ac.empresa_id, e.nombre
      FROM asesoria_clientes_180 ac
      JOIN empresa_180 e ON e.id = ac.empresa_id
      WHERE ac.asesoria_id = ${asesoriaId}
        AND ac.estado = 'activo'
    `;

    const empresaIds = clientesActivos.map((c) => c.empresa_id);

    // ── KPIs PROPIOS de la asesoria (su propia empresa) ──
    const emptyFinancial = { este_mes: 0, mes_anterior: 0, ytd: 0 };
    let facturacionPropia = { ...emptyFinancial };
    let gastosPropia = { ...emptyFinancial };
    let beneficioPropia = { este_mes: 0, ytd: 0 };

    if (asesoriaEmpresaId) {
      const [fpEsteMes] = await sql`
        SELECT COALESCE(SUM(total), 0)::numeric AS total
        FROM factura_180
        WHERE empresa_id = ${asesoriaEmpresaId}
          AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
          AND (es_test IS NOT TRUE)
          AND EXTRACT(YEAR FROM fecha) = ${currentYear}
          AND EXTRACT(MONTH FROM fecha) = ${currentMonth}
      `;
      const [fpMesAnt] = await sql`
        SELECT COALESCE(SUM(total), 0)::numeric AS total
        FROM factura_180
        WHERE empresa_id = ${asesoriaEmpresaId}
          AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
          AND (es_test IS NOT TRUE)
          AND EXTRACT(YEAR FROM fecha) = ${prevMonthYear}
          AND EXTRACT(MONTH FROM fecha) = ${prevMonth}
      `;
      const [fpYtd] = await sql`
        SELECT COALESCE(SUM(total), 0)::numeric AS total
        FROM factura_180
        WHERE empresa_id = ${asesoriaEmpresaId}
          AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
          AND (es_test IS NOT TRUE)
          AND EXTRACT(YEAR FROM fecha) = ${currentYear}
      `;
      const [gpEsteMes] = await sql`
        SELECT COALESCE(SUM(total), 0)::numeric AS total
        FROM purchases_180
        WHERE empresa_id = ${asesoriaEmpresaId}
          AND activo = true
          AND EXTRACT(YEAR FROM fecha_compra) = ${currentYear}
          AND EXTRACT(MONTH FROM fecha_compra) = ${currentMonth}
      `;
      const [gpMesAnt] = await sql`
        SELECT COALESCE(SUM(total), 0)::numeric AS total
        FROM purchases_180
        WHERE empresa_id = ${asesoriaEmpresaId}
          AND activo = true
          AND EXTRACT(YEAR FROM fecha_compra) = ${prevMonthYear}
          AND EXTRACT(MONTH FROM fecha_compra) = ${prevMonth}
      `;
      const [gpYtd] = await sql`
        SELECT COALESCE(SUM(total), 0)::numeric AS total
        FROM purchases_180
        WHERE empresa_id = ${asesoriaEmpresaId}
          AND activo = true
          AND EXTRACT(YEAR FROM fecha_compra) = ${currentYear}
      `;

      facturacionPropia = {
        este_mes: parseFloat(fpEsteMes.total),
        mes_anterior: parseFloat(fpMesAnt.total),
        ytd: parseFloat(fpYtd.total),
      };
      gastosPropia = {
        este_mes: parseFloat(gpEsteMes.total),
        mes_anterior: parseFloat(gpMesAnt.total),
        ytd: parseFloat(gpYtd.total),
      };
      beneficioPropia = {
        este_mes: facturacionPropia.este_mes - gastosPropia.este_mes,
        ytd: facturacionPropia.ytd - gastosPropia.ytd,
      };
    }

    if (empresaIds.length === 0) {
      return res.json({
        success: true,
        data: {
          facturacion_propia: facturacionPropia,
          gastos_propios: gastosPropia,
          beneficio_propio: beneficioPropia,
          facturacion_clientes: { ...emptyFinancial },
          gastos_clientes: { ...emptyFinancial },
          clientes_facturas_pendientes: { total_clientes: 0, total_importe: 0 },
          clientes_con_alertas: 0,
          plazos_fiscales: [],
          actividad_reciente: [],
          clientes_salud: [],
          kpis_basicos: { clientes_activos: 0, invitaciones_pendientes: 0, mensajes_no_leidos: 0 },
        },
      });
    }

    // ── KPIs AGREGADOS de clientes ──

    // 2. Facturacion agregada de clientes
    const [factEsteMes] = await sql`
      SELECT COALESCE(SUM(total), 0)::numeric AS total
      FROM factura_180
      WHERE empresa_id = ANY(${empresaIds})
        AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
        AND (es_test IS NOT TRUE)
        AND EXTRACT(YEAR FROM fecha) = ${currentYear}
        AND EXTRACT(MONTH FROM fecha) = ${currentMonth}
    `;
    const [factMesAnterior] = await sql`
      SELECT COALESCE(SUM(total), 0)::numeric AS total
      FROM factura_180
      WHERE empresa_id = ANY(${empresaIds})
        AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
        AND (es_test IS NOT TRUE)
        AND EXTRACT(YEAR FROM fecha) = ${prevMonthYear}
        AND EXTRACT(MONTH FROM fecha) = ${prevMonth}
    `;
    const [factYtd] = await sql`
      SELECT COALESCE(SUM(total), 0)::numeric AS total
      FROM factura_180
      WHERE empresa_id = ANY(${empresaIds})
        AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
        AND (es_test IS NOT TRUE)
        AND EXTRACT(YEAR FROM fecha) = ${currentYear}
    `;

    // 3. Gastos agregados de clientes
    const [gastosEsteMes] = await sql`
      SELECT COALESCE(SUM(total), 0)::numeric AS total
      FROM purchases_180
      WHERE empresa_id = ANY(${empresaIds})
        AND activo = true
        AND EXTRACT(YEAR FROM fecha_compra) = ${currentYear}
        AND EXTRACT(MONTH FROM fecha_compra) = ${currentMonth}
    `;
    const [gastosMesAnterior] = await sql`
      SELECT COALESCE(SUM(total), 0)::numeric AS total
      FROM purchases_180
      WHERE empresa_id = ANY(${empresaIds})
        AND activo = true
        AND EXTRACT(YEAR FROM fecha_compra) = ${prevMonthYear}
        AND EXTRACT(MONTH FROM fecha_compra) = ${prevMonth}
    `;
    const [gastosYtd] = await sql`
      SELECT COALESCE(SUM(total), 0)::numeric AS total
      FROM purchases_180
      WHERE empresa_id = ANY(${empresaIds})
        AND activo = true
        AND EXTRACT(YEAR FROM fecha_compra) = ${currentYear}
    `;

    // 4. Clientes con facturas pendientes de cobro
    const facturasPendientes = await sql`
      SELECT empresa_id, COUNT(*)::int AS total, COALESCE(SUM(total), 0)::numeric AS importe
      FROM factura_180
      WHERE empresa_id = ANY(${empresaIds})
        AND estado = 'VALIDADA'
        AND (es_test IS NOT TRUE)
        AND COALESCE(estado_pago, 'pendiente') IN ('pendiente', 'parcial')
      GROUP BY empresa_id
    `;

    // 5. Plazos fiscales proximos 30 dias
    const plazosFiscales = await sql`
      SELECT modelo, periodo, descripcion, dia_vencimiento, mes_vencimiento
      FROM calendario_fiscal_180
    `;

    const proximosPlazos = [];
    for (const plazo of plazosFiscales) {
      // Calcular fecha de vencimiento para este ano
      let year = currentYear;
      // Para modelos de T4 que vencen en enero, el ano de vencimiento es el siguiente
      if (plazo.periodo === "T4" && plazo.mes_vencimiento === 1) {
        year = currentYear; // El T4 del ano anterior vence en enero del ano actual
      }
      // Para el 390 anual que vence en enero
      if (plazo.periodo === "Anual" && plazo.mes_vencimiento === 1) {
        year = currentYear;
      }

      const fechaVenc = new Date(year, plazo.mes_vencimiento - 1, plazo.dia_vencimiento);
      const diasRestantes = Math.ceil((fechaVenc - now) / (1000 * 60 * 60 * 24));

      if (diasRestantes >= 0 && diasRestantes <= 30) {
        proximosPlazos.push({
          modelo: plazo.modelo,
          periodo: plazo.periodo,
          descripcion: plazo.descripcion,
          fecha_vencimiento: fechaVenc.toISOString().split("T")[0],
          dias_restantes: diasRestantes,
        });
      }

      // Tambien comprobar el siguiente ano si estamos en diciembre
      if (currentMonth >= 11) {
        const fechaVencNext = new Date(year + 1, plazo.mes_vencimiento - 1, plazo.dia_vencimiento);
        const diasRestantesNext = Math.ceil((fechaVencNext - now) / (1000 * 60 * 60 * 24));
        if (diasRestantesNext >= 0 && diasRestantesNext <= 30) {
          proximosPlazos.push({
            modelo: plazo.modelo,
            periodo: plazo.periodo,
            descripcion: plazo.descripcion,
            fecha_vencimiento: fechaVencNext.toISOString().split("T")[0],
            dias_restantes: diasRestantesNext,
          });
        }
      }
    }
    proximosPlazos.sort((a, b) => a.dias_restantes - b.dias_restantes);

    // 6. Actividad reciente (ultimos 20 eventos)
    const actividadReciente = await sql`
      (
        SELECT 'factura' AS tipo, f.fecha, f.empresa_id, e.nombre AS empresa_nombre,
               'Factura ' || COALESCE(f.numero, '') || ' - ' || COALESCE(f.total::text, '0') || ' €' AS descripcion
        FROM factura_180 f
        JOIN empresa_180 e ON e.id = f.empresa_id
        WHERE f.empresa_id = ANY(${empresaIds})
          AND f.estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
          AND (f.es_test IS NOT TRUE)
        ORDER BY f.fecha DESC LIMIT 10
      )
      UNION ALL
      (
        SELECT 'gasto' AS tipo, p.fecha_compra AS fecha, p.empresa_id, e.nombre AS empresa_nombre,
               COALESCE(p.proveedor, 'Gasto') || ' - ' || COALESCE(p.total::text, '0') || ' €' AS descripcion
        FROM purchases_180 p
        JOIN empresa_180 e ON e.id = p.empresa_id
        WHERE p.empresa_id = ANY(${empresaIds})
          AND p.activo = true
        ORDER BY p.fecha_compra DESC LIMIT 10
      )
      ORDER BY fecha DESC
      LIMIT 20
    `;

    // 7. Salud de clientes (con datos financieros individuales)
    const clientesSalud = [];
    for (const cliente of clientesActivos) {
      const [factMes] = await sql`
        SELECT COUNT(*)::int AS total
        FROM factura_180
        WHERE empresa_id = ${cliente.empresa_id}
          AND EXTRACT(YEAR FROM fecha) = ${currentYear}
          AND EXTRACT(MONTH FROM fecha) = ${currentMonth}
          AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
          AND (es_test IS NOT TRUE)
      `;

      const [alertas] = await sql`
        SELECT COUNT(*)::int AS total
        FROM notificaciones_180
        WHERE empresa_id = ${cliente.empresa_id}
          AND tipo = 'fiscal_alert'
          AND leida = false
      `;

      // Datos financieros individuales del cliente
      const [cFactEsteMes] = await sql`
        SELECT COALESCE(SUM(total), 0)::numeric AS total
        FROM factura_180
        WHERE empresa_id = ${cliente.empresa_id}
          AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
          AND (es_test IS NOT TRUE)
          AND EXTRACT(YEAR FROM fecha) = ${currentYear}
          AND EXTRACT(MONTH FROM fecha) = ${currentMonth}
      `;
      const [cFactMesAnt] = await sql`
        SELECT COALESCE(SUM(total), 0)::numeric AS total
        FROM factura_180
        WHERE empresa_id = ${cliente.empresa_id}
          AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
          AND (es_test IS NOT TRUE)
          AND EXTRACT(YEAR FROM fecha) = ${prevMonthYear}
          AND EXTRACT(MONTH FROM fecha) = ${prevMonth}
      `;
      const [cFactYtd] = await sql`
        SELECT COALESCE(SUM(total), 0)::numeric AS total
        FROM factura_180
        WHERE empresa_id = ${cliente.empresa_id}
          AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
          AND (es_test IS NOT TRUE)
          AND EXTRACT(YEAR FROM fecha) = ${currentYear}
      `;
      const [cGastEsteMes] = await sql`
        SELECT COALESCE(SUM(total), 0)::numeric AS total
        FROM purchases_180
        WHERE empresa_id = ${cliente.empresa_id}
          AND activo = true
          AND EXTRACT(YEAR FROM fecha_compra) = ${currentYear}
          AND EXTRACT(MONTH FROM fecha_compra) = ${currentMonth}
      `;
      const [cGastMesAnt] = await sql`
        SELECT COALESCE(SUM(total), 0)::numeric AS total
        FROM purchases_180
        WHERE empresa_id = ${cliente.empresa_id}
          AND activo = true
          AND EXTRACT(YEAR FROM fecha_compra) = ${prevMonthYear}
          AND EXTRACT(MONTH FROM fecha_compra) = ${prevMonth}
      `;
      const [cGastYtd] = await sql`
        SELECT COALESCE(SUM(total), 0)::numeric AS total
        FROM purchases_180
        WHERE empresa_id = ${cliente.empresa_id}
          AND activo = true
          AND EXTRACT(YEAR FROM fecha_compra) = ${currentYear}
      `;

      let estado = "green";
      let issues = 0;
      if (factMes.total === 0) issues++;
      if (alertas.total > 0) issues++;
      if (issues === 1) estado = "yellow";
      if (issues >= 2) estado = "red";

      const facCliente = parseFloat(cFactEsteMes.total);
      const gasCliente = parseFloat(cGastEsteMes.total);

      clientesSalud.push({
        empresa_id: cliente.empresa_id,
        nombre: cliente.nombre,
        estado,
        facturas_mes: factMes.total,
        alertas: alertas.total,
        facturacion: {
          este_mes: facCliente,
          mes_anterior: parseFloat(cFactMesAnt.total),
          ytd: parseFloat(cFactYtd.total),
        },
        gastos: {
          este_mes: gasCliente,
          mes_anterior: parseFloat(cGastMesAnt.total),
          ytd: parseFloat(cGastYtd.total),
        },
        beneficio: {
          este_mes: facCliente - gasCliente,
          ytd: parseFloat(cFactYtd.total) - parseFloat(cGastYtd.total),
        },
      });
    }

    // 8. KPIs basicos (reutilizando la logica existente)
    const [pendingCount] = await sql`
      SELECT COUNT(*)::int AS total
      FROM asesoria_clientes_180
      WHERE asesoria_id = ${asesoriaId} AND estado = 'pendiente'
    `;
    const [unreadCount] = await sql`
      SELECT COUNT(*)::int AS total
      FROM asesoria_mensajes_180
      WHERE asesoria_id = ${asesoriaId}
        AND autor_tipo != 'asesor'
        AND leido = false
    `;

    return res.json({
      success: true,
      data: {
        facturacion_propia: facturacionPropia,
        gastos_propios: gastosPropia,
        beneficio_propio: beneficioPropia,
        facturacion_clientes: {
          este_mes: parseFloat(factEsteMes.total),
          mes_anterior: parseFloat(factMesAnterior.total),
          ytd: parseFloat(factYtd.total),
        },
        gastos_clientes: {
          este_mes: parseFloat(gastosEsteMes.total),
          mes_anterior: parseFloat(gastosMesAnterior.total),
          ytd: parseFloat(gastosYtd.total),
        },
        clientes_facturas_pendientes: {
          total_clientes: facturasPendientes.length,
          total_importe: facturasPendientes.reduce((sum, f) => sum + parseFloat(f.importe), 0),
        },
        clientes_con_alertas: clientesSalud.filter((c) => c.alertas > 0).length,
        plazos_fiscales: proximosPlazos,
        actividad_reciente: actividadReciente,
        clientes_salud: clientesSalud,
        kpis_basicos: {
          clientes_activos: empresaIds.length,
          invitaciones_pendientes: pendingCount.total,
          mensajes_no_leidos: unreadCount.total,
        },
      },
    });
  } catch (err) {
    console.error("Error getDashboardConsolidado:", err);
    return res.status(500).json({ error: "Error obteniendo dashboard consolidado" });
  }
}
