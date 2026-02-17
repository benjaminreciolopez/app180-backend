import { sql } from "../db.js";
import { getEmpresaIdAdminOrThrow } from "../services/authService.js";
import { generatePdf, generateCsv } from "../services/exportService.js";
import { calcularReporteRentabilidad } from "../services/reportesService.js";
import {
    rentabilidadToHtml,
    empleadosToHtml,
    auditoriaToHtml,
    clientesToHtml,
    fichajesToHtml,
    cobrosToHtml,
    trabajosToHtml,
    sospechososToHtml,
    partesDiaToHtml,
    facturasToHtml,
    ivaTrimestralToHtml
} from "../templates/exportTemplates.js";

/**
 * Universal Export Controller
 * GET /admin/export/:module
 * Query: format=pdf|csv|html, ...module_params
 */
export const downloadExport = async (req, res) => {
    try {
        const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
        const { module } = req.params;
        const { format = 'pdf', ...queryParams } = req.query;

        console.log(`⬇️ Export Request: Module=${module}, Format=${format}, Params=`, queryParams);

        let data = [];
        let htmlContent = '';
        let csvColumns = [];
        let filename = `export-${module}-${Date.now()}`;

        // Helper para fechas vacías
        const fechaOrNull = (f) => (f && f !== 'undefined' && f !== '' ? f : null);

        // Selector de Módulo
        switch (module) {
            case 'rentabilidad':
                const d1 = fechaOrNull(queryParams.desde);
                const h1 = fechaOrNull(queryParams.hasta);
                const eid1 = queryParams.empleado_id;

                if (!d1 || !h1) {
                    // Default to current month if missing
                    const now = new Date();
                    throw new Error("Faltan fechas para reporte de rentabilidad");
                }

                data = await calcularReporteRentabilidad(empresaId, d1, h1, eid1);
                htmlContent = rentabilidadToHtml(data, { desde: d1, hasta: h1 });
                csvColumns = [
                    { key: 'empleado.nombre', header: 'Empleado' },
                    { key: 'horas_plan', header: 'H. Plan' },
                    { key: 'horas_real', header: 'H. Real' },
                    { key: 'diferencia', header: 'Diferencia' },
                    { key: 'estado', header: 'Estado' }
                ];
                filename = `rentabilidad-${d1}-${h1}`;
                break;

            case 'empleados':
                data = await sql`
                    SELECT
                        e.id,
                        e.nombre,
                        u.email,
                        e.activo,
                        e.tipo_trabajo
                    FROM employees_180 e
                    JOIN users_180 u ON u.id = e.user_id
                    WHERE e.empresa_id = ${empresaId}
                    ORDER BY e.nombre
                `;
                htmlContent = empleadosToHtml(data);
                csvColumns = [
                    { key: 'nombre', header: 'Nombre' },
                    { key: 'email', header: 'Email' },
                    { key: 'tipo_trabajo', header: 'Tipo' },
                    { key: 'activo', header: 'Activo' }
                ];
                break;

            case 'auditoria':
                const fe1 = fechaOrNull(queryParams.fecha_desde);
                const fe2 = fechaOrNull(queryParams.fecha_hasta);
                const acc = queryParams.accion;
                const ent = queryParams.entidad_tipo;
                const isFactura = ent === 'factura';
                const tableExport = isFactura ? sql`auditoria_180` : sql`audit_log_180`;

                data = await sql`
                    SELECT a.*, COALESCE(u.email, 'Sistema') as user_email 
                    FROM ${tableExport} a
                    LEFT JOIN users_180 u ON a.user_id = u.id
                    WHERE a.empresa_id = ${empresaId}
                    ${fe1 ? sql`AND a.created_at >= ${fe1}::date` : sql``}
                    ${fe2 ? sql`AND a.created_at <= ${fe2}::date + interval '1 day'` : sql``}
                    ${acc ? sql`AND a.accion = ${acc}` : sql``}
                    ${ent && !isFactura ? sql`AND a.entidad_tipo = ${ent}` : sql``}
                    ${isFactura ? sql`AND a.entidad = 'factura'` : sql``}
                    ORDER BY a.created_at DESC
                    LIMIT 2000
                `;
                htmlContent = auditoriaToHtml(data);
                csvColumns = [
                    { key: 'created_at', header: 'Fecha' },
                    { key: 'user_email', header: 'Usuario' },
                    { key: 'accion', header: 'Evento' },
                    { key: 'entidad_tipo', header: 'Módulo' },
                    { key: 'ip_address', header: 'IP' }
                ];
                if (isFactura) {
                    csvColumns = [
                        { key: 'created_at', header: 'Fecha' },
                        { key: 'accion', header: 'Acción' },
                        { key: 'user_email', header: 'Usuario' },
                        { key: 'ip', header: 'IP' },
                        { key: 'resultado', header: 'Resultado' }
                    ];
                }
                filename = `auditoria-${Date.now()}`;
                break;

            case 'clientes':
                data = await sql`
                    SELECT c.*, fd.nif_cif 
                    FROM clients_180 c 
                    LEFT JOIN client_fiscal_data_180 fd ON fd.cliente_id = c.id
                    WHERE c.empresa_id = ${empresaId} 
                    ORDER BY c.nombre
                `;
                htmlContent = clientesToHtml(data);
                csvColumns = [
                    { key: 'nombre', header: 'Cliente' },
                    { key: 'codigo', header: 'Código' },
                    { key: 'nif_cif', header: 'NIF/CIF' },
                    { key: 'contacto_nombre', header: 'Contacto' }
                ];
                break;

            case 'partes-dia':
                // Partes del dia (resumen diario / rentabilidad)
                const pFecha = fechaOrNull(queryParams.fecha);
                const pClienteId = queryParams.cliente_id;
                const pDesde = fechaOrNull(queryParams.fecha_inicio);
                const pHasta = fechaOrNull(queryParams.fecha_fin);

                data = await sql`
                    SELECT pd.*, e.nombre as empleado_nombre, c.nombre as cliente_nombre
                    FROM partes_dia_180 pd
                    JOIN employees_180 e ON pd.empleado_id = e.id
                    LEFT JOIN clients_180 c ON pd.cliente_id = c.id
                    WHERE pd.empresa_id = ${empresaId}
                    ${pFecha ? sql`AND pd.fecha = ${pFecha}::date` : sql``}
                    ${pClienteId ? sql`AND pd.cliente_id = ${pClienteId}` : sql``}
                    ${pDesde ? sql`AND pd.fecha >= ${pDesde}::date` : sql``}
                    ${pHasta ? sql`AND pd.fecha <= ${pHasta}::date` : sql``}
                    ORDER BY pd.fecha DESC, e.nombre ASC
                `;
                htmlContent = partesDiaToHtml(data);
                csvColumns = [
                    { key: 'fecha', header: 'Fecha' },
                    { key: 'empleado_nombre', header: 'Empleado' },
                    { key: 'cliente_nombre', header: 'Cliente' },
                    { key: 'horas_trabajadas', header: 'Horas' },
                    { key: 'estado', header: 'Estado' },
                    { key: 'resumen', header: 'Resumen' },
                    { key: 'nota_admin', header: 'Notas Admin' },
                    { key: 'validado', header: 'Validado' }
                ];
                filename = `partes-${pDesde || pFecha || 'historico'}`;
                break;

            case 'fichajes':
                // Filtros opcionales
                const d2 = fechaOrNull(queryParams.desde);
                const h2 = fechaOrNull(queryParams.hasta);
                const eid2 = queryParams.empleado_id;

                data = await sql`
                    SELECT j.*, e.nombre as empleado_nombre
                    FROM jornadas_180 j
                    JOIN employees_180 e ON j.empleado_id = e.id
                    WHERE j.empresa_id = ${empresaId}
                    ${d2 ? sql`AND j.fecha >= ${d2}::date` : sql``}
                    ${h2 ? sql`AND j.fecha <= ${h2}::date` : sql``}
                    ${(eid2 && eid2 !== 'null' && eid2 !== 'undefined') ? sql`AND j.empleado_id = ${eid2}` : sql``}
                    ORDER BY j.fecha DESC, e.nombre
                    LIMIT 500
                `;
                htmlContent = fichajesToHtml(data);
                csvColumns = [
                    { key: 'fecha', header: 'Fecha' },
                    { key: 'empleado_nombre', header: 'Empleado' },
                    { key: 'inicio', header: 'Inicio' },
                    { key: 'fin', header: 'Fin' },
                    { key: 'estado', header: 'Estado' },
                    { key: 'minutos_trabajados', header: 'Minutos' }
                ];
                break;

            case 'cobros':
                const d3 = fechaOrNull(queryParams.desde);
                const h3 = fechaOrNull(queryParams.hasta);

                data = await sql`
                    SELECT p.*, c.nombre as cliente_nombre
                    FROM payments_180 p
                    LEFT JOIN clients_180 c ON p.cliente_id = c.id
                    WHERE p.empresa_id = ${empresaId}
                    ${d3 ? sql`AND p.fecha_pago >= ${d3}::date` : sql``}
                    ${h3 ? sql`AND p.fecha_pago <= ${h3}::date` : sql``}
                    ORDER BY p.fecha_pago DESC
                    LIMIT 500
                `;
                htmlContent = cobrosToHtml(data);
                csvColumns = [
                    { key: 'fecha_pago', header: 'Fecha' },
                    { key: 'cliente_nombre', header: 'Cliente' },
                    { key: 'metodo', header: 'Método' },
                    { key: 'importe', header: 'Importe' }
                ];
                break;

            case 'trabajos':
                const d4 = fechaOrNull(queryParams.desde);
                const h4 = fechaOrNull(queryParams.hasta);

                data = await sql`
                    SELECT w.*, c.nombre as cliente_nombre, e.nombre as empleado_nombre
                    FROM work_logs_180 w
                    LEFT JOIN clients_180 c ON w.cliente_id = c.id
                    LEFT JOIN employees_180 e ON w.employee_id = e.id
                    WHERE w.empresa_id = ${empresaId}
                    ${d4 ? sql`AND w.fecha >= ${d4}::date` : sql``}
                    ${h4 ? sql`AND w.fecha <= ${h4}::date` : sql``}
                    ORDER BY w.fecha DESC
                    LIMIT 500
                `;
                htmlContent = trabajosToHtml(data);
                csvColumns = [
                    { key: 'fecha', header: 'Fecha' },
                    { key: 'cliente_nombre', header: 'Cliente' },
                    { key: 'empleado_nombre', header: 'Empleado' },
                    { key: 'descripcion', header: 'Descripción' },
                    { key: 'minutos', header: 'Minutos' }
                ];
                break;

            case 'sospechosos':
                data = await sql`
                    SELECT f.*, e.nombre as nombre_empleado
                    FROM fichajes_180 f
                    JOIN employees_180 e ON f.empleado_id = e.id
                    WHERE f.empresa_id = ${empresaId}
                    AND f.sospechoso = true
                    AND (f.estado IS NULL OR f.estado = 'pendiente') -- Solo pendientes
                    ORDER BY f.fecha DESC
                `;
                htmlContent = sospechososToHtml(data);
                csvColumns = [
                    { key: 'fecha', header: 'Fecha' },
                    { key: 'nombre_empleado', header: 'Empleado' },
                    { key: 'tipo', header: 'Tipo' },
                    { key: 'sospecha_motivo', header: 'Motivo' }
                ];
                break;

            case 'facturas':
                const fYear = queryParams.year || new Date().getFullYear();
                const fEstado = queryParams.estado; // Opcional

                data = await sql`
                    SELECT f.*, c.nombre as cliente_nombre
                    FROM factura_180 f
                    LEFT JOIN clients_180 c ON f.cliente_id = c.id
                    WHERE f.empresa_id = ${empresaId}
                    AND EXTRACT(YEAR FROM f.fecha) = ${fYear}
                    ${fEstado && fEstado !== 'TODOS' ? sql`AND f.estado = ${fEstado}` : sql``}
                    ORDER BY f.fecha DESC, f.numero DESC
                `;
                htmlContent = facturasToHtml(data);
                csvColumns = [
                    { key: 'numero', header: 'Nº Factura' },
                    { key: 'fecha', header: 'Fecha' },
                    { key: 'cliente_nombre', header: 'Cliente' },
                    { key: 'subtotal', header: 'Base Imponible' },
                    { key: 'iva_total', header: 'IVA' },
                    { key: 'total', header: 'Total' },
                    { key: 'estado', header: 'Estado' }
                ];
                filename = `facturas-${fYear}${fEstado ? '-' + fEstado : ''}`;
                break;

            case 'iva-trimestral':
                const iYear = queryParams.year || new Date().getFullYear();
                const iTrim = queryParams.trimestre;

                if (!iTrim) throw new Error("Trimestre requerido para exportar IVA");

                const mapTrimestre = {
                    1: [1, 3], 2: [4, 6], 3: [7, 9], 4: [10, 12]
                };
                const range = mapTrimestre[parseInt(iTrim)];

                data = await sql`
                    SELECT 
                        l.iva_percent as tipo_iva,
                        COUNT(DISTINCT f.id) as num_facturas,
                        SUM(l.cantidad * l.precio_unitario) as base_imponible,
                        SUM(l.total - (l.cantidad * l.precio_unitario)) as cuota_iva,
                        SUM(l.total) as total_facturado
                    FROM factura_180 f
                    JOIN lineafactura_180 l ON l.factura_id = f.id
                    WHERE f.empresa_id = ${empresaId}
                        AND f.estado IN ('VALIDADA', 'ANULADA')
                        AND EXTRACT(YEAR FROM f.fecha) = ${iYear}
                        AND EXTRACT(MONTH FROM f.fecha) >= ${range[0]}
                        AND EXTRACT(MONTH FROM f.fecha) <= ${range[1]}
                    GROUP BY l.iva_percent
                    ORDER BY l.iva_percent ASC
                `;
                htmlContent = ivaTrimestralToHtml(data, { year: iYear, trimestre: iTrim });
                csvColumns = [
                    { key: 'tipo_iva', header: 'Tipo IVA' },
                    { key: 'num_facturas', header: 'Nº Operaciones' },
                    { key: 'base_imponible', header: 'Base' },
                    { key: 'cuota_iva', header: 'Cuota' },
                    { key: 'total_facturado', header: 'Total' }
                ];
                filename = `iva-${iYear}-T${iTrim}`;
                break;

            default:
                throw new Error("Módulo desconocido: " + module);
        }

        // Generar salida
        if (format === 'pdf') {
            try {
                const buffer = await generatePdf(htmlContent);
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
                res.setHeader('Content-Length', buffer.length);
                return res.end(buffer);
            } catch (pdfErr) {
                console.error("PDF Generate Error:", pdfErr);
                // Fallback a HTML si falla PDF (Render issue) o devolver JSON error
                // Importante: Devolver el mensaje real para que el frontend pueda mostrarlo
                throw new Error("PDF Error: " + (pdfErr.message || "Error desconocido"));
            }
        } else if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
            return res.send('\ufeff' + generateCsv(data, csvColumns));
        } else if (format === 'html') {
            res.setHeader('Content-Type', 'text/html');
            return res.send(htmlContent);
        } else {
            throw new Error("Formato no soportado");
        }

    } catch (err) {
        console.error("error en export:", err);
        if (!res.headersSent) {
            res.status(500).json({ error: `Error export: ${err.message}` });
        }
    }
};
