import { sql } from '../db.js';

/**
 * Middleware de cumplimiento VeriFactu
 *
 * CRÍTICO: Si un cliente tiene VeriFactu en PRODUCCIÓN,
 * debemos asegurar cumplimiento estricto de la normativa.
 */

/**
 * Verifica si la empresa tiene VeriFactu activo en PRODUCCIÓN
 */
async function tieneVerifactuProduccion(empresaId) {
  const [config] = await sql`
    SELECT verifactu_activo, verifactu_modo
    FROM configuracionsistema_180
    WHERE empresa_id = ${empresaId}
    LIMIT 1
  `;

  return config?.verifactu_activo && config?.verifactu_modo === 'PRODUCCION';
}

/**
 * Verifica si hay facturas YA registradas en VeriFactu
 */
async function tieneFacturasVerifactu(empresaId) {
  const [count] = await sql`
    SELECT COUNT(*) as total
    FROM registroverifactu_180
    WHERE empresa_id = ${empresaId}
      AND estado_envio = 'ENVIADO'
    LIMIT 1
  `;

  return parseInt(count.total) > 0;
}

/**
 * MIDDLEWARE: Prevenir operaciones peligrosas en modo PRODUCCIÓN
 *
 * Bloquea acciones que podrían romper el encadenamiento o
 * violar la normativa VeriFactu.
 */
export async function protegerVerifactuProduccion(req, res, next) {
  try {
    const empresaId = req.empresaId || req.body.empresaId;

    if (!empresaId) {
      return next(); // No podemos validar sin empresaId
    }

    const esProduccion = await tieneVerifactuProduccion(empresaId);

    if (!esProduccion) {
      return next(); // Si no está en producción, permitir
    }

    // Si está en PRODUCCIÓN, aplicar restricciones

    // 1. NO permitir cambiar de PRODUCCIÓN a TEST
    if (req.body.verifactu_modo === 'TEST' || req.body.verifactu_modo === 'OFF') {
      const tieneFacturas = await tieneFacturasVerifactu(empresaId);

      if (tieneFacturas) {
        return res.status(403).json({
          error: 'VERIFACTU_IRREVERSIBLE',
          mensaje: 'No se puede desactivar VeriFactu si ya hay facturas enviadas a AEAT. Esto violaría la normativa.',
          detalles: 'Una vez activado VeriFactu en PRODUCCIÓN y enviadas facturas, el sistema NO puede volver a TEST ni desactivarse.'
        });
      }
    }

    // 2. NO permitir eliminar facturas con registro VeriFactu ENVIADO
    if (req.method === 'DELETE' && req.url.includes('/factura')) {
      const facturaId = req.params.id || req.params.facturaId;

      if (facturaId) {
        const [registro] = await sql`
          SELECT id, estado_envio, numero_factura
          FROM registroverifactu_180
          WHERE factura_id = ${facturaId}
            AND estado_envio = 'ENVIADO'
          LIMIT 1
        `;

        if (registro) {
          return res.status(403).json({
            error: 'VERIFACTU_FACTURA_INMUTABLE',
            mensaje: `La factura ${registro.numero_factura} ya fue enviada a AEAT y no puede eliminarse.`,
            detalles: 'Las facturas con registro VeriFactu enviado son inmutables por ley.'
          });
        }
      }
    }

    // 3. NO permitir modificar facturas ENVIADAS a VeriFactu
    if ((req.method === 'PUT' || req.method === 'PATCH') && req.url.includes('/factura')) {
      const facturaId = req.params.id || req.params.facturaId;

      if (facturaId) {
        const [registro] = await sql`
          SELECT id, estado_envio, numero_factura
          FROM registroverifactu_180
          WHERE factura_id = ${facturaId}
            AND estado_envio = 'ENVIADO'
          LIMIT 1
        `;

        if (registro) {
          return res.status(403).json({
            error: 'VERIFACTU_FACTURA_INMUTABLE',
            mensaje: `La factura ${registro.numero_factura} ya fue enviada a AEAT y no puede modificarse.`,
            detalles: 'Solo se permite modificar facturas con estado VeriFactu = PENDIENTE o ERROR.'
          });
        }
      }
    }

    // 4. Advertir si falta certificado digital en PRODUCCIÓN
    if (req.url.includes('/verifactu/enviar') || req.url.includes('/factura') && req.method === 'POST') {
      const [config] = await sql`
        SELECT verifactu_certificado_path
        FROM configuracionsistema_180
        WHERE empresa_id = ${empresaId}
        LIMIT 1
      `;

      if (!config?.verifactu_certificado_path) {
        console.warn(`⚠️ Empresa ${empresaId} en PRODUCCIÓN VeriFactu sin certificado digital configurado`);
      }
    }

    next();

  } catch (error) {
    console.error('Error crítico en protegerVerifactuProduccion:', error);
    return res.status(500).json({
      error: 'VERIFACTU_COMPLIANCE_ERROR',
      mensaje: 'No se pudo verificar el cumplimiento VeriFactu. Operación bloqueada por seguridad.',
    });
  }
}

/**
 * MIDDLEWARE: Validar requisitos mínimos antes de activar PRODUCCIÓN
 *
 * Asegura que el cliente tenga todo listo antes de activar
 * VeriFactu en modo PRODUCCIÓN.
 */
export async function validarActivacionProduccion(req, res, next) {
  try {
    const { verifactu_activo, verifactu_modo, empresa_id } = req.body;

    // Solo validar si se está intentando activar PRODUCCIÓN
    if (!verifactu_activo || verifactu_modo !== 'PRODUCCION') {
      return next();
    }

    const empresaId = empresa_id || req.empresaId;

    if (!empresaId) {
      return next();
    }

    // Verificar datos del emisor
    const [emisor] = await sql`
      SELECT nif, nombre, razon_social, direccion, municipio, provincia, codigo_postal
      FROM emisor_180
      WHERE empresa_id = ${empresaId}
      LIMIT 1
    `;

    const errores = [];

    if (!emisor) {
      errores.push('No existe configuración de emisor');
    } else {
      if (!emisor.nif || emisor.nif.length < 9) {
        errores.push('NIF del emisor inválido o incompleto');
      }
      if (!emisor.nombre && !emisor.razon_social) {
        errores.push('Falta nombre o razón social del emisor');
      }
      if (!emisor.direccion) {
        errores.push('Falta dirección del emisor');
      }
      if (!emisor.municipio) {
        errores.push('Falta municipio del emisor');
      }
    }

    // Verificar certificado digital
    const [config] = await sql`
      SELECT verifactu_certificado_path, verifactu_certificado_password
      FROM configuracionsistema_180
      WHERE empresa_id = ${empresaId}
      LIMIT 1
    `;

    if (!config?.verifactu_certificado_path) {
      errores.push('⚠️ Certificado digital no configurado - Los envíos a AEAT fallarán');
    }

    // Verificar tipo de contribuyente para advertir sobre plazos
    const [empresa] = await sql`
      SELECT tipo_contribuyente
      FROM empresa_180
      WHERE id = ${empresaId}
      LIMIT 1
    `;

    const fechaLimite = empresa?.tipo_contribuyente === 'autonomo'
      ? '1 julio 2027'
      : '1 enero 2027';

    if (errores.length > 0) {
      return res.status(400).json({
        error: 'REQUISITOS_VERIFACTU_INCOMPLETOS',
        mensaje: 'No se puede activar VeriFactu en PRODUCCIÓN. Faltan requisitos:',
        errores: errores,
        advertencia: `Fecha límite obligatoria para ${empresa?.tipo_contribuyente || 'tu tipo de contribuyente'}: ${fechaLimite}`,
        recomendacion: 'Completa todos los datos del emisor y configura el certificado digital antes de activar PRODUCCIÓN.'
      });
    }

    // Advertencia final antes de activar
    console.log(`⚠️ IMPORTANTE: Empresa ${empresaId} está activando VeriFactu en PRODUCCIÓN`);
    console.log(`   Una vez activado y enviada la primera factura, será IRREVERSIBLE.`);

    next();

  } catch (error) {
    console.error('Error crítico en validarActivacionProduccion:', error);
    return res.status(500).json({
      error: 'VERIFACTU_COMPLIANCE_ERROR',
      mensaje: 'No se pudo validar los requisitos de activación VeriFactu. Operación bloqueada por seguridad.',
    });
  }
}

/**
 * Obtener estado de cumplimiento VeriFactu de una empresa
 */
export async function obtenerEstadoCumplimiento(empresaId) {
  const [config] = await sql`
    SELECT verifactu_activo, verifactu_modo, verifactu_certificado_path
    FROM configuracionsistema_180
    WHERE empresa_id = ${empresaId}
    LIMIT 1
  `;

  const [emisor] = await sql`
    SELECT nif, nombre, razon_social, direccion, municipio
    FROM emisor_180
    WHERE empresa_id = ${empresaId}
    LIMIT 1
  `;

  const [stats] = await sql`
    SELECT
      COUNT(*) as total_registros,
      SUM(CASE WHEN estado_envio = 'ENVIADO' THEN 1 ELSE 0 END) as enviados,
      SUM(CASE WHEN estado_envio = 'PENDIENTE' THEN 1 ELSE 0 END) as pendientes,
      SUM(CASE WHEN estado_envio = 'ERROR' THEN 1 ELSE 0 END) as errores
    FROM registroverifactu_180
    WHERE empresa_id = ${empresaId}
  `;

  const esProduccion = config?.verifactu_activo && config?.verifactu_modo === 'PRODUCCION';
  const tieneEnviados = parseInt(stats.enviados) > 0;

  // Validar cumplimiento
  const cumplimiento = {
    emisor_completo: !!(emisor?.nif && emisor?.nombre && emisor?.direccion && emisor?.municipio),
    certificado_configurado: !!config?.verifactu_certificado_path,
    registros_enviados: tieneEnviados,
    puede_desactivar: !tieneEnviados, // Solo se puede desactivar si NO hay facturas enviadas
    modo: config?.verifactu_modo || 'OFF',
    activo: !!config?.verifactu_activo
  };

  return {
    cumplimiento,
    config,
    emisor,
    estadisticas: {
      total: parseInt(stats.total_registros),
      enviados: parseInt(stats.enviados),
      pendientes: parseInt(stats.pendientes),
      errores: parseInt(stats.errores)
    },
    alertas: [
      !cumplimiento.emisor_completo && esProduccion ? '⚠️ Datos de emisor incompletos' : null,
      !cumplimiento.certificado_configurado && esProduccion ? '⚠️ Certificado digital no configurado' : null,
      tieneEnviados ? '🔒 VeriFactu BLOQUEADO - Hay facturas enviadas a AEAT (irreversible)' : null
    ].filter(Boolean)
  };
}
