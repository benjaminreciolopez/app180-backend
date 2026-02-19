
import { sql } from "../db.js";

/**
 * Helper para obtener rango de fechas de un trimestre
 */
function getTrimestreDates(year, quarter) {
    const y = parseInt(year);
    const q = parseInt(quarter);

    // T1: Ene-Mar, T2: Abr-Jun, T3: Jul-Sep, T4: Oct-Dic
    const startMonth = (q - 1) * 3; // 0, 3, 6, 9
    const endMonth = startMonth + 3; // 3, 6, 9, 12 (exclusivo para Date, que usa 0-indexed months)

    const startDate = new Date(y, startMonth, 1);
    const endDate = new Date(y, endMonth, 0); // Último día del mes anterior a endMonth (es decir, fin del trimestre)

    // Formato YYYY-MM-DD
    const isoStart = startDate.toISOString().split('T')[0];
    const isoEnd = endDate.toISOString().split('T')[0];

    return { startDate: isoStart, endDate: isoEnd };
}

/**
 * Obtener datos para Modelo 303 (IVA) y Modelo 130 (IRPF)
 */
export async function getFiscalData(req, res) {
    try {
        const { year, trimestre } = req.query;
        const empresaId = req.user.empresa_id;

        if (!year || !trimestre) {
            return res.status(400).json({ error: "Año y Trimestre requeridos" });
        }

        const { startDate, endDate } = getTrimestreDates(year, trimestre);

        // ==========================================
        // 1. IVA DEVENGADO (VENTAS - Facturas Emitidas)
        // ==========================================
        const [ventas] = await sql`
            SELECT 
                COALESCE(SUM(subtotal), 0) as base_imponible,
                COALESCE(SUM(iva_total), 0) as iva_repercutido,
                COUNT(*) as count
            FROM factura_180
            WHERE empresa_id = ${empresaId}
            AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
            AND fecha BETWEEN ${startDate} AND ${endDate}
        `;

        // ==========================================
        // 2. IVA DEDUCIBLE (GASTOS - Compras)
        // ==========================================
        const [compras] = await sql`
            SELECT 
                COALESCE(SUM(base_imponible), 0) as base_imponible,
                COALESCE(SUM(iva_importe), 0) as iva_soportado,
                COUNT(*) as count
            FROM purchases_180
            WHERE empresa_id = ${empresaId}
            AND activo = true
            AND fecha_compra BETWEEN ${startDate} AND ${endDate}
        `;

        // ==========================================
        // 3. DATOS ACUMULADOS AÑO (Para IRPF)
        // ==========================================
        const startYear = `${year}-01-01`;
        // Para IRPF Modelo 130 se usa el acumulado desde inicio de año hasta fin del trimestre actual

        const [acumuladoVentas] = await sql`
            SELECT COALESCE(SUM(subtotal), 0) as ingresos
            FROM factura_180
            WHERE empresa_id = ${empresaId}
            AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
            AND fecha BETWEEN ${startYear} AND ${endDate}
        `;

        const [acumuladoCompras] = await sql`
            SELECT COALESCE(SUM(base_imponible), 0) as gastos
            FROM purchases_180
            WHERE empresa_id = ${empresaId}
            AND activo = true
            AND fecha_compra BETWEEN ${startYear} AND ${endDate}
        `;

        // ==========================================
        // CÁLCULOS MODELOS
        // ==========================================

        const modelo303 = {
            devengado: {
                base: parseFloat(ventas.base_imponible),
                cuota: parseFloat(ventas.iva_repercutido)
            },
            deducible: {
                base: parseFloat(compras.base_imponible),
                cuota: parseFloat(compras.iva_soportado)
            },
            resultado: parseFloat(ventas.iva_repercutido) - parseFloat(compras.iva_soportado)
        };

        const rendimientoNeto = parseFloat(acumuladoVentas.ingresos) - parseFloat(acumuladoCompras.gastos);
        const pagoFraccionado = rendimientoNeto > 0 ? rendimientoNeto * 0.20 : 0;

        // Aquí deberíamos restar pagos anteriores, pero por ahora lo dejamos simple o calculamos
        // los trimestres anteriores si el trimestre > 1
        let pagosAnteriores = 0;
        if (trimestre > 1) {
            // Lógica aproximada: calcular rendimiento acumulado hasta trimestre anterior
            // y aplicar 20%. Esto es complejo sin guardar los pagos reales.
            // Por simplicidad en versión 1, mostramos el acumulado teórico.
            // TODO: Guardar modelos previos para restar pagos reales.
        }

        const modelo130 = {
            ingresos: parseFloat(acumuladoVentas.ingresos),
            gastos: parseFloat(acumuladoCompras.gastos),
            rendimiento: rendimientoNeto,
            pago_fraccionado: pagoFraccionado, // 20%
            a_ingresar: pagoFraccionado - pagosAnteriores // Simplificado
        };

        res.json({
            success: true,
            data: {
                periodo: { year, trimestre, startDate, endDate },
                modelo303,
                modelo130
            }
        });

    } catch (error) {
        console.error("Error getFiscalData:", error);
        res.status(500).json({ success: false, error: "Error obteniendo datos fiscales" });
    }
}
