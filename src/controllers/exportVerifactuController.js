import { exportarRegistrosVerifactu, generarInformeCumplimiento } from '../services/exportVerifactuService.js';

/**
 * Controlador para exportación y descarga de registros VeriFactu
 */

/**
 * GET /admin/verifactu/exportar
 * Genera y descarga archivo ZIP con todos los registros
 */
export async function descargarRegistros(req, res) {
  try {
    const empresaId = req.empresaId;
    const usuarioId = req.userId;

    const {
      incluir_eventos = 'true',
      incluir_facturas_pdf = 'false',
      desde = null,
      hasta = null
    } = req.query;

    const options = {
      incluirEventos: incluir_eventos === 'true',
      incluirFacturasPDF: incluir_facturas_pdf === 'true',
      desde: desde ? new Date(desde) : null,
      hasta: hasta ? new Date(hasta) : null
    };

    // Generar archivo ZIP
    const archive = await exportarRegistrosVerifactu(empresaId, usuarioId, options);

    // Configurar headers de descarga
    const filename = `verifactu_registros_${empresaId}_${Date.now()}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Stream del ZIP al cliente
    archive.pipe(res);

    archive.on('error', (err) => {
      console.error('Error al generar ZIP:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error al generar archivo de exportación' });
      }
    });

  } catch (error) {
    console.error('Error al exportar registros:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * GET /admin/verifactu/informe-cumplimiento
 * Genera informe de cumplimiento VeriFactu
 */
export async function obtenerInformeCumplimiento(req, res) {
  try {
    const empresaId = req.empresaId;

    const informe = await generarInformeCumplimiento(empresaId);

    res.json({
      success: true,
      informe
    });

  } catch (error) {
    console.error('Error al generar informe:', error);
    res.status(500).json({ error: error.message });
  }
}
