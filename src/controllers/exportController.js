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
    sospechososToHtml
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

        console.log(`⬇️ Export Request: Module=${module}, Format=${format}`);

        let data = [];
        let htmlContent = '';
        let csvColumns = [];
        let filename = `export-${module}-${Date.now()}`;

        // Selector de Módulo
        switch (module) {
            case 'rentabilidad':
                const { desde: d1, hasta: h1, empleado_id: eid1 } = queryParams;
                if (!d1 || !h1) throw new Error("Faltan fechas");
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
                data = await sql`SELECT id, nombre, email, telefono, activo, pin_acceso as pin FROM employees_180 WHERE empresa_id = ${empresaId} ORDER BY nombre`;
                htmlContent = empleadosToHtml(data);
                csvColumns = [
                    { key: 'nombre', header: 'Nombre' },
                    { key: 'email', header: 'Email' },
                    { key: 'telefono', header: 'Tel' },
                    { key: 'activo', header: 'Activo' }
                ];
                break;

            case 'auditoria':
                const { fecha_desde, fecha_hasta, accion } = queryParams;
                data = await sql`
                    SELECT a.*, COALESCE(u.nombre, 'Sistema') as actor_nombre 
                    FROM audit_log_180 a
                    LEFT JOIN users_180 u ON a.actor_id = u.id
                    WHERE a.empresa_id = ${empresaId}
                    ${fecha_desde ? sql`AND a.created_at >= ${fecha_desde}::date` : sql``}
                    ${fecha_hasta ? sql`AND a.created_at <= ${fecha_hasta}::date + interval '1 day'` : sql``}
                    ${accion ? sql`AND a.action = ${accion}` : sql``}
                    ORDER BY a.created_at DESC
                    LIMIT 500
                `; 
                htmlContent = auditoriaToHtml(data);
                csvColumns = [
                    { key: 'created_at', header: 'Fecha' },
                    { key: 'actor_nombre', header: 'Usuario' },
                    { key: 'action', header: 'Acción' },
                    { key: 'entity', header: 'Entidad' },
                    { key: 'details', header: 'Detalles' }
                ];
                break;

            case 'clientes':
                data = await sql`
                    SELECT * FROM clients_180 WHERE empresa_id = ${empresaId} ORDER BY nombre
                `;
                htmlContent = clientesToHtml(data);
                csvColumns = [
                    { key: 'nombre', header: 'Cliente' },
                    { key: 'codigo', header: 'Código' },
                    { key: 'cif', header: 'CIF' },
                    { key: 'contacto_nombre', header: 'Contacto' }
                ];
                break;

            case 'fichajes':
                // Filtros opcionales
                const { desde: d2, hasta: h2, empleado_id: eid2 } = queryParams;
                data = await sql`
                    SELECT j.*, e.nombre as empleado_nombre
                    FROM jornadas_180 j
                    JOIN employees_180 e ON j.empleado_id = e.id
                    WHERE j.empresa_id = ${empresaId}
                    ${d2 ? sql`AND j.fecha >= ${d2}::date` : sql``}
                    ${h2 ? sql`AND j.fecha <= ${h2}::date` : sql``}
                    ${(eid2 && eid2!=='null' && eid2!=='undefined') ? sql`AND j.empleado_id = ${eid2}` : sql``}
                    ORDER BY j.fecha DESC, e.nombre
                    LIMIT 500
                `;
                htmlContent = fichajesToHtml(data);
                csvColumns = [
                    { key: 'fecha', header: 'Fecha' },
                    { key: 'empleado_nombre', header: 'Empleado' },
                    { key: 'inicio', header: 'Inicio' },
                    { key: 'fin', header: 'Fin' },
                    { key: 'estado', header: 'Estado' }
                ];
                break;

            case 'cobros':
                const { desde: d3, hasta: h3 } = queryParams;
                data = await sql`
                    SELECT p.*, c.nombre as cliente_nombre
                    FROM payments_180 p
                    LEFT JOIN clients_180 c ON p.client_id = c.id
                    WHERE p.empresa_id = ${empresaId}
                    ${d3 ? sql`AND p.date >= ${d3}::date` : sql``}
                    ${h3 ? sql`AND p.date <= ${h3}::date` : sql``}
                    ORDER BY p.date DESC
                    LIMIT 500
                `;
                htmlContent = cobrosToHtml(data);
                csvColumns = [
                    { key: 'date', header: 'Fecha' },
                    { key: 'cliente_nombre', header: 'Cliente' },
                    { key: 'concept', header: 'Concepto' },
                    { key: 'amount', header: 'Importe' },
                    { key: 'status', header: 'Estado' }
                ];
                break;
            
            case 'trabajos':
                 const { desde: d4, hasta: h4 } = queryParams;
                 data = await sql`
                    SELECT w.*, c.nombre as cliente_nombre, e.nombre as empleado_nombre
                    FROM work_logs_180 w
                    LEFT JOIN clients_180 c ON w.client_id = c.id
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
                     { key: 'horas', header: 'Duración' }
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

            default:
                throw new Error("Módulo desconocido: " + module);
        }

        // Generar
        if (format === 'pdf') {
            const buffer = await generatePdf(htmlContent);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
            return res.send(buffer);
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
        if (!res.headersSent) res.status(500).send(`Error export: ${err.message}`);
    }
};
