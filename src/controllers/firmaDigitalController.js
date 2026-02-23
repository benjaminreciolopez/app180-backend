import {
  validarCertificado,
  obtenerNIFCertificado,
  firmarRegistroDoble
} from '../services/firmaDigitalService.js';
import { sql } from '../db.js';

/**
 * Controlador para gestión de certificados digitales y firma
 */

/**
 * POST /admin/verifactu/certificado/validar
 * Valida un certificado digital (cliente o fabricante)
 */
export async function validarCertificadoDigital(req, res) {
  try {
    const { tipo } = req.body; // 'cliente' o 'fabricante'
    const empresaId = req.empresaId;

    // Obtener configuración
    const [config] = await sql`
      SELECT
        verifactu_certificado_path as cert_cliente_path,
        verifactu_certificado_password as cert_cliente_pass,
        verifactu_cert_fabricante_path as cert_fabricante_path,
        verifactu_cert_fabricante_password as cert_fabricante_pass
      FROM configuracionsistema_180
      WHERE empresa_id = ${empresaId}
    `;

    if (!config) {
      return res.status(404).json({ error: 'Configuración no encontrada' });
    }

    let certificadoPath, password;

    if (tipo === 'fabricante') {
      certificadoPath = config.cert_fabricante_path;
      password = config.cert_fabricante_pass;
    } else {
      certificadoPath = config.cert_cliente_path;
      password = config.cert_cliente_pass;
    }

    if (!certificadoPath) {
      return res.status(400).json({
        error: `Certificado ${tipo} no configurado`
      });
    }

    // Validar certificado
    const resultado = await validarCertificado(certificadoPath, password);

    res.json({
      success: resultado.valido,
      tipo,
      ...resultado
    });

  } catch (error) {
    console.error('❌ Error al validar certificado:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * POST /admin/verifactu/certificado/info
 * Obtiene información de un certificado sin validarlo
 */
export async function obtenerInfoCertificado(req, res) {
  try {
    const { tipo } = req.body;
    const empresaId = req.empresaId;

    const [config] = await sql`
      SELECT
        verifactu_certificado_path as cert_cliente_path,
        verifactu_certificado_password as cert_cliente_pass,
        verifactu_cert_fabricante_path as cert_fabricante_path,
        verifactu_cert_fabricante_password as cert_fabricante_pass
      FROM configuracionsistema_180
      WHERE empresa_id = ${empresaId}
    `;

    if (!config) {
      return res.status(404).json({ error: 'Configuración no encontrada' });
    }

    let certificadoPath, password;

    if (tipo === 'fabricante') {
      certificadoPath = config.cert_fabricante_path;
      password = config.cert_fabricante_pass;
    } else {
      certificadoPath = config.cert_cliente_path;
      password = config.cert_cliente_pass;
    }

    if (!certificadoPath) {
      return res.status(400).json({
        error: `Certificado ${tipo} no configurado`
      });
    }

    // Validar y obtener info
    const resultado = await validarCertificado(certificadoPath, password);

    res.json({
      success: true,
      tipo,
      info: resultado.info
    });

  } catch (error) {
    console.error('❌ Error al obtener info de certificado:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * POST /admin/verifactu/certificado/fabricante/configurar
 * Configura el certificado del FABRICANTE
 */
export async function configurarCertificadoFabricante(req, res) {
  try {
    const {
      certificado_path,
      certificado_password,
      nombre_fabricante,
      nif_fabricante
    } = req.body;

    const empresaId = req.empresaId;

    if (!certificado_path || !certificado_password) {
      return res.status(400).json({
        error: 'Faltan certificado_path y/o certificado_password'
      });
    }

    // Validar certificado antes de guardarlo
    const validacion = await validarCertificado(certificado_path, certificado_password);

    if (!validacion.valido) {
      return res.status(400).json({
        error: 'Certificado inválido o expirado',
        detalle: validacion.mensaje
      });
    }

    // Obtener NIF del certificado
    const nifCert = await obtenerNIFCertificado(certificado_path, certificado_password);

    // Guardar en configuración
    await sql`
      UPDATE configuracionsistema_180
      SET
        verifactu_cert_fabricante_path = ${certificado_path},
        verifactu_cert_fabricante_password = ${certificado_password},
        verifactu_info_fabricante = ${JSON.stringify({
          nombre: nombre_fabricante || validacion.info?.subject?.O || '',
          nif: nif_fabricante || nifCert,
          certificado_info: validacion.info,
          fecha_configuracion: new Date().toISOString()
        })}
      WHERE empresa_id = ${empresaId}
    `;

    res.json({
      success: true,
      mensaje: 'Certificado de fabricante configurado correctamente',
      info: validacion.info
    });

  } catch (error) {
    console.error('❌ Error al configurar certificado fabricante:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * POST /admin/verifactu/certificado/configurar-auto
 * Configura el MISMO certificado para cliente Y fabricante (para autónomos)
 *
 * Caso de uso: El fabricante del software es autónomo y usa el mismo
 * certificado digital para ambas cosas
 */
export async function configurarCertificadoAuto(req, res) {
  try {
    const {
      certificado_path,
      certificado_password,
      nombre_fabricante,
      nif_fabricante
    } = req.body;

    const empresaId = req.empresaId;
    const usuarioId = req.userId;

    if (!certificado_path || !certificado_password) {
      return res.status(400).json({
        error: 'Faltan certificado_path y/o certificado_password'
      });
    }

    // Validar certificado antes de guardarlo
    const validacion = await validarCertificado(certificado_path, certificado_password);

    if (!validacion.valido) {
      return res.status(400).json({
        error: 'Certificado inválido o expirado',
        detalle: validacion.mensaje
      });
    }

    // Obtener NIF del certificado
    const nifCert = await obtenerNIFCertificado(certificado_path, certificado_password);

    // Configurar AMBOS con el mismo certificado
    await sql`
      UPDATE configuracionsistema_180
      SET
        -- Certificado del CLIENTE
        verifactu_certificado_path = ${certificado_path},
        verifactu_certificado_password = ${certificado_password},

        -- Certificado del FABRICANTE (el mismo)
        verifactu_cert_fabricante_path = ${certificado_path},
        verifactu_cert_fabricante_password = ${certificado_password},
        verifactu_info_fabricante = ${JSON.stringify({
          nombre: nombre_fabricante || validacion.info?.subject?.CN || '',
          nif: nif_fabricante || nifCert,
          certificado_info: validacion.info,
          fecha_configuracion: new Date().toISOString(),
          configurado_por_usuario: usuarioId
        })}
      WHERE empresa_id = ${empresaId}
    `;

    res.json({
      success: true,
      mensaje: '✅ Certificado configurado para CLIENTE y FABRICANTE',
      info: {
        certificado: validacion.info,
        nif: nifCert,
        configuraciones: {
          cliente: true,
          fabricante: true
        }
      }
    });

  } catch (error) {
    console.error('❌ Error al configurar certificado automático:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * GET /admin/verifactu/certificado/estado
 * Obtiene el estado de ambos certificados (cliente + fabricante)
 */
export async function obtenerEstadoCertificados(req, res) {
  try {
    const empresaId = req.empresaId;

    const [config] = await sql`
      SELECT
        verifactu_certificado_path as cert_cliente_path,
        verifactu_certificado_password as cert_cliente_pass,
        verifactu_cert_fabricante_path as cert_fabricante_path,
        verifactu_cert_fabricante_password as cert_fabricante_pass,
        verifactu_info_fabricante
      FROM configuracionsistema_180
      WHERE empresa_id = ${empresaId}
    `;

    if (!config) {
      return res.status(404).json({ error: 'Configuración no encontrada' });
    }

    // Validar certificado del cliente
    let estadoCliente = { configurado: false };
    if (config.cert_cliente_path) {
      try {
        const validacion = await validarCertificado(
          config.cert_cliente_path,
          config.cert_cliente_pass
        );
        estadoCliente = {
          configurado: true,
          valido: validacion.valido,
          mensaje: validacion.mensaje,
          info: validacion.info
        };
      } catch (error) {
        estadoCliente = {
          configurado: true,
          valido: false,
          mensaje: `Error: ${error.message}`
        };
      }
    }

    // Validar certificado del fabricante
    let estadoFabricante = { configurado: false };
    if (config.cert_fabricante_path) {
      try {
        const validacion = await validarCertificado(
          config.cert_fabricante_path,
          config.cert_fabricante_pass
        );
        estadoFabricante = {
          configurado: true,
          valido: validacion.valido,
          mensaje: validacion.mensaje,
          info: validacion.info,
          info_fabricante: config.verifactu_info_fabricante
        };
      } catch (error) {
        estadoFabricante = {
          configurado: true,
          valido: false,
          mensaje: `Error: ${error.message}`
        };
      }
    }

    const ambosConfigurados = estadoCliente.configurado && estadoFabricante.configurado;
    const ambosValidos = estadoCliente.valido && estadoFabricante.valido;

    res.json({
      success: true,
      cliente: estadoCliente,
      fabricante: estadoFabricante,
      ambos_configurados: ambosConfigurados,
      ambos_validos: ambosValidos,
      puede_firmar: ambosConfigurados && ambosValidos
    });

  } catch (error) {
    console.error('❌ Error al obtener estado de certificados:', error);
    res.status(500).json({ error: error.message });
  }
}
