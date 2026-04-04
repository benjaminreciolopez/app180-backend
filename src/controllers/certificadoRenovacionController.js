import {
  verificarEstadoCertificados,
  generarInstruccionesRenovacion
} from '../services/certificadoRenovacionService.js';

/**
 * Controlador para renovación de certificados digitales
 */

/**
 * GET /admin/verifactu/certificado/renovacion/estado
 * Obtiene el estado de renovación de certificados
 */
export async function obtenerEstadoRenovacion(req, res) {
  try {
    const empresaId = req.empresaId;

    const estado = await verificarEstadoCertificados(empresaId);

    res.json({
      success: true,
      ...estado
    });

  } catch (error) {
    console.error('Error al obtener estado de renovación:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * GET /admin/verifactu/certificado/renovacion/instrucciones
 * Obtiene instrucciones detalladas de renovación
 */
export async function obtenerInstruccionesRenovacion(req, res) {
  try {
    const empresaId = req.empresaId;
    const { tipo } = req.query; // 'cliente' o 'fabricante'

    const estado = await verificarEstadoCertificados(empresaId);

    let certificadoSeleccionado = tipo === 'fabricante'
      ? estado.fabricante
      : estado.cliente;

    if (!certificadoSeleccionado) {
      return res.status(404).json({
        error: 'Certificado no encontrado o no configurado'
      });
    }

    const instrucciones = generarInstruccionesRenovacion(
      certificadoSeleccionado.tipoCertificado,
      certificadoSeleccionado.diasRestantes
    );

    res.json({
      success: true,
      certificado: {
        tipo,
        diasRestantes: certificadoSeleccionado.diasRestantes,
        fechaCaducidad: certificadoSeleccionado.fechaCaducidad,
        urgencia: certificadoSeleccionado.urgencia,
        linkRenovacion: certificadoSeleccionado.linkRenovacion
      },
      instrucciones
    });

  } catch (error) {
    console.error('Error al obtener instrucciones:', error);
    res.status(500).json({ error: error.message });
  }
}
