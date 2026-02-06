import { sql } from "../src/db.js";

const KNOWLEDGE_BASE = [
    // ==========================================
    // SALUDOS Y CORTESÍA ABUNDANTE
    // ==========================================
    {
        response: "👋 ¡Hola! Soy CONTENDO, tu asistente para la gestión de APP180. ¿En qué puedo ayudarte hoy?",
        tokens: [
            "hola", "buenos dias", "buenas tardes", "buenas noches", "buenas",
            "que tal", "como estas", "que pasa", "hey", "saludos", "hola contendo",
            "estas ahi", "estas vivo", "funciona", "hola que tal", "holis",
            "alguien", "hay alguien", "hooola", "buenos días", "buenas tardes", "alo"
        ]
    },
    {
        response: "¡Hasta luego! Recuerda que estoy aquí 24/7 para ayudarte con tus facturas y clientes. 👋",
        tokens: [
            "adios", "chao", "hasta luego", "nos vemos", "cerrar", "salir",
            "bye", "agur", "me voy", "hasta mañana", "cerrar sesion", "apagar",
            "terminar", "fin", "venga adios", "hasta la vista"
        ]
    },
    {
        response: "¡De nada! Es un placer ayudarte. Si necesitas algo más, solo dilo. 😊",
        tokens: [
            "gracias", "muchas gracias", "ok gracias", "vale gracias", "te lo agradezco",
            "muy amable", "perfecto gracias", "genial gracias", "gracias guapo", "gracias maquina",
            "merci", "grax", "ok", "vale", "listo"
        ]
    },

    // ==========================================
    // CAPACIDADES / AYUDA / FALLBACK
    // ==========================================
    {
        response: `🤖 **¿Qué puedo hacer?**
Puedo ayudarte con muchas tareas de gestión:

📊 **Facturas:**
- *"Consultar facturas pendientes"*
- *"¿Cuánto hemos facturado este mes?"*
- *"Buscar facturas de [Cliente]"*

👥 **Clientes y Empleados:**
- *"Dame el teléfono de [Cliente]"*
- *"Listar empleados activos"*

📅 **Calendario:**
- *"¿Es festivo mañana?"*
- *"Añadir evento el viernes"*

Si mi cerebro principal está desconectado, seguiré respondiendo a estas preguntas básicas.`,
        tokens: [
            "que sabes hacer", "que puedes hacer", "ayuda", "socorro", "necesito ayuda",
            "como funcionas", "instrucciones", "manual", "que haces", "para que sirves",
            "menu", "comandos", "no se que hacer", "dime cosas", "capabilities",
            "que opciones tienes", "muestrame opciones", "help", "ayudame"
        ]
    },
    {
        response: "🧠 A veces mi conexión con la IA avanzada (Groq/Gemini) puede fallar por límites de cuota o red. Pero no te preocupes, tengo una base de datos local para responder urgencias. ¡Intenta ser específico con tu búsqueda!",
        tokens: [
            "error", "no funcionas", "estas roto", "fallo", "bug", "no va",
            "porque no vas", "me das error", "algo va mal", "tienes problemas",
            "quota exceeded", "limite excedido", "rate limit", "429", "resource exhausted",
            "no respondes", "te has roto", "estas tonto"
        ]
    },

    // ==========================================
    // DOMINIO: FACTURAS (Intents comunes)
    // ==========================================
    {
        response: "💰 Para consultar **facturas pendientes**, necesito acceder a la base de datos en tiempo real. Si mi Inteligencia Artificial está activa, solo pregúntame: *'Ver facturas pendientes de cobro'*. Si no respondo, revisa el panel de Facturas en la barra lateral.",
        tokens: [
            "cuanto me deben", "facturas pendientes", "pendiente de cobro", "impagados",
            "deudas", "dinero pendiente", "que me deben", "facturas sin pagar",
            "cobros pendientes", "morosos", "lista de morosos", "dinero en la calle",
            "ver facturas", "listar facturas", "facturas impagadas"
        ]
    },
    {
        response: "📊 Para ver estadísticas de facturación, prueba preguntando: *'Facturación de este mes'* o *'Diferencia con el año pasado'*. Recuerda que necesito estar conectado a mi cerebro IA para calcularlo.",
        tokens: [
            "cuanto he facturado", "facturacion", "estadisticas", "beneficios",
            "ganancias", "total facturado", "ventas", "ingresos", "resumen economico",
            "como va el mes", "como va el año", "numeros", "informe", "reporte"
        ]
    },

    // ==========================================
    // DOMINIO: CLIENTES / EMPLEADOS
    // ==========================================
    {
        response: "👥 Puedo buscar información de contacto de tus clientes. Simplemente dime: *'Teléfono de [Nombre Cliente]'* o *'Email de [Nombre Cliente]'*. Si no respondo, busca en la sección 'Clientes'.",
        tokens: [
            "telefono cliente", "email cliente", "datos cliente", "buscar cliente",
            "lista clientes", "clientes activos", "contacto cliente", "llamar cliente",
            "informacion cliente", "ver cliente"
        ]
    },
    {
        response: "👷‍♂️ Sobre los empleados, puedo decirte quién está activo o sus datos de contacto. Prueba: *'Listar empleados'*.",
        tokens: [
            "empleados", "trabajadores", "personal", "plantilla", "lista empleados",
            "quien trabaja", "empleados activos", "staff", "recursos humanos",
            "operarios", "lista trabajadores"
        ]
    },

    // ==========================================
    // OTROS / GENERAL
    // ==========================================
    {
        response: "📅 Gestiono el calendario laboral. Puedes preguntarme por festivos, cierres y crear eventos. Di 'festivos' para verlos.",
        tokens: [
            "calendario", "agenda", "festivos", "fiestas", "vacaciones", "dias libres",
            "cuando es fiesta", "puentes", "dias no laborables", "calendario laboral"
        ]
    },
    {
        response: "🔐 ¿Necesitas cambiar tu contraseña o datos? Ve a tu perfil en la esquina superior derecha.",
        tokens: [
            "cambiar contraseña", "mi perfil", "mis datos", "clave", "password",
            "usuario", "configuracion", "ajustes", "setup", "opciones"
        ]
    }
];

async function seed() {
    console.log("🚀 Iniciando siembra (seeding) de conocimiento...");

    try {
        // 1. Obtener ID de la empresa (buscamos en empleados ya que companies_180 parece no existir o tener otro nombre)
        const empleados = await sql`SELECT empresa_id FROM employees_180 LIMIT 1`;
        if (empleados.length === 0) {
            console.log("❌ No se encontró ningún empleado/empresa. Necesitamos un empresa_id válido.");
            process.exit(1);
        }
        const empresaId = empleados[0].empresa_id;

        console.log(`🏢 Empresa ID detectada para seeding: ${empresaId}`);

        console.log("🧹 Limpiando tokens de sistema antiguos...");
        // No borramos  toda la tabla, solo insertamos/actualizamos.

        let insertados = 0;
        let actualizados = 0;

        for (const item of KNOWLEDGE_BASE) {
            for (const token of item.tokens) {
                // Normalizamos el token (trim, lowercase)
                const tokenNorm = token.trim().toLowerCase();

                // Upsert: Si el token existe para esta empresa, actualizamos la respuesta. Si no, insertamos.

                const existing = await sql`
          SELECT id FROM conocimiento_180 
          WHERE empresa_id = ${empresaId} AND token = ${tokenNorm}
        `;

                if (existing.length > 0) {
                    // Actualizar
                    await sql`
                UPDATE conocimiento_180 
                SET respuesta = ${item.response}, updated_at = NOW()
                WHERE id = ${existing[0].id}
            `;
                    actualizados++;
                } else {
                    // Insertar
                    await sql`
                INSERT INTO conocimiento_180 (empresa_id, token, respuesta)
                VALUES (${empresaId}, ${tokenNorm}, ${item.response})
            `;
                    insertados++;
                }
            }
        }

        console.log(`✅ Proceso finalizado.`);
        console.log(`   - Nuevos tokens: ${insertados}`);
        console.log(`   - Actualizados: ${actualizados}`);
        console.log(`   - Total tokens activos: ${insertados + actualizados}`);

    } catch (err) {
        console.error("❌ Error en el seeding:", err);
    } finally {
        process.exit();
    }
}

seed();
