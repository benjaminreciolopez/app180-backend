import { sql } from "../src/db.js";

async function addKnowledge() {
    const token = process.argv[2];
    const respuesta = process.argv[3];

    if (!token || !respuesta) {
        console.log("❌ Uso: node scripts/add_knowledge.js \"<token/pregunta>\" \"<respuesta>\"");
        process.exit(1);
    }

    try {
        // Buscar una empresa (tomamos la primera para facilitar, o se podría pasar como arg)
        const empresas = await sql`SELECT id, nombre FROM companies_180 LIMIT 1`;
        if (empresas.length === 0) {
            console.log("❌ No se encontró ninguna empresa en la base de datos.");
            process.exit(1);
        }
        const empresa = empresas[0];

        await sql`
      INSERT INTO conocimiento_180 (empresa_id, token, respuesta)
      VALUES (${empresa.id}, ${token}, ${respuesta})
    `;

        console.log(`✅ Conocimiento añadido para empresa "${empresa.nombre}":`);
        console.log(`   📝 Token: ${token}`);
        console.log(`   💡 Respuesta: ${respuesta}`);

    } catch (err) {
        console.error("❌ Error:", err);
    } finally {
        process.exit();
    }
}

addKnowledge();
