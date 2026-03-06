import { sql } from '../db.js';
import { enviarRegistrosPendientes } from '../services/verifactuAeatService.js';

/**
 * Cron Job: Envío periódico de registros VeriFactu pendientes a AEAT
 *
 * Recorre todas las empresas con VeriFactu activo y envía cualquier
 * registro en estado PENDIENTE o que haya fallado anteriormente.
 * Actúa como respaldo del envío inmediato post-validación.
 */
export async function verifactuEnvioJob() {
    try {
        console.log('⏰ VeriFactu: iniciando envío de registros pendientes...');

        const empresas = await sql`
            SELECT empresa_id, verifactu_modo,
                   verifactu_certificado_path, verifactu_certificado_password
            FROM configuracionsistema_180
            WHERE verifactu_activo = true
              AND verifactu_modo IN ('PRUEBAS', 'PRODUCCION')
        `;

        if (empresas.length === 0) {
            console.log('ℹ️ VeriFactu: ninguna empresa con modo activo');
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
                console.error(`❌ VeriFactu: error procesando empresa ${cfg.empresa_id}:`, err.message);
            }
        }

        console.log(`✅ VeriFactu: ${totalEnviados} enviado(s), ${totalErrores} error(es)`);
    } catch (error) {
        console.error('❌ Error en verifactuEnvioJob:', error);
    }
}
