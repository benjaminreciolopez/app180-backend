
const BASE_STYLES = `
    <style>
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; line-height: 1.4; padding: 0; margin: 0; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #eee; padding-bottom: 20px; }
        .header h1 { margin: 0; color: #111; font-size: 24px; text-transform: uppercase; letter-spacing: 1px; }
        .header p { margin: 5px 0 0; color: #666; font-size: 14px; }
        .meta { margin-bottom: 20px; font-size: 12px; color: #555; display: flex; justify-content: space-between; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
        th { background-color: #f4f4f4; color: #333; font-weight: bold; text-align: left; padding: 10px; border-bottom: 2px solid #ddd; }
        td { padding: 10px; border-bottom: 1px solid #eee; }
        tr:nth-child(even) { background-color: #fafafa; }
        
        /* Utility classes */
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .text-green { color: #16a34a; } /* green-600 */
        .text-red { color: #dc2626; } /* red-600 */
        .text-blue { color: #2563eb; } /* blue-600 */
        .font-bold { font-weight: bold; }
        
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
        <p>App180 - Sistema de Gestión</p>
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
            <p><strong>Criterio de colores:</strong></p>
            <ul style="list-style: none; padding: 0;">
                <li><span class="text-green">●</span> Verde (Ahorro): Tiempo real es menor al planificado (diferencia < -30min).</li>
                <li><span class="text-red">●</span> Rojo (Exceso): Tiempo real excede al planificado (diferencia > 30min).</li>
                <li><span class="text-blue">●</span> Azul (Neutro): Dentro del margen de tolerancia (±30min).</li>
            </ul>
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

    return wrapHtml('Listado de Empleados', content, `
        <span><strong>Total Empleados:</strong> ${data.length}</span>
    `);
};
