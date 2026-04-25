import { sql } from '../db.js';
import { enviarRegistrosPendientes } from '../services/verifactuAeatService.js';
import logger from '../utils/logger.js';

/**
 * Cron Job: Envío periódico de registros VeriFactu pendientes a AEAT.
 *
 * Recorre todas las empresas con VeriFactu activo y delega a
 * `enviarRegistrosPendientes`, que procesa tanto registros PENDIENTE
 * como ERROR cuyo backoff exponencial ya ha vencido.
 */
export async function verifactuEnvioJob() {
    try {
        logger.info('verifactuEnvioJob start');

        const empresas = await sql`
            SELECT empresa_id, verifactu_modo,
                   verifactu_certificado_path, verifactu_certificado_password
            FROM configuracionsistema_180
            WHERE verifactu_activo = true
              AND verifactu_modo IN ('PRUEBAS', 'PRODUCCION')
        `;

        if (empresas.length === 0) {
            logger.info('verifactuEnvioJob: no companies with active mode');
            return;
        }

        let totalEnviados = 0;
        let totalErrores = 0;

        for (const cfg of empresas) {
            try {
                const entorno = cfg.verifactu_modo === 'PRODUCCION' ? 'PRODUCCION' : 'PRUEBAS';
                const resultado = await enviarRegistrosPendientes(
                    cfg.empresa_id,
                    entorno,
                    cfg.verifactu_certificado_path,
                    cfg.verifactu_certificado_password
                );
                totalEnviados += resultado?.enviados || 0;
                totalErrores += resultado?.errores || 0;
            } catch (err) {
                logger.error('verifactuEnvioJob: empresa failed', {
                    empresa_id: cfg.empresa_id,
                    message: err.message
                });
            }
        }

        logger.info('verifactuEnvioJob done', { totalEnviados, totalErrores });
    } catch (error) {
        logger.error('verifactuEnvioJob crashed', { message: error.message, stack: error.stack });
    }
}
