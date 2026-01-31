import { sql } from "../db.js";
import { getEmpresaIdAdminOrThrow } from "../services/authService.js";
import { generatePdf, generateCsv } from "../services/exportService.js";
import { calcularReporteRentabilidad } from "../services/reportesService.js";
import { rentabilidadToHtml, empleadosToHtml } from "../templates/exportTemplates.js";
import { handleErr } from "../utils/errorHandler.js";

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
                const { desde, hasta, empleado_id } = queryParams;
                if (!desde || !hasta) throw new Error("Faltan fechas desde/hasta");
                
                // 1. Fetch Data
                data = await calcularReporteRentabilidad(empresaId, desde, hasta, empleado_id);
                
                // 2. Prepare HTML
                htmlContent = rentabilidadToHtml(data, { desde, hasta });
                
                // 3. Prepare CSV Columns
                csvColumns = [
                    { key: 'empleado.nombre', header: 'Empleado' },
                    { key: 'horas_plan', header: 'Horas Planificadas' },
                    { key: 'horas_real', header: 'Horas Reales' },
                    { key: 'diferencia', header: 'Diferencia (min)' },
                    { key: 'estado', header: 'Estado' }
                ];
                filename = `rentabilidad-${desde}-${hasta}`;
                break;

            case 'empleados':
                // 1. Fetch Data
                data = await sql`
                    SELECT id, nombre, email, telefono, activo, pin_acceso as pin
                    FROM employees_180
                    WHERE empresa_id = ${empresaId}
                    ORDER BY nombre ASC
                `;

                // 2. Prepare HTML
                htmlContent = empleadosToHtml(data);

                // 3. Prepare CSV Columns
                csvColumns = [
                    { key: 'nombre', header: 'Nombre Completo' },
                    { key: 'email', header: 'Email' },
                    { key: 'telefono', header: 'Teléfono' },
                    { key: 'activo', header: 'Activo' },
                    { key: 'pin', header: 'PIN (Encriptado/Hash)' }
                ];
                filename = `listado-empleados-${new Date().toISOString().slice(0,10)}`;
                break;
            
            default:
                throw new Error("Módulo de exportación no válido o no implementado");
        }

        // Generar Archivo según formato
        if (format === 'pdf') {
            const buffer = await generatePdf(htmlContent);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
            return res.send(buffer);

        } else if (format === 'csv') {
            const csv = generateCsv(data, csvColumns);
            // Agregar BOM para Excel
            const bom = '\ufeff';
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
            return res.send(bom + csv);

        } else if (format === 'html') {
            res.setHeader('Content-Type', 'text/html');
            return res.send(htmlContent);

        } else {
            throw new Error("Formato no soportado");
        }

    } catch (err) {
        console.error("error en export:", err);
        // Si es una petición de descarga directa, quizá queramos mostrar un error visual o un simple texto
        if (!res.headersSent) {
             res.status(500).send(`Error generando exportación: ${err.message}`);
        }
    }
};
