import { sql } from './src/db.js';
import { app180ToGoogleEvent } from './src/services/googleCalendarService.js';

async function test() {
    try {
        const eventos = await sql`
      SELECT * FROM calendario_empresa_180
      LIMIT 1
    `;

        if (eventos.length === 0) {
            console.log('No hay eventos en la base de datos.');
            return;
        }

        const evento = eventos[0];
        console.log('Evento original (DB):', evento);
        console.log('Tipo de fecha:', typeof evento.fecha, evento.fecha instanceof Date ? 'es Date' : 'no es Date');

        const googleEvent = app180ToGoogleEvent(evento);
        console.log('Evento para Google:', JSON.stringify(googleEvent, null, 2));
    } catch (err) {
        console.error('Error en el test:', err);
    } finally {
        process.exit();
    }
}

test();
