
const BASE_STYLES = `
    <style>
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; line-height: 1.4; padding: 0; margin: 0; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #eee; padding-bottom: 20px; }
        .header h1 { margin: 0; color: #111; font-size: 24px; text-transform: uppercase; letter-spacing: 1px; }
        .header p { margin: 5px 0 0; color: #666; font-size: 14px; }
        .meta { margin-bottom: 20px; font-size: 12px; color: #555; display: flex; justify-content: space-between; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
        th { background-color: #f4f4f4; color: #333; font-weight: bold; text-align: left; padding: 8px; border-bottom: 2px solid #ddd; }
        td { padding: 8px; border-bottom: 1px solid #eee; }
        tr:nth-child(even) { background-color: #fafafa; }
        
        /* Utility classes */
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .text-green { color: #16a34a; }
        .text-red { color: #dc2626; }
        .text-blue { color: #2563eb; }
        .text-gray { color: #6b7280; }
        .font-bold { font-weight: bold; }
        .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; }
        .badge-green { background: #dcfce7; color: #166534; }
        .badge-red { background: #fee2e2; color: #991b1b; }
        .badge-gray { background: #f3f4f6; color: #374151; }
        
        .footer { position: fixed; bottom: 0; width: 100%; text-align: center; font-size: 10px; color: #999; padding: 10px 0; border-top: 1px solid #eee; }
    </style>
`;

const wrapHtml = (title, content, metaInfo = '') => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    ${BASE_STYLES}
</head>
<body>
    <div class="header">
        <h1>${title}</h1>
        <p>CONTENDO GESTIONES - Sistema de Gestión</p>
    </div>
    
    ${metaInfo ? `<div class="meta">${metaInfo}</div>` : ''}

    <div class="content">
        ${content}
    </div>

    <div class="footer">
        Generado el ${new Date().toLocaleString('es-ES')}
    </div>
</body>
</html>
`;

export const rentabilidadToHtml = (data, { desde, hasta }) => {
    const rows = data.map(item => {
        let colorClass = 'text-blue';
        if (item.estado === 'ahorro') colorClass = 'text-green';
        if (item.estado === 'exceso') colorClass = 'text-red';

        return `
        <tr>
            <td><strong>${item.empleado.nombre}</strong></td>
            <td class="text-center">${item.horas_plan} h</td>
            <td class="text-center">${item.horas_real} h</td>
            <td class="text-right ${colorClass} font-bold">
                ${item.diferencia > 0 ? '+' : ''}${item.diferencia} min
            </td>
        </tr>
        `;
    }).join('');

    const content = `
        <table>
            <thead>
                <tr>
                    <th>Empleado</th>
                    <th class="text-center">Planificado</th>
                    <th class="text-center">Real</th>
                    <th class="text-right">Desviación</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
        <div style="margin-top: 20px; font-size: 11px; color: #666;">
            <p><strong>Criterio:</strong> <span class="text-green">Verde (Ahorro)</span> | <span class="text-red">Rojo (Exceso)</span> | <span class="text-blue">Azul (Neutro)</span></p>
        </div>
    `;

    return wrapHtml('Reporte de Rentabilidad', content, `
        <span><strong>Periodo:</strong> ${desde} a ${hasta}</span>
        <span><strong>Registros:</strong> ${data.length}</span>
    `);
};

export const empleadosToHtml = (data) => {
    const rows = data.map(item => `
        <tr>
            <td><strong>${item.nombre}</strong></td>
            <td>${item.email || '-'}</td>
            <td>${item.telefono || '-'}</td>
            <td class="text-center">
                ${item.activo ? '<span class="text-green">Activo</span>' : '<span class="text-red">Inactivo</span>'}
            </td>
            <td>${item.pin ? '******' : 'Sin PIN'}</td>
        </tr>
    `).join('');

    const content = `
        <table>
            <thead>
                <tr>
                    <th>Nombre</th>
                    <th>Email</th>
                    <th>Teléfono</th>
                    <th class="text-center">Estado</th>
                    <th>Seguridad</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
    `;

    return wrapHtml('Listado de Empleados', content, `<span>Total: ${data.length}</span>`);
};

export const auditoriaToHtml = (data) => {
    const rows = data.map(item => `
        <tr>
            <td>${new Date(item.created_at).toLocaleString('es-ES')}</td>
            <td><strong>${item.actor_nombre || 'Sistema'}</strong></td>
            <td>${item.action}</td>
            <td>${item.entity}</td>
            <td class="text-gray">${item.details || '-'}</td>
        </tr>
    `).join('');

    const content = `
        <table>
            <thead>
                <tr>
                    <th>Fecha</th>
                    <th>Usuario</th>
                    <th>Acción</th>
                    <th>Entidad</th>
                    <th>Detalles</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
    return wrapHtml('Reporte de Auditoría', content);
};

export const clientesToHtml = (data) => {
    const rows = data.map(item => `
        <tr>
            <td><strong>${item.nombre}</strong></td>
            <td>${item.codigo || '-'}</td>
            <td>${item.cif || '-'}</td>
            <td>${item.contacto_nombre || '-'}</td>
            <td>${item.email || '-'}</td>
            <td class="text-center">${item.activo ? 'Sí' : 'No'}</td>
        </tr>
    `).join('');

    const content = `
         <table>
            <thead>
                <tr>
                    <th>Nombre Fiscal</th>
                    <th>Código</th>
                    <th>CIF/NIF</th>
                    <th>Contacto</th>
                    <th>Email</th>
                    <th>Activo</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
    return wrapHtml('Listado de Clientes', content);
};

export const fichajesToHtml = (data) => {
    const rows = data.map(item => {
        let estadoLabel = `<span class="badge badge-gray">${item.estado}</span>`;
        if (item.estado === 'completa') estadoLabel = `<span class="badge badge-green">Completa</span>`;
        if (item.estado === 'abierta') estadoLabel = `<span class="badge badge-gray">En curso</span>`;

        return `
        <tr>
            <td>${new Date(item.fecha).toLocaleDateString('es-ES')}</td>
            <td><strong>${item.empleado_nombre}</strong></td>
            <td class="text-center">${item.inicio || '-'}</td>
            <td class="text-center">${item.fin || '-'}</td>
            <td class="text-center">${item.minutos_trabajados ? (item.minutos_trabajados / 60).toFixed(2) + 'h' : '-'}</td>
            <td class="text-center">${estadoLabel}</td>
        </tr>
    `}).join('');

    const content = `
        <table>
            <thead>
                <tr>
                    <th>Fecha</th>
                    <th>Empleado</th>
                    <th class="text-center">Inicio</th>
                    <th class="text-center">Fin</th>
                    <th class="text-center">Horas</th>
                    <th class="text-center">Estado</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
    return wrapHtml('Reporte de Jornadas', content);
};

export const cobrosToHtml = (data) => {
    const rows = data.map(item => `
        <tr>
            <td>${new Date(item.fecha_pago || item.created_at).toLocaleDateString()}</td>
            <td><strong>${item.cliente_nombre || '-'}</strong></td>
            <td>${item.referencia || item.metodo || 'Pago'}</td>
            <td class="text-right">${Number(item.importe).toFixed(2)} €</td>
            <td class="text-center">Completado</td>
        </tr>
    `).join('');

    const content = `
        <table>
            <thead>
                <tr>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th>Concepto</th>
                    <th class="text-right">Importe</th>
                    <th class="text-center">Estado</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
    return wrapHtml('Control de Cobros', content);
};

export const trabajosToHtml = (data) => {
    const rows = data.map(item => `
       <tr>
           <td>${new Date(item.fecha || item.created_at).toLocaleDateString()}</td>
           <td><strong>${item.cliente_nombre || '-'}</strong></td>
           <td>${item.empleado_nombre || '-'}</td>
           <td>${item.descripcion || '-'}</td>
           <td class="text-center">${item.minutos ? (item.minutos / 60).toFixed(2) + 'h' : '-'}</td>
       </tr>
   `).join('');

    const content = `
       <table>
           <thead>
               <tr>
                   <th>Fecha</th>
                   <th>Cliente</th>
                   <th>Empleado</th>
                   <th>Descripción</th>
                   <th class="text-center">Duración</th>
               </tr>
           </thead>
           <tbody>${rows}</tbody>
       </table>
   `;
    return wrapHtml('Partes de Trabajo', content);
};

export const sospechososToHtml = (data) => {
    const rows = data.map(item => `
       <tr>
           <td>${new Date(item.fecha).toLocaleString()}</td>
           <td><strong>${item.nombre_empleado || '-'}</strong></td>
           <td>${item.tipo || '-'}</td>
           <td>${item.sospecha_motivo || (item.geo_motivos || []).join(', ') || 'Desconocido'}</td>
           <td class="text-right">${item.distancia_km ? (item.distancia_km * 1000).toFixed(0) + ' m' : '-'}</td>
       </tr>
   `).join('');

    const content = `
       <table>
           <thead>
               <tr>
                   <th>Fecha</th>
                   <th>Empleado</th>
                   <th>Tipo</th>
                   <th>Motivo(s)</th>
                   <th class="text-right">Desviación</th>
               </tr>
           </thead>
           <tbody>${rows}</tbody>
       </table>
   `;
    return wrapHtml('Fichajes Sospechosos', content);
};

export const partesDiaToHtml = (data) => {
    const rows = data.map(item => {
        let estadoBadge = '';
        switch (item.estado) {
            case 'completo': estadoBadge = '<span class="badge badge-green">Completado</span>'; break;
            case 'incidencia': estadoBadge = '<span class="badge badge-red">Incidencia</span>'; break;
            default: estadoBadge = `<span class="badge badge-gray">${item.estado}</span>`;
        }

        return `
        <tr>
           <td><strong>${item.empleado_nombre}</strong></td>
           <td>${item.cliente_nombre || '-'}</td>
           <td class="text-center font-mono">${item.horas_trabajadas != null ? item.horas_trabajadas + ' h' : '-'}</td>
           <td class="text-center">${estadoBadge}</td>
           <td>${item.resumen || '-'}</td>
           <td class="text-center">${item.validado ? '<span class="text-green">✓</span>' : item.validado === false ? '<span class="text-red">⚠</span>' : '-'}</td>
       </tr>
       `;
    }).join('');

    const content = `
        <table>
            <thead>
                <tr>
                    <th>Empleado</th>
                    <th>Cliente</th>
                    <th class="text-center">Horas</th>
                    <th class="text-center">Estado</th>
                    <th>Resumen</th>
                    <th class="text-center">Rev.</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
    return wrapHtml('Resumen Partes del Día', content);
};

export const facturasToHtml = (data) => {
    const rows = data.map(item => `
        <tr>
            <td>${item.numero || 'Borrador'}</td>
            <td>${new Date(item.fecha).toLocaleDateString('es-ES')}</td>
            <td><strong>${item.cliente_nombre || '-'}</strong></td>
            <td class="text-right">${Number(item.subtotal).toFixed(2)} €</td>
            <td class="text-right">${Number(item.iva_total).toFixed(2)} €</td>
            <td class="text-right font-bold">${Number(item.total).toFixed(2)} €</td>
            <td class="text-center">${item.estado}</td>
        </tr>
    `).join('');

    const totales = data.reduce((acc, f) => ({
        base: acc.base + Number(f.subtotal),
        iva: acc.iva + Number(f.iva_total),
        total: acc.total + Number(f.total)
    }), { base: 0, iva: 0, total: 0 });

    const content = `
        <table>
            <thead>
                <tr>
                    <th>Nº Factura</th>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th class="text-right">Base Imponible</th>
                    <th class="text-right">IVA</th>
                    <th class="text-right">Total</th>
                    <th class="text-center">Estado</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
            <tfoot>
                <tr style="background-color: #f9fafb; font-weight: bold;">
                    <td colspan="3" class="text-right">TOTALES:</td>
                    <td class="text-right">${totales.base.toFixed(2)} €</td>
                    <td class="text-right">${totales.iva.toFixed(2)} €</td>
                    <td class="text-right">${totales.total.toFixed(2)} €</td>
                    <td></td>
                </tr>
            </tfoot>
        </table>
    `;
    return wrapHtml('Listado de Facturas', content, `<span>Total facturas: ${data.length}</span>`);
};

export const ivaTrimestralToHtml = (data, { year, trimestre }) => {
    const rows = data.map(item => `
        <tr>
            <td class="text-center">${item.tipo_iva}%</td>
            <td class="text-center">${item.num_facturas}</td>
            <td class="text-right">${Number(item.base_imponible).toFixed(2)} €</td>
            <td class="text-right">${Number(item.cuota_iva).toFixed(2)} €</td>
            <td class="text-right font-bold">${Number(item.total_facturado).toFixed(2)} €</td>
        </tr>
    `).join('');

    const totales = data.reduce((acc, row) => ({
        base: acc.base + parseFloat(row.base_imponible || 0),
        cuota: acc.cuota + parseFloat(row.cuota_iva || 0),
        total: acc.total + parseFloat(row.total_facturado || 0)
    }), { base: 0, cuota: 0, total: 0 });

    const content = `
        <table>
            <thead>
                <tr>
                    <th class="text-center">Tipo IVA</th>
                    <th class="text-center">Nº Operaciones</th>
                    <th class="text-right">Base Imponible</th>
                    <th class="text-right">Cuota IVA</th>
                    <th class="text-right">Total</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
            <tfoot>
                <tr style="background-color: #f9fafb; font-weight: bold;">
                    <td colspan="2" class="text-right">TOTALES:</td>
                    <td class="text-right">${totales.base.toFixed(2)} €</td>
                    <td class="text-right">${totales.cuota.toFixed(2)} €</td>
                    <td class="text-right">${totales.total.toFixed(2)} €</td>
                </tr>
            </tfoot>
        </table>
    `;

    return wrapHtml(`Informe IVA ${trimestre ? 'T' + trimestre : 'Anual'} - ${year}`, content);
};
