import https from 'https';
import forge from 'node-forge';
import { sql } from '../db.js';

/**
 * Servicio SII (Suministro Inmediato de Información)
 *
 * Obligatorio para empresas con facturación >6M€ y acogidas al REDEME.
 * Envío de facturas en tiempo real a la AEAT (plazo: 4 días).
 *
 * Documentación oficial:
 * https://sede.agenciatributaria.gob.es/Sede/iva/suministro-inmediato-informacion.html
 */

const SII_URLS = {
  test: {
    emitidas: 'https://www7.aeat.es/wlpl/SSII-FACT/ws/fe/SiiFactFEV2SOAP',
    recibidas: 'https://www7.aeat.es/wlpl/SSII-FACT/ws/fr/SiiFactFRV2SOAP',
    consulta_emitidas: 'https://www7.aeat.es/wlpl/SSII-FACT/ws/fe/SiiFactFEV2SOAP',
    consulta_recibidas: 'https://www7.aeat.es/wlpl/SSII-FACT/ws/fr/SiiFactFRV2SOAP',
  },
  produccion: {
    emitidas: 'https://www1.agenciatributaria.gob.es/wlpl/SSII-FACT/ws/fe/SiiFactFEV2SOAP',
    recibidas: 'https://www1.agenciatributaria.gob.es/wlpl/SSII-FACT/ws/fr/SiiFactFRV2SOAP',
    consulta_emitidas: 'https://www1.agenciatributaria.gob.es/wlpl/SSII-FACT/ws/fe/SiiFactFEV2SOAP',
    consulta_recibidas: 'https://www1.agenciatributaria.gob.es/wlpl/SSII-FACT/ws/fr/SiiFactFRV2SOAP',
  }
};

const SII_VERSION = '1.1';

// Namespaces SII
const NS_SOAP = 'http://schemas.xmlsoap.org/soap/envelope/';
const NS_SII = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/ssii/fact/ws/SuministroInformacion.xsd';
const NS_SIILR = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/ssii/fact/ws/SuministroLR.xsd';

/**
 * Escapa caracteres especiales XML
 */
function escaparXml(texto) {
  if (!texto) return '';
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Formatea fecha como DD-MM-YYYY (formato SII)
 */
function formatFechaSii(date) {
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Obtiene el periodo (mes) de una fecha
 */
function getPeriodo(date) {
  const d = new Date(date);
  return String(d.getMonth() + 1).padStart(2, '0');
}

/**
 * Obtiene el ejercicio (año) de una fecha
 */
function getEjercicio(date) {
  return new Date(date).getFullYear();
}

// ============================================================
// SERVICE EXPORTS
// ============================================================

export const siiService = {

  /**
   * Obtener configuración SII de una empresa
   */
  async getSiiConfig(empresaId) {
    const [config] = await sql`
      SELECT sc.*, cd.nombre as certificado_nombre
      FROM sii_config_180 sc
      LEFT JOIN certificados_digitales_180 cd ON cd.id = sc.certificado_id
      WHERE sc.empresa_id = ${empresaId}
      LIMIT 1
    `;
    return config || null;
  },

  /**
   * Crear o actualizar configuración SII
   */
  async updateSiiConfig(empresaId, configData) {
    const { sii_activo, sii_motivo, sii_inicio, certificado_id, envio_automatico, entorno } = configData;

    // Upsert
    const [existing] = await sql`
      SELECT id FROM sii_config_180 WHERE empresa_id = ${empresaId}
    `;

    if (existing) {
      const [updated] = await sql`
        UPDATE sii_config_180
        SET sii_activo = COALESCE(${sii_activo}, sii_activo),
            sii_motivo = COALESCE(${sii_motivo}, sii_motivo),
            sii_inicio = COALESCE(${sii_inicio}, sii_inicio),
            certificado_id = COALESCE(${certificado_id}, certificado_id),
            envio_automatico = COALESCE(${envio_automatico}, envio_automatico),
            entorno = COALESCE(${entorno}, entorno),
            updated_at = now()
        WHERE empresa_id = ${empresaId}
        RETURNING *
      `;
      return updated;
    } else {
      const [created] = await sql`
        INSERT INTO sii_config_180 (empresa_id, sii_activo, sii_motivo, sii_inicio, certificado_id, envio_automatico, entorno)
        VALUES (${empresaId}, ${sii_activo || false}, ${sii_motivo || 'voluntario'}, ${sii_inicio || null}, ${certificado_id || null}, ${envio_automatico || false}, ${entorno || 'test'})
        RETURNING *
      `;
      return created;
    }
  },

  /**
   * Genera el XML SII para una factura emitida (venta)
   */
  generarRegistroEmitida(factura, emisor, tipoComunicacion = 'A0') {
    const fechaFactura = formatFechaSii(factura.fecha);
    const ejercicio = getEjercicio(factura.fecha);
    const periodo = getPeriodo(factura.fecha);

    const subtotal = Number(factura.subtotal || 0);
    const ivaTotal = Number(factura.iva_total || factura.iva_global || 0);
    const total = Number(factura.total || 0);
    const ivaPct = subtotal > 0 ? Math.round((ivaTotal / subtotal) * 10000) / 100 : 21;

    // Contraparte
    let contraparteXml = '';
    if (factura.cliente_nombre || factura.cliente_nif) {
      contraparteXml = `
              <sii:Contraparte>
                <sii:NombreRazon>${escaparXml(factura.cliente_nombre || '')}</sii:NombreRazon>
                ${factura.cliente_nif ? `<sii:NIF>${escaparXml(factura.cliente_nif)}</sii:NIF>` : ''}
              </sii:Contraparte>`;
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${NS_SOAP}"
                  xmlns:siiLR="${NS_SIILR}"
                  xmlns:sii="${NS_SII}">
  <soapenv:Header/>
  <soapenv:Body>
    <siiLR:SuministroLRFacturasEmitidas>
      <siiLR:Cabecera>
        <sii:IDVersionSii>${SII_VERSION}</sii:IDVersionSii>
        <sii:Titular>
          <sii:NombreRazon>${escaparXml(emisor.nombre || emisor.nombre_comercial)}</sii:NombreRazon>
          <sii:NIF>${emisor.nif}</sii:NIF>
        </sii:Titular>
        <sii:TipoComunicacion>${tipoComunicacion}</sii:TipoComunicacion>
      </siiLR:Cabecera>
      <siiLR:RegistroLRFacturasEmitidas>
        <siiLR:PeriodoLiquidacion>
          <sii:Ejercicio>${ejercicio}</sii:Ejercicio>
          <sii:Periodo>${periodo}</sii:Periodo>
        </siiLR:PeriodoLiquidacion>
        <siiLR:IDFactura>
          <sii:IDEmisorFactura><sii:NIF>${emisor.nif}</sii:NIF></sii:IDEmisorFactura>
          <sii:NumSerieFacturaEmisor>${escaparXml(factura.numero)}</sii:NumSerieFacturaEmisor>
          <sii:FechaExpedicionFacturaEmisor>${fechaFactura}</sii:FechaExpedicionFacturaEmisor>
        </siiLR:IDFactura>
        <siiLR:FacturaExpedida>
          <sii:TipoFactura>F1</sii:TipoFactura>
          <sii:ClaveRegimenEspecialOTrascendencia>01</sii:ClaveRegimenEspecialOTrascendencia>
          <sii:DescripcionOperacion>${escaparXml(factura.concepto || factura.descripcion || 'Prestacion de servicios')}</sii:DescripcionOperacion>${contraparteXml}
          <sii:TipoDesglose>
            <sii:DesgloseFactura>
              <sii:Sujeta>
                <sii:NoExenta>
                  <sii:TipoNoExenta>S1</sii:TipoNoExenta>
                  <sii:DesgloseIVA>
                    <sii:DetalleIVA>
                      <sii:TipoImpositivo>${ivaPct.toFixed(2)}</sii:TipoImpositivo>
                      <sii:BaseImponible>${subtotal.toFixed(2)}</sii:BaseImponible>
                      <sii:CuotaRepercutida>${ivaTotal.toFixed(2)}</sii:CuotaRepercutida>
                    </sii:DetalleIVA>
                  </sii:DesgloseIVA>
                </sii:NoExenta>
              </sii:Sujeta>
            </sii:DesgloseFactura>
          </sii:TipoDesglose>
        </siiLR:FacturaExpedida>
      </siiLR:RegistroLRFacturasEmitidas>
    </siiLR:SuministroLRFacturasEmitidas>
  </soapenv:Body>
</soapenv:Envelope>`;

    return {
      xml,
      metadata: {
        tipo_libro: 'emitidas',
        tipo_comunicacion: tipoComunicacion,
        ejercicio,
        periodo,
        nif_titular: emisor.nif,
        nif_contraparte: factura.cliente_nif || null,
        nombre_contraparte: factura.cliente_nombre || null,
        numero_factura: factura.numero,
        fecha_factura: factura.fecha,
        base_imponible: subtotal,
        cuota_iva: ivaTotal,
        tipo_iva: ivaPct,
        total
      }
    };
  },

  /**
   * Genera el XML SII para una factura recibida (compra/gasto)
   */
  generarRegistroRecibida(gasto, emisor, tipoComunicacion = 'A0') {
    const fechaFactura = formatFechaSii(gasto.fecha || gasto.fecha_factura);
    const fechaRegistro = formatFechaSii(gasto.created_at || new Date());
    const ejercicio = getEjercicio(gasto.fecha || gasto.fecha_factura);
    const periodo = getPeriodo(gasto.fecha || gasto.fecha_factura);

    const base = Number(gasto.base_imponible || gasto.subtotal || 0);
    const cuotaIva = Number(gasto.iva_total || gasto.cuota_iva || 0);
    const total = Number(gasto.total || 0);
    const ivaPct = base > 0 ? Math.round((cuotaIva / base) * 10000) / 100 : 21;

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${NS_SOAP}"
                  xmlns:siiLR="${NS_SIILR}"
                  xmlns:sii="${NS_SII}">
  <soapenv:Header/>
  <soapenv:Body>
    <siiLR:SuministroLRFacturasRecibidas>
      <siiLR:Cabecera>
        <sii:IDVersionSii>${SII_VERSION}</sii:IDVersionSii>
        <sii:Titular>
          <sii:NombreRazon>${escaparXml(emisor.nombre || emisor.nombre_comercial)}</sii:NombreRazon>
          <sii:NIF>${emisor.nif}</sii:NIF>
        </sii:Titular>
        <sii:TipoComunicacion>${tipoComunicacion}</sii:TipoComunicacion>
      </siiLR:Cabecera>
      <siiLR:RegistroLRFacturasRecibidas>
        <siiLR:PeriodoLiquidacion>
          <sii:Ejercicio>${ejercicio}</sii:Ejercicio>
          <sii:Periodo>${periodo}</sii:Periodo>
        </siiLR:PeriodoLiquidacion>
        <siiLR:IDFactura>
          <sii:IDEmisorFactura>
            ${gasto.nif_proveedor ? `<sii:NIF>${escaparXml(gasto.nif_proveedor)}</sii:NIF>` : `<sii:NIF>000000000</sii:NIF>`}
          </sii:IDEmisorFactura>
          <sii:NumSerieFacturaEmisor>${escaparXml(gasto.numero_factura || gasto.referencia || 'SIN-NUM')}</sii:NumSerieFacturaEmisor>
          <sii:FechaExpedicionFacturaEmisor>${fechaFactura}</sii:FechaExpedicionFacturaEmisor>
        </siiLR:IDFactura>
        <siiLR:FacturaRecibida>
          <sii:TipoFactura>F1</sii:TipoFactura>
          <sii:ClaveRegimenEspecialOTrascendencia>01</sii:ClaveRegimenEspecialOTrascendencia>
          <sii:DescripcionOperacion>${escaparXml(gasto.concepto || gasto.descripcion || 'Gasto/Compra')}</sii:DescripcionOperacion>
          <sii:Contraparte>
            <sii:NombreRazon>${escaparXml(gasto.proveedor || gasto.nombre_proveedor || '')}</sii:NombreRazon>
            ${gasto.nif_proveedor ? `<sii:NIF>${escaparXml(gasto.nif_proveedor)}</sii:NIF>` : ''}
          </sii:Contraparte>
          <sii:FechaRegContable>${fechaRegistro}</sii:FechaRegContable>
          <sii:DesgloseFactura>
            <sii:InversionSujetoPasivo>
              <sii:DetalleIVA>
                <sii:TipoImpositivo>${ivaPct.toFixed(2)}</sii:TipoImpositivo>
                <sii:BaseImponible>${base.toFixed(2)}</sii:BaseImponible>
                <sii:CuotaSoportada>${cuotaIva.toFixed(2)}</sii:CuotaSoportada>
              </sii:DetalleIVA>
            </sii:InversionSujetoPasivo>
          </sii:DesgloseFactura>
          <sii:CuotaDeducible>${cuotaIva.toFixed(2)}</sii:CuotaDeducible>
        </siiLR:FacturaRecibida>
      </siiLR:RegistroLRFacturasRecibidas>
    </siiLR:SuministroLRFacturasRecibidas>
  </soapenv:Body>
</soapenv:Envelope>`;

    return {
      xml,
      metadata: {
        tipo_libro: 'recibidas',
        tipo_comunicacion: tipoComunicacion,
        ejercicio,
        periodo,
        nif_titular: emisor.nif,
        nif_contraparte: gasto.nif_proveedor || null,
        nombre_contraparte: gasto.proveedor || gasto.nombre_proveedor || null,
        numero_factura: gasto.numero_factura || gasto.referencia || null,
        fecha_factura: gasto.fecha || gasto.fecha_factura,
        base_imponible: base,
        cuota_iva: cuotaIva,
        tipo_iva: ivaPct,
        total
      }
    };
  },

  /**
   * Enviar lote de registros SII a la AEAT
   */
  async enviarLote(empresaId, registros, tipoLibro = 'emitidas') {
    const config = await this.getSiiConfig(empresaId);
    if (!config) {
      throw new Error('SII no configurado para esta empresa');
    }
    if (!config.sii_activo) {
      throw new Error('SII no está activo para esta empresa');
    }

    const entorno = config.entorno || 'test';
    const endpoint = SII_URLS[entorno]?.[tipoLibro];
    if (!endpoint) {
      throw new Error(`Endpoint SII no encontrado para ${entorno}/${tipoLibro}`);
    }

    // Get certificate
    let certData = null;
    if (config.certificado_id) {
      const [cert] = await sql`
        SELECT certificado_data, password_cifrada
        FROM certificados_digitales_180
        WHERE id = ${config.certificado_id}
        LIMIT 1
      `;
      if (cert) {
        certData = cert;
      }
    }

    // Fallback to emisor certificate
    if (!certData) {
      const [emisor] = await sql`
        SELECT certificado_data, certificado_password
        FROM emisor_180
        WHERE empresa_id = ${empresaId}
        LIMIT 1
      `;
      if (emisor?.certificado_data) {
        certData = { certificado_data: emisor.certificado_data, password_cifrada: emisor.certificado_password };
      }
    }

    const resultados = [];

    for (const registro of registros) {
      try {
        // Create envio record
        const [envio] = await sql`
          INSERT INTO sii_envios_180 (
            empresa_id, tipo_libro, tipo_comunicacion, factura_id, gasto_id,
            ejercicio, periodo, nif_titular, nif_contraparte, nombre_contraparte,
            numero_factura, fecha_factura, base_imponible, cuota_iva, tipo_iva, total,
            estado, intentos
          ) VALUES (
            ${empresaId}, ${registro.metadata.tipo_libro}, ${registro.metadata.tipo_comunicacion},
            ${registro.factura_id || null}, ${registro.gasto_id || null},
            ${registro.metadata.ejercicio}, ${registro.metadata.periodo},
            ${registro.metadata.nif_titular}, ${registro.metadata.nif_contraparte},
            ${registro.metadata.nombre_contraparte}, ${registro.metadata.numero_factura},
            ${registro.metadata.fecha_factura}, ${registro.metadata.base_imponible},
            ${registro.metadata.cuota_iva}, ${registro.metadata.tipo_iva}, ${registro.metadata.total},
            'enviado', 1
          )
          RETURNING *
        `;

        // Send SOAP request
        const respuesta = await enviarSoapSii(endpoint, registro.xml, certData, entorno);

        // Parse and update
        const parsed = procesarRespuesta(respuesta.rawXml);

        await sql`
          UPDATE sii_envios_180
          SET estado = ${parsed.estado},
              csv_aeat = ${parsed.csv || null},
              aeat_estado = ${parsed.aeatEstado || null},
              aeat_error_code = ${parsed.errorCode || null},
              aeat_error_desc = ${parsed.errorDesc || null},
              aeat_respuesta_xml = ${respuesta.rawXml || null},
              enviado_at = now()
          WHERE id = ${envio.id}
        `;

        // Update config last send time
        await sql`
          UPDATE sii_config_180 SET ultimo_envio = now() WHERE empresa_id = ${empresaId}
        `;

        resultados.push({
          envioId: envio.id,
          numero: registro.metadata.numero_factura,
          estado: parsed.estado,
          csv: parsed.csv,
          error: parsed.errorDesc
        });

        // Throttle between requests
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        resultados.push({
          numero: registro.metadata.numero_factura,
          estado: 'rechazado',
          error: error.message
        });
      }
    }

    return {
      total: registros.length,
      aceptados: resultados.filter(r => r.estado === 'aceptado').length,
      rechazados: resultados.filter(r => r.estado === 'rechazado').length,
      parciales: resultados.filter(r => r.estado === 'parcial').length,
      resultados
    };
  },

  /**
   * Consultar estado de envíos en la AEAT
   */
  async consultarEstado(empresaId, ejercicio, periodo) {
    const config = await this.getSiiConfig(empresaId);
    if (!config) throw new Error('SII no configurado');

    const [emisor] = await sql`
      SELECT nif, nombre, nombre_comercial FROM emisor_180
      WHERE empresa_id = ${empresaId} LIMIT 1
    `;
    if (!emisor) throw new Error('Emisor no encontrado');

    // Build consultation XML
    const consultaXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${NS_SOAP}"
                  xmlns:siiLR="${NS_SIILR}"
                  xmlns:sii="${NS_SII}">
  <soapenv:Header/>
  <soapenv:Body>
    <siiLR:ConsultaLRFacturasEmitidas>
      <siiLR:Cabecera>
        <sii:IDVersionSii>${SII_VERSION}</sii:IDVersionSii>
        <sii:Titular>
          <sii:NombreRazon>${escaparXml(emisor.nombre || emisor.nombre_comercial)}</sii:NombreRazon>
          <sii:NIF>${emisor.nif}</sii:NIF>
        </sii:Titular>
      </siiLR:Cabecera>
      <siiLR:FiltroConsulta>
        <siiLR:PeriodoLiquidacion>
          <sii:Ejercicio>${ejercicio}</sii:Ejercicio>
          <sii:Periodo>${periodo}</sii:Periodo>
        </siiLR:PeriodoLiquidacion>
      </siiLR:FiltroConsulta>
    </siiLR:ConsultaLRFacturasEmitidas>
  </soapenv:Body>
</soapenv:Envelope>`;

    const entorno = config.entorno || 'test';
    const endpoint = SII_URLS[entorno].consulta_emitidas;

    let certData = null;
    if (config.certificado_id) {
      const [cert] = await sql`
        SELECT certificado_data, password_cifrada
        FROM certificados_digitales_180
        WHERE id = ${config.certificado_id}
        LIMIT 1
      `;
      certData = cert;
    }

    const respuesta = await enviarSoapSii(endpoint, consultaXml, certData, entorno);
    return {
      rawXml: respuesta.rawXml,
      statusCode: respuesta.statusCode
    };
  },

  /**
   * Obtener facturas emitidas pendientes de envío SII
   */
  async getPendientes(empresaId) {
    // Facturas emitidas no enviadas al SII
    const emitidas = await sql`
      SELECT f.id, f.numero, f.fecha, f.cliente_nombre, f.cliente_nif,
             f.subtotal, f.iva_total, f.total, f.concepto, f.descripcion,
             'emitida' as tipo
      FROM factura_180 f
      WHERE f.empresa_id = ${empresaId}
        AND f.estado != 'anulada'
        AND NOT EXISTS (
          SELECT 1 FROM sii_envios_180 se
          WHERE se.factura_id = f.id
            AND se.estado IN ('aceptado', 'enviado', 'parcial')
        )
      ORDER BY f.fecha DESC
    `;

    // Gastos/compras no enviados al SII
    const recibidas = await sql`
      SELECT p.id, p.referencia as numero, p.fecha, p.proveedor as cliente_nombre,
             p.nif_proveedor as cliente_nif,
             p.base_imponible as subtotal, p.iva_total, p.total,
             p.concepto, p.descripcion,
             'recibida' as tipo
      FROM purchases_180 p
      WHERE p.empresa_id = ${empresaId}
        AND NOT EXISTS (
          SELECT 1 FROM sii_envios_180 se
          WHERE se.gasto_id = p.id
            AND se.estado IN ('aceptado', 'enviado', 'parcial')
        )
      ORDER BY p.fecha DESC
    `;

    return {
      emitidas,
      recibidas,
      total: emitidas.length + recibidas.length
    };
  },

  /**
   * Obtener estadísticas del dashboard SII
   */
  async getDashboardStats(empresaId) {
    const [stats] = await sql`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN estado = 'pendiente' THEN 1 ELSE 0 END) as pendientes,
        SUM(CASE WHEN estado = 'enviado' THEN 1 ELSE 0 END) as enviados,
        SUM(CASE WHEN estado = 'aceptado' THEN 1 ELSE 0 END) as aceptados,
        SUM(CASE WHEN estado = 'rechazado' THEN 1 ELSE 0 END) as rechazados,
        SUM(CASE WHEN estado = 'parcial' THEN 1 ELSE 0 END) as parciales
      FROM sii_envios_180
      WHERE empresa_id = ${empresaId}
    `;

    const pendientes = await this.getPendientes(empresaId);

    return {
      envios: {
        total: parseInt(stats?.total || 0),
        pendientes: parseInt(stats?.pendientes || 0),
        enviados: parseInt(stats?.enviados || 0),
        aceptados: parseInt(stats?.aceptados || 0),
        rechazados: parseInt(stats?.rechazados || 0),
        parciales: parseInt(stats?.parciales || 0)
      },
      facturas_pendientes: pendientes.total
    };
  },

  /**
   * Obtener historial de envíos con filtros
   */
  async getHistorial(empresaId, { ejercicio, periodo, estado, tipo_libro, limit = 50, offset = 0 } = {}) {
    let query = sql`
      SELECT se.*
      FROM sii_envios_180 se
      WHERE se.empresa_id = ${empresaId}
    `;

    if (ejercicio) query = sql`${query} AND se.ejercicio = ${ejercicio}`;
    if (periodo) query = sql`${query} AND se.periodo = ${periodo}`;
    if (estado) query = sql`${query} AND se.estado = ${estado}`;
    if (tipo_libro) query = sql`${query} AND se.tipo_libro = ${tipo_libro}`;

    query = sql`${query} ORDER BY se.created_at DESC LIMIT ${limit} OFFSET ${offset}`;

    const envios = await query;

    const [count] = await sql`
      SELECT COUNT(*) as total FROM sii_envios_180
      WHERE empresa_id = ${empresaId}
      ${ejercicio ? sql`AND ejercicio = ${ejercicio}` : sql``}
      ${periodo ? sql`AND periodo = ${periodo}` : sql``}
      ${estado ? sql`AND estado = ${estado}` : sql``}
      ${tipo_libro ? sql`AND tipo_libro = ${tipo_libro}` : sql``}
    `;

    return {
      envios,
      total: parseInt(count?.total || 0),
      limit,
      offset
    };
  },

  // ============================================================
  // FRAMEWORK EXTENSIONS (batch envios, validation, mapping)
  // ============================================================

  mapFacturaToSiiRegistro(factura, tipo = 'emitida') {
    const base = Number(factura.subtotal || factura.base_imponible || 0);
    const cuota = Number(factura.iva_total || factura.cuota_iva || 0);
    const tipoImpositivo = base > 0 ? Math.round((cuota / base) * 10000) / 100 : 21;

    return {
      factura_id: factura.id,
      tipo_factura: tipo,
      nif_contraparte: tipo === 'emitida'
        ? (factura.cliente_nif || null)
        : (factura.nif_proveedor || null),
      nombre_contraparte: tipo === 'emitida'
        ? (factura.cliente_nombre || null)
        : (factura.proveedor || factura.nombre_proveedor || null),
      numero_factura: factura.numero || factura.referencia || null,
      fecha_expedicion: factura.fecha || factura.fecha_factura || null,
      tipo_factura_sii: this.getTipoFacturaSii(factura),
      clave_regimen: this.getClaveRegimen(factura),
      base_imponible: base,
      tipo_impositivo: tipoImpositivo,
      cuota_repercutida: cuota,
    };
  },

  getClaveRegimen(factura) {
    if (factura.es_intracomunitaria) return '09';
    if (factura.es_exportacion) return '02';
    if (factura.regimen_especial) {
      const map = {
        'general': '01', 'exportacion': '02', 'bienes_usados': '03',
        'oro_inversion': '04', 'agencias_viaje': '05', 'grupos_entidades': '06',
        'recc': '07', 'ipsi_igic': '08', 'intracomunitaria': '09',
        'cobros_cuenta_terceros': '10', 'arrendamiento': '12', 'factura_simplificada': '14',
      };
      return map[factura.regimen_especial] || '01';
    }
    if (factura.es_simplificada || factura.tipo === 'simplificada') return '14';
    return '01';
  },

  getTipoFacturaSii(factura) {
    if (factura.es_rectificativa || factura.tipo_factura === 'rectificativa') {
      if (factura.es_simplificada || factura.tipo === 'simplificada') return 'R5';
      const motivo = factura.motivo_rectificacion || '';
      if (motivo.includes('80.1') || motivo.includes('80.2')) return 'R1';
      if (motivo.includes('80.3')) return 'R2';
      if (motivo.includes('80.4')) return 'R3';
      return 'R4';
    }
    if (factura.es_simplificada || factura.tipo === 'simplificada' || factura.tipo_factura === 'simplificada') return 'F2';
    return 'F1';
  },

  validateSiiRegistro(registro) {
    const errors = [];
    if (!registro.numero_factura) errors.push('Numero de factura obligatorio');
    if (!registro.fecha_expedicion) errors.push('Fecha de expedicion obligatoria');
    if (!registro.base_imponible && registro.base_imponible !== 0) errors.push('Base imponible obligatoria');
    if (registro.tipo_factura === 'emitida' && !registro.nif_contraparte && registro.tipo_factura_sii !== 'F2') {
      errors.push('NIF del destinatario obligatorio para facturas completas (F1)');
    }
    if (registro.tipo_factura === 'recibida' && !registro.nif_contraparte) {
      errors.push('NIF del emisor obligatorio para facturas recibidas');
    }
    if (registro.nif_contraparte && !/^[A-Z0-9]{8,9}$/i.test(registro.nif_contraparte.replace(/[-\s]/g, ''))) {
      errors.push(`NIF/CIF contraparte parece invalido: ${registro.nif_contraparte}`);
    }
    if (!registro.tipo_factura_sii) errors.push('Tipo de factura SII obligatorio');
    if (!registro.clave_regimen) errors.push('Clave regimen obligatoria');
    return { valid: errors.length === 0, errors };
  },

  parseSiiResponse(xmlResponse) {
    return procesarRespuesta(xmlResponse);
  },

  buildSiiXml(tipo_libro, registros, config, emisor) {
    const tipoComunicacion = 'A0';
    const ejercicio = registros[0]?.ejercicio || new Date().getFullYear();
    const periodo = registros[0]?.periodo || getPeriodo(new Date());
    if (tipo_libro === 'facturas_emitidas') {
      return this._buildXmlEmitidas(registros, emisor, tipoComunicacion, ejercicio, periodo);
    } else if (tipo_libro === 'facturas_recibidas') {
      return this._buildXmlRecibidas(registros, emisor, tipoComunicacion, ejercicio, periodo);
    }
    throw new Error(`Tipo libro no soportado: ${tipo_libro}`);
  },

  _buildXmlEmitidas(registros, emisor, tipoComunicacion, ejercicio, periodo) {
    const registrosXml = registros.map(r => {
      const fecha = formatFechaSii(r.fecha_expedicion);
      let contraparteXml = '';
      if (r.nombre_contraparte || r.nif_contraparte) {
        contraparteXml = `
              <sii:Contraparte>
                <sii:NombreRazon>${escaparXml(r.nombre_contraparte || '')}</sii:NombreRazon>
                ${r.nif_contraparte ? `<sii:NIF>${escaparXml(r.nif_contraparte)}</sii:NIF>` : ''}
              </sii:Contraparte>`;
      }
      return `
      <siiLR:RegistroLRFacturasEmitidas>
        <siiLR:PeriodoLiquidacion>
          <sii:Ejercicio>${ejercicio}</sii:Ejercicio>
          <sii:Periodo>${String(periodo).padStart(2, '0')}</sii:Periodo>
        </siiLR:PeriodoLiquidacion>
        <siiLR:IDFactura>
          <sii:IDEmisorFactura><sii:NIF>${emisor.nif}</sii:NIF></sii:IDEmisorFactura>
          <sii:NumSerieFacturaEmisor>${escaparXml(r.numero_factura)}</sii:NumSerieFacturaEmisor>
          <sii:FechaExpedicionFacturaEmisor>${fecha}</sii:FechaExpedicionFacturaEmisor>
        </siiLR:IDFactura>
        <siiLR:FacturaExpedida>
          <sii:TipoFactura>${r.tipo_factura_sii || 'F1'}</sii:TipoFactura>
          <sii:ClaveRegimenEspecialOTrascendencia>${r.clave_regimen || '01'}</sii:ClaveRegimenEspecialOTrascendencia>
          <sii:DescripcionOperacion>${escaparXml(r.descripcion || 'Prestacion de servicios')}</sii:DescripcionOperacion>${contraparteXml}
          <sii:TipoDesglose>
            <sii:DesgloseFactura>
              <sii:Sujeta>
                <sii:NoExenta>
                  <sii:TipoNoExenta>S1</sii:TipoNoExenta>
                  <sii:DesgloseIVA>
                    <sii:DetalleIVA>
                      <sii:TipoImpositivo>${(r.tipo_impositivo || 21).toFixed(2)}</sii:TipoImpositivo>
                      <sii:BaseImponible>${(r.base_imponible || 0).toFixed(2)}</sii:BaseImponible>
                      <sii:CuotaRepercutida>${(r.cuota_repercutida || 0).toFixed(2)}</sii:CuotaRepercutida>
                    </sii:DetalleIVA>
                  </sii:DesgloseIVA>
                </sii:NoExenta>
              </sii:Sujeta>
            </sii:DesgloseFactura>
          </sii:TipoDesglose>
        </siiLR:FacturaExpedida>
      </siiLR:RegistroLRFacturasEmitidas>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${NS_SOAP}"
                  xmlns:siiLR="${NS_SIILR}"
                  xmlns:sii="${NS_SII}">
  <soapenv:Header/>
  <soapenv:Body>
    <siiLR:SuministroLRFacturasEmitidas>
      <siiLR:Cabecera>
        <sii:IDVersionSii>${SII_VERSION}</sii:IDVersionSii>
        <sii:Titular>
          <sii:NombreRazon>${escaparXml(emisor.nombre || emisor.nombre_comercial)}</sii:NombreRazon>
          <sii:NIF>${emisor.nif}</sii:NIF>
        </sii:Titular>
        <sii:TipoComunicacion>${tipoComunicacion}</sii:TipoComunicacion>
      </siiLR:Cabecera>${registrosXml}
    </siiLR:SuministroLRFacturasEmitidas>
  </soapenv:Body>
</soapenv:Envelope>`;
  },

  _buildXmlRecibidas(registros, emisor, tipoComunicacion, ejercicio, periodo) {
    const fechaRegistro = formatFechaSii(new Date());
    const registrosXml = registros.map(r => {
      const fecha = formatFechaSii(r.fecha_expedicion);
      return `
      <siiLR:RegistroLRFacturasRecibidas>
        <siiLR:PeriodoLiquidacion>
          <sii:Ejercicio>${ejercicio}</sii:Ejercicio>
          <sii:Periodo>${String(periodo).padStart(2, '0')}</sii:Periodo>
        </siiLR:PeriodoLiquidacion>
        <siiLR:IDFactura>
          <sii:IDEmisorFactura>
            ${r.nif_contraparte ? `<sii:NIF>${escaparXml(r.nif_contraparte)}</sii:NIF>` : '<sii:NIF>000000000</sii:NIF>'}
          </sii:IDEmisorFactura>
          <sii:NumSerieFacturaEmisor>${escaparXml(r.numero_factura || 'SIN-NUM')}</sii:NumSerieFacturaEmisor>
          <sii:FechaExpedicionFacturaEmisor>${fecha}</sii:FechaExpedicionFacturaEmisor>
        </siiLR:IDFactura>
        <siiLR:FacturaRecibida>
          <sii:TipoFactura>${r.tipo_factura_sii || 'F1'}</sii:TipoFactura>
          <sii:ClaveRegimenEspecialOTrascendencia>${r.clave_regimen || '01'}</sii:ClaveRegimenEspecialOTrascendencia>
          <sii:DescripcionOperacion>${escaparXml(r.descripcion || 'Gasto/Compra')}</sii:DescripcionOperacion>
          <sii:Contraparte>
            <sii:NombreRazon>${escaparXml(r.nombre_contraparte || '')}</sii:NombreRazon>
            ${r.nif_contraparte ? `<sii:NIF>${escaparXml(r.nif_contraparte)}</sii:NIF>` : ''}
          </sii:Contraparte>
          <sii:FechaRegContable>${fechaRegistro}</sii:FechaRegContable>
          <sii:DesgloseFactura>
            <sii:InversionSujetoPasivo>
              <sii:DetalleIVA>
                <sii:TipoImpositivo>${(r.tipo_impositivo || 21).toFixed(2)}</sii:TipoImpositivo>
                <sii:BaseImponible>${(r.base_imponible || 0).toFixed(2)}</sii:BaseImponible>
                <sii:CuotaSoportada>${(r.cuota_repercutida || 0).toFixed(2)}</sii:CuotaSoportada>
              </sii:DetalleIVA>
            </sii:InversionSujetoPasivo>
          </sii:DesgloseFactura>
          <sii:CuotaDeducible>${(r.cuota_repercutida || 0).toFixed(2)}</sii:CuotaDeducible>
        </siiLR:FacturaRecibida>
      </siiLR:RegistroLRFacturasRecibidas>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${NS_SOAP}"
                  xmlns:siiLR="${NS_SIILR}"
                  xmlns:sii="${NS_SII}">
  <soapenv:Header/>
  <soapenv:Body>
    <siiLR:SuministroLRFacturasRecibidas>
      <siiLR:Cabecera>
        <sii:IDVersionSii>${SII_VERSION}</sii:IDVersionSii>
        <sii:Titular>
          <sii:NombreRazon>${escaparXml(emisor.nombre || emisor.nombre_comercial)}</sii:NombreRazon>
          <sii:NIF>${emisor.nif}</sii:NIF>
        </sii:Titular>
        <sii:TipoComunicacion>${tipoComunicacion}</sii:TipoComunicacion>
      </siiLR:Cabecera>${registrosXml}
    </siiLR:SuministroLRFacturasRecibidas>
  </soapenv:Body>
</soapenv:Envelope>`;
  },

  async prepararEnvio(empresaId, tipoLibro, ejercicio, mes) {
    const pendientes = await this.getPendientes(empresaId);
    const facturas = tipoLibro === 'facturas_emitidas' ? pendientes.emitidas : pendientes.recibidas;
    if (!facturas || facturas.length === 0) {
      return { envio: null, registros: [], message: 'No hay facturas pendientes de envio' };
    }
    let filtered = facturas;
    if (ejercicio && mes) {
      filtered = facturas.filter(f => {
        const d = new Date(f.fecha || f.fecha_factura);
        return d.getFullYear() === ejercicio && (d.getMonth() + 1) === parseInt(mes);
      });
    }
    if (filtered.length === 0) {
      return { envio: null, registros: [], message: 'No hay facturas para el periodo seleccionado' };
    }
    const tipo = tipoLibro === 'facturas_emitidas' ? 'emitida' : 'recibida';
    const registros = filtered.map(f => this.mapFacturaToSiiRegistro(f, tipo));
    const validationResults = registros.map(r => ({ ...r, validation: this.validateSiiRegistro(r) }));
    const validos = validationResults.filter(r => r.validation.valid);
    const invalidos = validationResults.filter(r => !r.validation.valid);
    const periodoMes = mes || getPeriodo(filtered[0].fecha || filtered[0].fecha_factura);
    const periodoEjercicio = ejercicio || getEjercicio(filtered[0].fecha || filtered[0].fecha_factura);
    const [envio] = await sql`
      INSERT INTO sii_envios_180 (empresa_id, tipo_libro, tipo_comunicacion, ejercicio, periodo, periodo_ejercicio, periodo_mes, nif_titular, num_registros, estado)
      VALUES (${empresaId}, ${tipoLibro}, 'A0', ${periodoEjercicio}, ${periodoMes}, ${periodoEjercicio}, ${periodoMes}, '', ${validos.length}, 'pendiente')
      RETURNING *`;
    for (const reg of validos) {
      await sql`
        INSERT INTO sii_registros_180 (envio_id, factura_id, tipo_factura, nif_contraparte, nombre_contraparte, numero_factura, fecha_expedicion, tipo_factura_sii, clave_regimen, base_imponible, tipo_impositivo, cuota_repercutida, estado_registro)
        VALUES (${envio.id}, ${reg.factura_id}, ${reg.tipo_factura}, ${reg.nif_contraparte}, ${reg.nombre_contraparte}, ${reg.numero_factura}, ${reg.fecha_expedicion}, ${reg.tipo_factura_sii}, ${reg.clave_regimen}, ${reg.base_imponible}, ${reg.tipo_impositivo}, ${reg.cuota_repercutida}, 'pendiente')`;
    }
    return { envio, registros: validos, invalidos: invalidos.map(r => ({ numero_factura: r.numero_factura, errors: r.validation.errors })), total_validos: validos.length, total_invalidos: invalidos.length };
  },

  async simularEnvio(empresaId, envioId) {
    const [envio] = await sql`SELECT * FROM sii_envios_180 WHERE id = ${envioId} AND empresa_id = ${empresaId}`;
    if (!envio) throw new Error('Envio no encontrado');
    const registros = await sql`SELECT * FROM sii_registros_180 WHERE envio_id = ${envioId} ORDER BY created_at`;
    if (registros.length === 0) throw new Error('No hay registros en este envio');
    const [emisor] = await sql`SELECT nif, nombre, nombre_comercial FROM emisor_180 WHERE empresa_id = ${empresaId} LIMIT 1`;
    if (!emisor) throw new Error('Emisor no configurado para esta empresa');
    const config = await this.getSiiConfig(empresaId);
    const tipoLibro = envio.tipo_libro || 'facturas_emitidas';
    const registrosMapped = registros.map(r => ({ ...r, ejercicio: envio.ejercicio || envio.periodo_ejercicio, periodo: envio.periodo || envio.periodo_mes }));
    const xml = this.buildSiiXml(tipoLibro, registrosMapped, config, emisor);
    await sql`UPDATE sii_envios_180 SET xml_request = ${xml} WHERE id = ${envioId}`;
    return { envio_id: envioId, xml_preview: xml, num_registros: registros.length, entorno: config?.entorno || 'test', validacion: { registros_validos: registros.length, listo_para_enviar: true } };
  },

  async getEstadisticasSii(empresaId) {
    const dashboard = await this.getDashboardStats(empresaId);
    const year = new Date().getFullYear();
    const mensual = await sql`
      SELECT periodo, tipo_libro, COUNT(*) as total,
        SUM(CASE WHEN estado = 'aceptado' THEN 1 ELSE 0 END) as aceptados,
        SUM(CASE WHEN estado = 'rechazado' THEN 1 ELSE 0 END) as rechazados,
        SUM(base_imponible) as total_base
      FROM sii_envios_180 WHERE empresa_id = ${empresaId} AND ejercicio = ${year}
      GROUP BY periodo, tipo_libro ORDER BY periodo`;
    const ultimos = await sql`
      SELECT id, tipo_libro, tipo_comunicacion, ejercicio, periodo, estado, num_registros, registros_correctos, registros_con_errores, enviado_at, created_at
      FROM sii_envios_180 WHERE empresa_id = ${empresaId} ORDER BY created_at DESC LIMIT 5`;
    return { ...dashboard, mensual, ultimos_envios: ultimos };
  },

  async getEnvioDetalle(empresaId, envioId) {
    const [envio] = await sql`SELECT * FROM sii_envios_180 WHERE id = ${envioId} AND empresa_id = ${empresaId}`;
    if (!envio) return null;
    const registros = await sql`SELECT * FROM sii_registros_180 WHERE envio_id = ${envioId} ORDER BY created_at`;
    return { ...envio, registros };
  }
};

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Envía petición SOAP al servicio SII de la AEAT
 */
async function enviarSoapSii(endpoint, xmlBody, certData, entorno) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(xmlBody),
        'SOAPAction': ''
      }
    };

    // Load certificate (same pattern as verifactuAeatService)
    let certLoaded = false;
    try {
      let p12Der = null;

      if (certData?.certificado_data) {
        p12Der = forge.util.decode64(certData.certificado_data);
        console.log('[SII] Certificado cargado desde BD');
      }

      if (p12Der) {
        const p12Asn1 = forge.asn1.fromDer(p12Der);
        const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, certData?.password_cifrada || '', { strict: false });

        const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
        const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];

        if (certBags.length > 0 && keyBags.length > 0) {
          options.cert = forge.pki.certificateToPem(certBags[0].cert);
          options.key = forge.pki.privateKeyToPem(keyBags[0].key);
          options.rejectUnauthorized = entorno === 'produccion';
          certLoaded = true;
          console.log('[SII] Certificado PEM OK');
        }
      }
    } catch (error) {
      console.error('[SII] Error procesando certificado:', error.message);
      return reject(new Error(`Error certificado SII: ${error.message}`));
    }

    if (!certLoaded) {
      console.warn('[SII] Sin certificado - AEAT puede rechazar la peticion');
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ rawXml: data, statusCode: res.statusCode });
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Error conexion SII AEAT: ${error.message}`));
    });

    req.write(xmlBody);
    req.end();
  });
}

/**
 * Procesar respuesta XML de la AEAT
 */
function procesarRespuesta(xmlResponse) {
  if (!xmlResponse) {
    return { estado: 'rechazado', errorDesc: 'Sin respuesta de AEAT' };
  }

  // Detect SOAP Fault
  if (xmlResponse.includes('Fault>') || xmlResponse.includes('<faultstring>')) {
    const faultMatch = xmlResponse.match(/<faultstring>([^<]+)<\/faultstring>/);
    return {
      estado: 'rechazado',
      errorDesc: faultMatch ? faultMatch[1] : 'SOAP Fault desconocido'
    };
  }

  // Parse SII response
  const estadoEnvioMatch = xmlResponse.match(/EstadoEnvio>([^<]+)</);
  const csvMatch = xmlResponse.match(/CSV>([^<]+)</);
  const errorCodeMatch = xmlResponse.match(/CodigoErrorRegistro>([^<]+)</) || xmlResponse.match(/CodigoError>([^<]+)</);
  const errorDescMatch = xmlResponse.match(/DescripcionErrorRegistro>([^<]+)</) || xmlResponse.match(/DescripcionError>([^<]+)</);

  const estadoEnvio = estadoEnvioMatch ? estadoEnvioMatch[1] : null;

  let estado = 'rechazado';
  if (estadoEnvio === 'Correcto') estado = 'aceptado';
  else if (estadoEnvio === 'ParcialmenteCorrecto') estado = 'parcial';
  else if (estadoEnvio === 'Incorrecto') estado = 'rechazado';

  return {
    estado,
    aeatEstado: estadoEnvio,
    csv: csvMatch ? csvMatch[1] : null,
    errorCode: errorCodeMatch ? errorCodeMatch[1] : null,
    errorDesc: errorDescMatch ? errorDescMatch[1] : null
  };
}
