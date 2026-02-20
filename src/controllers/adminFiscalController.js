
import { sql } from "../db.js";
import { aeatService } from "../services/aeatService.js";

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
 * Lógica compartida para calcular datos de modelos
 */
export async function calcularDatosModelos(empresaId, year, trimestre) {
    const { startDate, endDate } = getTrimestreDates(year, trimestre);

    // 1. IVA DEVENGADO (VENTAS)
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

    // 2. IVA DEDUCIBLE (GASTOS)
    const [compras] = await sql`
        SELECT 
            COALESCE(SUM(base_imponible), 0) as base_imponible,
            COALESCE(SUM(cuota_iva), 0) as iva_soportado,
            COUNT(*) as count
        FROM purchases_180
        WHERE empresa_id = ${empresaId}
        AND activo = true
        AND fecha_compra BETWEEN ${startDate} AND ${endDate}
    `;

    // 3. DATOS ACUMULADOS AÑO (Modelo 130)
    const startYear = `${year}-01-01`;
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
    const [acumuladoNominas] = await sql`
        SELECT 
            COALESCE(SUM(bruto), 0) + COALESCE(SUM(seguridad_social_empresa), 0) as total_coste
        FROM nominas_180
        WHERE empresa_id = ${empresaId}
        AND anio = ${year}
        AND mes <= ${(parseInt(trimestre) * 3)}
    `;

    // 4. DATOS MODELO 111 (Retenciones IRPF)
    const [nominas111] = await sql`
        SELECT 
            COUNT(*) as perceptores,
            COALESCE(SUM(bruto), 0) as rendimientos,
            COALESCE(SUM(irpf), 0) as retenciones
        FROM nominas_180
        WHERE empresa_id = ${empresaId}
        AND anio = ${year}
        AND mes BETWEEN ${(parseInt(trimestre) - 1) * 3 + 1} AND ${parseInt(trimestre) * 3}
    `;
    const [actividades111] = await sql`
        SELECT 
            COUNT(DISTINCT proveedor) as perceptores,
            COALESCE(SUM(base_imponible), 0) as rendimientos,
            COALESCE(SUM(retencion_importe), 0) as retenciones
        FROM purchases_180
        WHERE empresa_id = ${empresaId}
        AND activo = true
        AND retencion_importe > 0
        AND fecha_compra BETWEEN ${startDate} AND ${endDate}
    `;

    const [emisor] = await sql`SELECT nif, nombre FROM emisor_180 WHERE empresa_id = ${empresaId}`;

    const modelo303 = {
        devengado: { base: parseFloat(ventas.base_imponible), cuota: parseFloat(ventas.iva_repercutido) },
        deducible: { base: parseFloat(compras.base_imponible), cuota: parseFloat(compras.iva_soportado) },
        resultado: parseFloat(ventas.iva_repercutido) - parseFloat(compras.iva_soportado)
    };

    const totalGastos = parseFloat(acumuladoCompras.gastos) + parseFloat(acumuladoNominas.total_coste);
    const rendimientoNeto = parseFloat(acumuladoVentas.ingresos) - totalGastos;
    const pagoFraccionado = rendimientoNeto > 0 ? rendimientoNeto * 0.20 : 0;
    const pagosAnteriores = 0; // TODO: Cargar de DB

    const modelo130 = {
        ingresos: parseFloat(acumuladoVentas.ingresos),
        gastos: totalGastos,
        gastos_detalle: {
            compras: parseFloat(acumuladoCompras.gastos),
            nominas: parseFloat(acumuladoNominas.total_coste)
        },
        rendimiento: rendimientoNeto,
        pago_fraccionado: pagoFraccionado,
        a_ingresar: pagoFraccionado - pagosAnteriores
    };

    const modelo111 = {
        trabajo: {
            perceptores: parseInt(nominas111.perceptores),
            rendimientos: parseFloat(nominas111.rendimientos),
            retenciones: parseFloat(nominas111.retenciones)
        },
        actividades: {
            perceptores: parseInt(actividades111.perceptores),
            rendimientos: parseFloat(actividades111.rendimientos),
            retenciones: parseFloat(actividades111.retenciones)
        },
        total_retenciones: parseFloat(nominas111.retenciones) + parseFloat(actividades111.retenciones)
    };

    return {
        year, trimestre, startDate, endDate,
        nif: emisor?.nif || '',
        nombre: emisor?.nombre || '',
        modelo303, modelo130, modelo111
    };
}

/**
 * Obtener datos para paneles de control
 */
export async function getFiscalData(req, res) {
    try {
        const { year, trimestre } = req.query;
        const empresaId = req.user.empresa_id;

        if (!year || !trimestre) return res.status(400).json({ error: "Año y Trimestre requeridos" });

        const data = await calcularDatosModelos(empresaId, year, trimestre);
        res.json({ success: true, data });

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

        const facturas = await sql`
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

        const facturasWithClientName = await Promise.all(facturas.map(async f => {
            const [client] = await sql`SELECT nombre FROM clients_180 WHERE id = ${f.cliente_id}`;
            return { ...f, cliente_nombre: client?.nombre || 'Desconocido' };
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

        const gastos = await sql`
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

        const nominas = await sql`
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
        console.error("Error getLibroNominas:", error);
        res.status(500).json({ success: false, error: "Error obteniendo libro nóminas" });
    }
}

/**
 * Descargar fichero BOE para un modelo
 */
export async function downloadBOE(req, res) {
    try {
        const { year, trimestre, modelo } = req.query;
        const empresaId = req.user.empresa_id;

        if (!year || !trimestre || !modelo) {
            return res.status(400).json({ error: "Año, trimestre y modelo requeridos" });
        }

        const data = await calcularDatosModelos(empresaId, year, trimestre);
        let boe = "";

        switch (modelo) {
            case '303':
                boe = aeatService.generarBOE303(data);
                break;
            case '130':
                boe = aeatService.generarBOE130(data);
                break;
            case '111':
                boe = aeatService.generarBOE111(data);
                break;
            default:
                return res.status(400).json({ error: "Modelo no soportado para descarga" });
        }

        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename=Modelo_${modelo}_${year}_T${trimestre}.txt`);
        res.send(boe);

    } catch (error) {
        console.error("Error downloadBOE:", error);
        res.status(500).json({ success: false, error: "Error generando fichero descarga" });
    }
}
