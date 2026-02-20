
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
 * Actualizado para usar las nuevas columnas de IVA (base_imponible, cuota_iva)
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
        // Las facturas ya tenían desglose (subtotal vs iva_total)
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
        // Ahora usamos base_imponible y cuota_iva de purchases_180
        const [compras] = await sql`
            SELECT 
                COALESCE(SUM(base_imponible), 0) as base_imponible,
                COALESCE(SUM(cuota_iva), 0) as iva_soportado, -- Usando nueva columna
                COUNT(*) as count
            FROM purchases_180
            WHERE empresa_id = ${empresaId}
            AND activo = true
            AND fecha_compra BETWEEN ${startDate} AND ${endDate}
        `;

        // ==========================================
        // 3. DATOS ACUMULADOS AÑO (Para IRPF 130)
        // ==========================================
        const startYear = `${year}-01-01`;

        // Ingresos Acumulados
        const [acumuladoVentas] = await sql`
            SELECT COALESCE(SUM(subtotal), 0) as ingresos
            FROM factura_180
            WHERE empresa_id = ${empresaId}
            AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
            AND fecha BETWEEN ${startYear} AND ${endDate}
        `;

        // Gastos Acumulados (Compras)
        const [acumuladoCompras] = await sql`
            SELECT COALESCE(SUM(base_imponible), 0) as gastos
            FROM purchases_180
            WHERE empresa_id = ${empresaId}
            AND activo = true
            AND fecha_compra BETWEEN ${startYear} AND ${endDate}
        `;

        // Gastos de Nóminas Acumulados (Seguridad Social Empresa + Bruto)
        // El gasto deducible para la empresa es el Bruto + SS Empresa (coste total)
        const [acumuladoNominas] = await sql`
            SELECT 
                COALESCE(SUM(bruto), 0) + COALESCE(SUM(seguridad_social_empresa), 0) as total_coste
            FROM nominas_180
            WHERE empresa_id = ${empresaId}
            AND anio = ${year}
            AND mes <= ${(parseInt(trimestre) * 3)} -- Meses incluidos hasta el fin del trimestre
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

        const totalGastos = parseFloat(acumuladoCompras.gastos) + parseFloat(acumuladoNominas.total_coste);
        const rendimientoNeto = parseFloat(acumuladoVentas.ingresos) - totalGastos;
        const pagoFraccionado = rendimientoNeto > 0 ? rendimientoNeto * 0.20 : 0;

        // Recuperar pagos anteriores del ejercicio para restarlos
        // TODO: Leer de fiscal_models_180 cuando implementemos el guardado
        const pagosAnteriores = 0;

        const modelo130 = {
            ingresos: parseFloat(acumuladoVentas.ingresos),
            gastos: totalGastos,
            gastos_detalle: {
                compras: parseFloat(acumuladoCompras.gastos),
                nominas: parseFloat(acumuladoNominas.total_coste)
            },
            rendimiento: rendimientoNeto,
            pago_fraccionado: pagoFraccionado, // 20%
            a_ingresar: pagoFraccionado - pagosAnteriores
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

/**
 * Obtener Libro de Ventas (Facturas Emitidas)
 */
export async function getLibroVentas(req, res) {
    try {
        const { year } = req.query;
        const empresaId = req.user.empresa_id;

        const [facturas] = await sql`
            SELECT 
                fecha, numero, cliente_id, total, subtotal as base, iva_total as cuota, 
                retencion_importe as retencion, 
                '21' as tipo
            FROM factura_180
            WHERE empresa_id = ${empresaId}
            AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
            AND EXTRACT(YEAR FROM fecha) = ${year}
            ORDER BY fecha ASC, numero ASC
        `;

        // Enriquecer con nombre de cliente sería ideal, o hacerlo en frontend
        // Por simplicidad devolvemos IDs y frontend cruza o hacemos JOIN
        const facturasWithClientName = await Promise.all(facturas.map(async f => {
            const [client] = await sql`SELECT nombre_fiscal FROM clients_180 WHERE id = ${f.cliente_id}`;
            return { ...f, cliente_nombre: client?.nombre_fiscal || 'Desconocido' };
        }));


        res.json({ success: true, data: facturasWithClientName });
    } catch (error) {
        console.error("Error getLibroVentas:", error);
        res.status(500).json({ success: false, error: "Error obteniendo libro ventas" });
    }
}

/**
 * Obtener Libro de Gastos (Facturas Recibidas)
 */
export async function getLibroGastos(req, res) {
    try {
        const { year } = req.query;
        const empresaId = req.user.empresa_id;

        const [gastos] = await sql`
            SELECT 
                fecha_compra as fecha, proveedor, descripcion, total, base_imponible as base, cuota_iva as cuota, 
                retencion_importe as retencion,
                iva_porcentaje as tipo
            FROM purchases_180
            WHERE empresa_id = ${empresaId}
            AND activo = true
            AND EXTRACT(YEAR FROM fecha_compra) = ${year}
            ORDER BY fecha_compra ASC
        `;

        res.json({ success: true, data: gastos });
    } catch (error) {
        console.error("Error getLibroGastos:", error);
        res.status(500).json({ success: false, error: "Error obteniendo libro gastos" });
    }
}

/**
 * Obtener Libro de Nóminas
 */
export async function getLibroNominas(req, res) {
    try {
        const { year } = req.query;
        const empresaId = req.user.empresa_id;

        const [nominas] = await sql`
            SELECT 
                n.*, e.nombre, e.apellidos
            FROM nominas_180 n
            LEFT JOIN employees_180 em ON n.empleado_id = em.id
            LEFT JOIN users_180 e ON em.user_id = e.id
            WHERE n.empresa_id = ${empresaId}
            AND n.anio = ${year}
            ORDER BY n.mes ASC, e.apellidos ASC
        `;

        res.json({ success: true, data: nominas });
    } catch (error) {
    }
}

/**
 * Presentar Modelo 303 a la AEAT
 */
export async function presentModelo303(req, res) {
    try {
        const { year, trimestre } = req.body;
        // const empresaId = req.user.empresa_id;

        // 1. Calcular datos (reutilizando lógica)
        // NOTA: Idealmente separar la lógica de cálculo en un servicio para no duplicar o llamar internamente
        // Por ahora simulamos la llamada interna o recalculamos

        // ... Recalcular datos ...
        // const datosCalculados = ... 

        // 2. Generar BOE
        // const boe = aeatService.generarBOE303(datosCalculados);

        // 3. Enviar a AEAT
        // const resultado = await aeatService.presentarModelo(empresaId, boe, '303');

        // 4. Guardar en historial (fiscal_models_180)

        // MOCK RESPONSE POR AHORA
        res.json({ success: true, message: "Funcionalidad de presentación en desarrollo" });

    } catch (error) {
        console.error("Error presentModelo303:", error);
        res.status(500).json({ success: false, error: "Error en presentación" });
    }
}
