import { sql } from "./src/db.js";
import { registrarAuditoria } from "./src/middlewares/auditMiddleware.js";

async function test() {
    try {
        const [empresa] = await sql`SELECT id FROM empresa_180 LIMIT 1`;
        const [user] = await sql`SELECT id FROM users_180 LIMIT 1`;

        if (!empresa || !user) {
            console.error("No hay empresa o usuario para testear");
            process.exit(1);
        }

        console.log("Testeando registrarAuditoria...");
        await registrarAuditoria({
            empresaId: empresa.id,
            userId: user.id,
            accion: 'test_manual',
            entidadTipo: 'test',
            entidadId: '000',
            motivo: 'Verificación manual de funcionamiento'
        });
        console.log("Llamada completada.");

        const last = await sql`SELECT * FROM audit_log_180 WHERE accion = 'test_manual' ORDER BY created_at DESC LIMIT 1`;
        console.log("Resultado insert:", last);

    } catch (err) {
        console.error("Error en test:", err);
    } finally {
        process.exit();
    }
}

test();
