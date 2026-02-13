import { sql } from "../db.js";
import { saveToStorage } from "../controllers/storageController.js";

/**
 * Configuración de tablas para Backup/Restore
 * name: nombre de la tabla
 * strategy: 'direct' (tiene empresa_id) | 'join' (depende de otra tabla)
 * parent: tabla padre (solo para strategy 'join')
 * fk: clave foránea hacia el padre (solo para strategy 'join')
 */
const TABLES_CONFIG = [
    { name: "configuracionsistema_180", strategy: "direct" },
    { name: "emisor_180", strategy: "direct" },
    { name: "empresa_calendar_config_180", strategy: "direct" },
    { name: "empresa_email_config_180", strategy: "direct" }, // Añadido
    { name: "clients_180", strategy: "direct" },
    { name: "client_fiscal_data_180", strategy: "join", parent: "clients_180", fk: "cliente_id" },
    { name: "employees_180", strategy: "direct" },
    { name: "employee_devices_180", strategy: "direct" }, // Añadido
    { name: "concepto_180", strategy: "direct" },
    { name: "work_logs_180", strategy: "direct" },
    { name: "partes_dia_180", strategy: "direct" },
    { name: "fichajes_180", strategy: "direct" },
    { name: "factura_180", strategy: "direct" },
    { name: "lineafactura_180", strategy: "join", parent: "factura_180", fk: "factura_id" },
    { name: "storage_180", strategy: "direct" }
];

const BACKUP_FILENAME = "backup_auto.json";
const BACKUP_FOLDER = "system_backups";

export const backupService = {
    /**
     * Genera un backup completo de la empresa y lo guarda en storage
     * @param {string} empresaId 
     */
    async generateBackup(empresaId) {
        console.log(`📦 [Backup] Iniciando backup para empresa ${empresaId}...`);
        const backupData = {
            empresaId,
            timestamp: new Date().toISOString(),
            version: "1.1",
            tables: {}
        };

        try {
            // 1. Leer datos de cada tabla
            for (const config of TABLES_CONFIG) {
                const table = config.name;
                try {
                    let rows = [];

                    if (config.strategy === 'direct') {
                        rows = await sql`SELECT * FROM ${sql(table)} WHERE empresa_id = ${empresaId}`;
                    } else if (config.strategy === 'join') {
                        // Subquery para obtener registros hijos
                        // SELECT * FROM hija WHERE fk IN (SELECT id FROM padre WHERE empresa_id = X)
                        rows = await sql`
                            SELECT t.* 
                            FROM ${sql(table)} t
                            WHERE t.${sql(config.fk)} IN (
                                SELECT p.id 
                                FROM ${sql(config.parent)} p 
                                WHERE p.empresa_id = ${empresaId}
                            )
                        `;
                    }

                    backupData.tables[table] = rows;
                    console.log(`   - ${table}: ${rows.length} registros`);

                } catch (err) {
                    if (err.code === '42P01') { // Undefined table
                        console.warn(`   ⚠️ Tabla ${table} no encontrada, saltando.`);
                    } else {
                        console.error(`   ❌ Error leyendo tabla ${table}:`, err.message);
                        // Opcional: throw err; si queremos integridad total. 
                        // Mejor loguear y continuar con lo que se pueda, o abortar?
                        // Para consistencia de datos, mejor abortar.
                        throw err;
                    }
                }
            }

            // 2. Convertir a Buffer
            const jsonContent = JSON.stringify(backupData, null, 2);
            const buffer = Buffer.from(jsonContent, "utf-8");

            // 3. Guardar en Storage
            const saved = await saveToStorage({
                empresaId,
                nombre: BACKUP_FILENAME,
                buffer,
                folder: BACKUP_FOLDER,
                mimeType: "application/json",
                useTimestamp: false,
                dbFolder: BACKUP_FOLDER
            });

            console.log(`✅ [Backup] Completado. Guardado en: ${saved?.storage_path}`);
            return saved;

        } catch (error) {
            console.error("❌ [Backup] Error generandp backup:", error);
            throw error;
        }
    },

    /**
     * Restaura el backup desde el storage
     * @param {string} empresaId 
     */
    async restoreBackup(empresaId) {
        console.log(`♻️ [Restore] Iniciando restauración para empresa ${empresaId}...`);

        const storagePath = `${empresaId}/${BACKUP_FOLDER}/${BACKUP_FILENAME}`;
        let backupData = null;

        // Leer archivo desde Supabase (o medio configurado)
        // Replicamos lógica de descarga ya que storageController no expone lectura directa server-side fácil
        try {
            const { createClient } = await import('@supabase/supabase-js');
            const supabaseUrl = process.env.SUPABASE_PROJECT_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

            if (supabaseUrl && supabaseKey) {
                const supabase = createClient(supabaseUrl, supabaseKey);
                const { data, error } = await supabase.storage
                    .from('app180-files')
                    .download(storagePath);

                if (error) throw error;
                const text = await data.text();
                backupData = JSON.parse(text);
            } else {
                throw new Error("Credenciales Supabase no configuradas para restore");
            }
        } catch (e) {
            console.error("❌ [Restore] Error descargando backup:", e.message);
            throw new Error("No se pudo leer el archivo de backup");
        }

        if (!backupData || !backupData.tables) {
            throw new Error("Archivo de backup inválido");
        }

        // 2. Transacción de restauración
        await sql.begin(async sql => {
            // A. Borrar datos actuales (Orden Inverso)
            const paramsReverse = [...TABLES_CONFIG].reverse();

            for (const config of paramsReverse) {
                const table = config.name;
                try {
                    if (config.strategy === 'direct') {
                        await sql`DELETE FROM ${sql(table)} WHERE empresa_id = ${empresaId}`;
                    } else if (config.strategy === 'join') {
                        // Borrar hijos via subquery
                        await sql`
                            DELETE FROM ${sql(table)}
                            WHERE ${sql(config.fk)} IN (
                                SELECT id FROM ${sql(config.parent)} WHERE empresa_id = ${empresaId}
                            )
                        `;
                    }
                    console.log(`   🗑️ [Restore] Datos limpiados de ${table}`);
                } catch (e) {
                    // Ignorar error si tabla no existe
                }
            }

            // B. Insertar datos (Orden Original)
            for (const config of TABLES_CONFIG) {
                const table = config.name;
                const rows = backupData.tables[table];

                if (!rows || rows.length === 0) continue;

                console.log(`   📥 [Restore] Insertando ${rows.length} registros en ${table}`);

                try {
                    // Chunking para insert masivo
                    const CHUNK_SIZE = 1000;
                    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
                        const chunk = rows.slice(i, i + CHUNK_SIZE);
                        await sql`INSERT INTO ${sql(table)} ${sql(chunk)}`;
                    }
                } catch (err) {
                    console.error(`   ❌ [Restore] Fallo insertando en ${table}:`, err.message);
                    if (err.code === '42P01') {
                        console.warn(`   ⚠️ Tabla ${table} no existe en destino, saltando.`);
                    } else {
                        throw err; // Abort transaction
                    }
                }
            }
        });

        console.log("✅ [Restore] Restauración completada con éxito.");
        return true;
    }
};
