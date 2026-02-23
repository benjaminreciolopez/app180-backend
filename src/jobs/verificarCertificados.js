import { verificarTodosCertificados } from '../services/certificadoRenovacionService.js';

/**
 * Cron Job: Verificación Diaria de Certificados
 *
 * Verifica el estado de todos los certificados digitales y
 * crea notificaciones automáticas cuando estén próximos a caducar
 */

export async function verificarCertificadosJob() {
  try {
    console.log('⏰ Iniciando verificación diaria de certificados...');

    const resultado = await verificarTodosCertificados();

    console.log(`✅ Verificación completada:
      - Empresas verificadas: ${resultado.totalVerificados}
      - Notificaciones creadas: ${resultado.totalNotificaciones}
    `);

    return resultado;

  } catch (error) {
    console.error('❌ Error en verificación de certificados (cron):', error);
    throw error;
  }
}
