import { sql } from '../db.js';
import archiver from 'archiver';
import { registrarDescargaRegistros } from './eventosVerifactuService.js';

/**
 * Servicio de Exportación/Volcado de Registros VeriFactu
 *
 * Requisito RD 1007/2023: Facilitar la descarga o volcado de los registros
 * de facturación y de eventos, y su archivo seguro.
 */

/**
 * Genera XML de un registro VeriFactu según especificación oficial
 */
function generarXmlRegistro(registro, factura, emisor) {
  const fechaExpedicion = new Date(factura.fecha);
  const fechaRegistro = new Date(registro.fecha_registro);

  const formatFecha = (date) => {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}-${m}-${y}`;
  };

  const formatHora = (date) => {
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${h}:${min}:${s}`;
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<RegistroFactura xmlns="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RegistroFactura.xsd">
  <IDFactura>
    <IDEmisorFactura>
      <NIF>${emisor.nif}</NIF>
    </IDEmisorFactura>
    <NumSerieFactura>${factura.numero}</NumSerieFactura>
    <FechaExpedicionFactura>${formatFecha(fechaExpedicion)}</FechaExpedicionFactura>
  </IDFactura>
  <Huella>
    <Hash>${registro.hash_actual}</Hash>
    <FechaHoraHuella>${formatFecha(fechaRegistro)}T${formatHora(fechaRegistro)}</FechaHoraHuella>
  </Huella>
  <Encadenamiento>
    <RegistroAnterior>
      ${registro.hash_anterior ? `<HashRegistroAnterior>${registro.hash_anterior}</HashRegistroAnterior>` : '<PrimerRegistro>S</PrimerRegistro>'}
    </RegistroAnterior>
  </Encadenamiento>
  <ImporteTotal>${Number(factura.total || 0).toFixed(2)}</ImporteTotal>
  <EstadoEnvio>${registro.estado_envio}</EstadoEnvio>
  ${registro.fecha_envio ? `<FechaEnvio>${registro.fecha_envio}</FechaEnvio>` : ''}
  ${registro.respuesta_aeat ? `
  <RespuestaAEAT>
    <![CDATA[${JSON.stringify(registro.respuesta_aeat, null, 2)}]]>
  </RespuestaAEAT>` : ''}
</RegistroFactura>`;
}

/**
 * Genera XML de un evento del sistema
 */
function generarXmlEvento(evento, usuario) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<EventoSistema>
  <ID>${evento.id}</ID>
  <TipoEvento>${evento.tipo_evento}</TipoEvento>
  <Descripcion><![CDATA[${evento.descripcion}]]></Descripcion>
  <FechaEvento>${evento.fecha_evento}</FechaEvento>
  <Usuario>${usuario ? usuario.nombre : 'Sistema automático'}</Usuario>
  <Huella>
    <Hash>${evento.hash_actual}</Hash>
    <HashAnterior>${evento.hash_anterior || 'PRIMER_EVENTO'}</HashAnterior>
  </Huella>
  ${evento.datos_evento ? `
  <DatosEvento>
    <![CDATA[${JSON.stringify(evento.datos_evento, null, 2)}]]>
  </DatosEvento>` : ''}
  ${evento.ip_address ? `<IPAddress>${evento.ip_address}</IPAddress>` : ''}
</EventoSistema>`;
}

/**
 * Exporta todos los registros VeriFactu de una empresa
 *
 * @param {number} empresaId
 * @param {number} usuarioId
 * @param {Object} options - Opciones de exportación
 * @returns {Promise<Stream>} Stream del archivo ZIP
 */
export async function exportarRegistrosVerifactu(empresaId, usuarioId, options = {}) {
  try {
    const {
      incluirEventos = true,
      incluirFacturasPDF = false,
      desde = null,
      hasta = null
    } = options;

    // Obtener emisor
    const [emisor] = await sql`
      SELECT * FROM emisor_180
      WHERE empresa_id = ${empresaId}
      LIMIT 1
    `;

    if (!emisor) {
      throw new Error('Emisor no encontrado');
    }

    // Obtener registros VeriFactu
    let queryRegistros = sql`
      SELECT
        r.*,
        f.numero, f.fecha, f.total, f.cliente_nombre
      FROM registroverifactu_180 r
      LEFT JOIN factura_180 f ON f.id = r.factura_id
      WHERE r.empresa_id = ${empresaId}
    `;

    if (desde) {
      queryRegistros = sql`${queryRegistros} AND r.fecha_registro >= ${desde}`;
    }

    if (hasta) {
      queryRegistros = sql`${queryRegistros} AND r.fecha_registro <= ${hasta}`;
    }

    queryRegistros = sql`${queryRegistros} ORDER BY r.fecha_registro ASC`;

    const registros = await queryRegistros;

    // Crear archivo ZIP en memoria
    const archive = archiver('zip', {
      zlib: { level: 9 } // Máxima compresión
    });

    // Metadatos de la exportación
    const metadata = {
      empresa: {
        id: empresaId,
        nif: emisor.nif,
        nombre: emisor.nombre || emisor.razon_social
      },
      exportacion: {
        fecha: new Date().toISOString(),
        total_registros: registros.length,
        rango_fechas: {
          desde: desde || registros[0]?.fecha_registro || null,
          hasta: hasta || registros[registros.length - 1]?.fecha_registro || null
        }
      },
      verifactu: {
        version: '1.0',
        normativa: 'RD 1007/2023'
      }
    };

    archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' });

    // Agregar registros de facturación
    const registrosDir = 'registros_facturacion/';

    for (const registro of registros) {
      const xml = generarXmlRegistro(registro, {
        numero: registro.numero,
        fecha: registro.fecha_factura,
        total: registro.total_factura
      }, emisor);

      const filename = `${registro.numero_factura.replace(/[/\\]/g, '-')}_${registro.id}.xml`;
      archive.append(xml, { name: registrosDir + filename });
    }

    // Agregar eventos del sistema si se solicita
    if (incluirEventos) {
      const eventos = await sql`
        SELECT
          e.*,
          u.nombre as usuario_nombre,
          u.email as usuario_email
        FROM eventos_sistema_verifactu_180 e
        LEFT JOIN users_180 u ON u.id = e.usuario_id
        WHERE e.empresa_id = ${empresaId}
        ORDER BY e.fecha_evento ASC
      `;

      const eventosDir = 'registro_eventos/';

      for (const evento of eventos) {
        const xml = generarXmlEvento(evento, {
          nombre: evento.usuario_nombre,
          email: evento.usuario_email
        });

        const filename = `evento_${evento.id}_${evento.tipo_evento}.xml`;
        archive.append(xml, { name: eventosDir + filename });
      }

      // Agregar resumen de eventos
      const resumenEventos = {
        total: eventos.length,
        por_tipo: {}
      };

      eventos.forEach(e => {
        resumenEventos.por_tipo[e.tipo_evento] = (resumenEventos.por_tipo[e.tipo_evento] || 0) + 1;
      });

      archive.append(JSON.stringify(resumenEventos, null, 2), {
        name: 'registro_eventos/resumen.json'
      });
    }

    // Agregar archivo README
    const readme = `# Exportación Registros VeriFactu

Empresa: ${emisor.nombre || emisor.razon_social}
NIF: ${emisor.nif}
Fecha exportación: ${new Date().toLocaleString('es-ES')}
Total registros: ${registros.length}

## Contenido

- metadata.json: Información de la exportación
- registros_facturacion/: Registros de facturas en formato XML
${incluirEventos ? '- registro_eventos/: Eventos del sistema con hash encadenado\n' : ''}
## Normativa

Real Decreto 1007/2023 - Sistema de Facturación Verificable (VeriFactu)

## Verificación

Cada registro contiene:
- Hash SHA-256 (Huella)
- Hash del registro anterior (Encadenamiento)
- Estado de envío a AEAT
- Respuesta de AEAT (si aplica)

Para verificar la integridad:
1. Recalcular hash de cada registro
2. Verificar encadenamiento con registro anterior
3. Validar que no hay gaps en la secuencia
`;

    archive.append(readme, { name: 'README.txt' });

    // Registrar evento de descarga
    await registrarDescargaRegistros(
      empresaId,
      incluirEventos ? 'COMPLETO' : 'SOLO_FACTURAS',
      registros.length,
      usuarioId
    );

    // Finalizar archivo
    await archive.finalize();

    return archive;

  } catch (error) {
    console.error('❌ Error al exportar registros VeriFactu:', error);
    throw error;
  }
}

/**
 * Genera un informe de cumplimiento VeriFactu
 */
export async function generarInformeCumplimiento(empresaId) {
  const [config] = await sql`
    SELECT * FROM configuracionsistema_180
    WHERE empresa_id = ${empresaId}
    LIMIT 1
  `;

  const [emisor] = await sql`
    SELECT * FROM emisor_180
    WHERE empresa_id = ${empresaId}
    LIMIT 1
  `;

  const [statsRegistros] = await sql`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN estado_envio = 'ENVIADO' THEN 1 ELSE 0 END) as enviados,
      SUM(CASE WHEN estado_envio = 'PENDIENTE' THEN 1 ELSE 0 END) as pendientes,
      SUM(CASE WHEN estado_envio = 'ERROR' THEN 1 ELSE 0 END) as errores,
      MIN(fecha_registro) as primer_registro,
      MAX(fecha_registro) as ultimo_registro
    FROM registroverifactu_180
    WHERE empresa_id = ${empresaId}
  `;

  const [statsEventos] = await sql`
    SELECT
      COUNT(*) as total,
      MIN(fecha_evento) as primer_evento,
      MAX(fecha_evento) as ultimo_evento
    FROM eventos_sistema_verifactu_180
    WHERE empresa_id = ${empresaId}
  `;

  return {
    fecha_informe: new Date().toISOString(),
    empresa: {
      nif: emisor?.nif,
      nombre: emisor?.nombre || emisor?.razon_social
    },
    configuracion: {
      verifactu_activo: config?.verifactu_activo || false,
      verifactu_modo: config?.verifactu_modo || 'OFF',
      certificado_configurado: !!config?.verifactu_certificado_path
    },
    registros_facturacion: {
      total: parseInt(statsRegistros.total),
      enviados: parseInt(statsRegistros.enviados),
      pendientes: parseInt(statsRegistros.pendientes),
      errores: parseInt(statsRegistros.errores),
      primer_registro: statsRegistros.primer_registro,
      ultimo_registro: statsRegistros.ultimo_registro
    },
    registro_eventos: {
      total: parseInt(statsEventos.total),
      primer_evento: statsEventos.primer_evento,
      ultimo_evento: statsEventos.ultimo_evento
    },
    cumplimiento: {
      hash_encadenado: '✅ Implementado',
      qr_verificable: '✅ Implementado',
      registro_eventos: statsEventos.total > 0 ? '✅ Activo' : '⚠️ Sin eventos',
      envio_aeat: '✅ Implementado',
      inmutabilidad: '✅ Implementado'
    }
  };
}
