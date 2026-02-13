import { sql } from "../db.js";

/**
 * Inserta el conocimiento base (semilla) para una nueva empresa.
 * Estas entradas ayudan a "humanizar" a CONTENDO y a que conozca las funciones de la app.
 */
export async function seedKnowledge(empresaId) {
    const seedData = [
        {
            token: "ayuda",
            respuesta: "¡Hola! Soy CONTENDO, tu asistente inteligente en APP180. Puedo ayudarte a gestionar facturas, fichajes, clientes, trabajos y mucho más. Solo dime qué necesitas, como: '¿Qué facturas tengo pendientes?' o 'Registra una ausencia para Juan'.",
            categoria: "general",
            prioridad: 10
        },
        {
            token: "facturacion",
            respuesta: "En el módulo de facturación puedes crear borradores, validar facturas definitivas (cumpliendo con Veri*Factu de la AEAT) y gestionar rectificativas. También puedes descargar los PDFs y enviarlos por email directamente desde aquí.",
            categoria: "facturacion",
            prioridad: 5
        },
        {
            token: "fichajes",
            respuesta: "El sistema de fichajes permite a tus empleados registrar su jornada desde la web o el móvil. Registramos la geolocalización y el dispositivo para mayor seguridad. Como admin, puedes ver el mapa de fichajes y detectar anomalías.",
            categoria: "rrhh",
            prioridad: 5
        },
        {
            token: "trabajos",
            respuesta: "Los 'Work Logs' o trabajos permiten registrar las tareas realizadas para cada cliente. Puedes indicar los minutos y el precio. Luego, desde el generador de facturas, puedes convertir esos trabajos pendientes en facturas con un par de clics.",
            categoria: "gestion",
            prioridad: 5
        },
        {
            token: "calendario",
            respuesta: "Gestionamos el calendario de tu empresa con festivos (nacionales y locales) y cierres. Además, puedes sincronizarlo con Google Calendar para que tus eventos aparezcan en ambos sitios automáticamente.",
            categoria: "general",
            prioridad: 5
        },
        {
            token: "ausencias",
            respuesta: "Tus empleados pueden solicitar vacaciones, bajas médicas o permisos desde su panel. Tú, como administrador, recibirás la notificación para aprobarlas o rechazarlas, y se reflejarán automáticamente en el calendario.",
            categoria: "rrhh",
            prioridad: 5
        },
        {
            token: "backups",
            respuesta: "Tu seguridad es primordial. Realizamos copias de seguridad automáticas en la nube diariamente. Además, puedes descargar un backup local en formato JSON y restaurarlo en cualquier momento desde el panel de Almacenamiento.",
            categoria: "seguridad",
            prioridad: 5
        },
        {
            token: "clientes",
            respuesta: "Desde el módulo de clientes puedes gestionar toda tu base de datos, configurar tarifas personalizadas para cada uno y ver su historial de facturación y trabajos realizados.",
            categoria: "gestion",
            prioridad: 5
        },
        {
            token: "quien eres",
            respuesta: "Soy CONTENDO, la Inteligencia Artificial de APP180. Mi propósito es facilitarte la gestión diaria de tu empresa, respondiendo preguntas sobre tus datos y realizando acciones por ti para que ahorres tiempo.",
            categoria: "general",
            prioridad: 10
        }
    ];

    try {
        for (const item of seedData) {
            // Usar INSERT ... ON CONFLICT por si acaso (aunque para empresa nueva no debería haber nada)
            await sql`
        INSERT INTO conocimiento_180 (empresa_id, token, respuesta, categoria, prioridad)
        VALUES (${empresaId}, ${item.token}, ${item.respuesta}, ${item.categoria}, ${item.prioridad})
        ON CONFLICT (empresa_id, lower(token)) DO NOTHING
      `;
        }
        console.log(`✅ [KnowledgeSeed] Semilla insertada para empresa: ${empresaId}`);
    } catch (err) {
        console.error(`❌ [KnowledgeSeed] Error insertando semilla para empresa ${empresaId}:`, err);
    }
}
