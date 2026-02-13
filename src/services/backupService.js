import { sql } from "../db.js";
import { saveToStorage } from "../controllers/storageController.js";

/**
 * Tablas a incluir en el backup, en orden de dependencia (padres primero para insert, se borrarán en orden inverso)
 * NOTA: 'empresa_180' y 'users_180' NO se incluyen porque son la base de la cuenta. 
 * El backup es DE LOS DATOS de la empresa.
 */
const TABLES = [
    "configuracionsistema_180",
    "emisor_180",
    "empresa_calendar_config_180",
    "clients_180",
    "client_fiscal_data_180", // depende de clients
    "employees_180",
    "concepto_180",
    "work_logs_180", // depende de clients, employees, conceptos
    "partes_dia_180",
    "fichajes_180", // depende de employees
    "factura_180", // depende de clients, work_logs (opcional)
    "lineafactura_180", // depende de factura, concepto
    "presupuesto_180", // si existe
    "lineapresupuesto_180", // si existe
    "storage_180" // Metadata de archivos (Ojo: si restauramos, los archivos físicos deben existir)
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
            version: "1.0",
            tables: {}
        };

        try {
            // 1. Leer datos de cada tabla
            for (const table of TABLES) {
                try {
                    // Verificar si la tabla existe queryeando (chapuza pero efectiva si no tenemos schema info a mano)
                    // Mejor: asumo que existen las que sé. Si falla alguna query, log y continue?
                    // Para seguridad, usaremos sql dinámico con la tabla.
                    // Postgres no permite param para table name, hay que interpolar con cuidado o usar sql(table) si la lib lo soporta.
                    // La lib `postgres` soporta sql(table) para identificadores.

                    const rows = await sql`SELECT * FROM ${sql(table)} WHERE empresa_id = ${empresaId}`;
                    backupData.tables[table] = rows;
                    console.log(`   - ${table}: ${rows.length} registros`);
                } catch (err) {
                    if (err.code === '42P01') { // Undefined table
                        console.warn(`   ⚠️ Tabla ${table} no encontrada, saltando.`);
                    } else {
                        console.error(`   ❌ Error leyendo tabla ${table}:`, err.message);
                        throw err;
                    }
                }
            }

            // 2. Convertir a Buffer
            const jsonContent = JSON.stringify(backupData, null, 2);
            const buffer = Buffer.from(jsonContent, "utf-8");

            // 3. Guardar en Storage (Sobrescribiendo backup_auto.json)
            // Usamos saveToStorage pero con un nombre fijo para "Backup Automático"
            // Si queremos historico, podríamos añadir fecha, pero el requerimiento es "se actualice cada vez... para que no ocupe mucho espacio".
            // Así que sobrescribimos el mismo archivo 'backup_auto.json'.

            const saved = await saveToStorage({
                empresaId,
                nombre: BACKUP_FILENAME,
                buffer,
                folder: BACKUP_FOLDER,
                mimeType: "application/json",
                useTimestamp: false, // Importante: NO usar timestamp en el nombre para sobrescribir
                dbFolder: BACKUP_FOLDER
            });

            console.log(`✅ [Backup] Completado. Guardado en: ${saved?.storage_path}`);
            return saved;

        } catch (error) {
            console.error("❌ [Backup] Error generando backup:", error);
            throw error;
        }
    },

    /**
     * Restaura el backup desde el storage
     * @param {string} empresaId 
     */
    async restoreBackup(empresaId) {
        console.log(`♻️ [Restore] Iniciando restauración para empresa ${empresaId}...`);

        // 1. Buscar el archivo de backup
        // Asumimos que está en la carpeta system_backups con el nombre fijo
        // Pero el 'saveToStorage' construye el path como: empresaId/folder/nombre
        const storagePath = `${empresaId}/${BACKUP_FOLDER}/${BACKUP_FILENAME}`;

        // Necesitamos descargar el contenido. 
        // Como estamos en backend y quizás usamos Supabase o FS local, necesitamos una forma de "leer" el fichero.
        // 'storageController' no tiene un 'readFile' expuesto helper, solo download via HTTP redirect.
        // Tendremos que implementar lectura directa aquí o añadir helper en storageController.
        // Asumiré acceso a supabase directo si está configurado, o FS local.

        let backupData = null;

        // Importar dependencias dinámicamente o usar las de arriba si movemos lógica
        // Voy a duplicar la logica de inicializacion de supabase de storageController aqui o exportarla?
        // Mejor importar supabase si se exportara, pero storageController no exporta la instancia.
        // Copiaré la inicialización de supabase aqui brevemente.

        const { createClient } = await import('@supabase/supabase-js');
        const supabaseUrl = process.env.SUPABASE_PROJECT_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (supabaseUrl && supabaseKey) {
            const supabase = createClient(supabaseUrl, supabaseKey);
            const { data, error } = await supabase.storage
                .from('app180-files')
                .download(storagePath);

            if (error) {
                console.error("❌ [Restore] No se encontró el archivo de backup en Supabase:", error);
                throw new Error("Backup no encontrado");
            }

            const text = await data.text();
            backupData = JSON.parse(text);
        } else {
            // Fallback local (si implementado)
            // Por ahora asumo entorno prod con Supabase.
            throw new Error("Restauración local no implementada aun. Configura Supabase.");
        }

        if (!backupData || !backupData.tables) {
            throw new Error("Archivo de backup inválido o corrupto");
        }

        // 2. Transacción de restauración
        await sql.begin(async sql => {
            // A. Borrar datos actuales (Orden Inverso)
            const tablesReverse = [...TABLES].reverse();
            for (const table of tablesReverse) {
                // Evitar borrar storage_180 si es metadata de archivos que SI existen?
                // El requerimiento dice "restaurar esa copia". Si borramos storage_180, perdemos referencias a otros archivos que no sean el backup.
                // PERO el backup contiene la tabla storage_180.
                // Si restauramos, deberíamos restaurar tal cual estaba.
                // Ojo con borrar el propio archivo de backup de la DB antes de terminar la restore.
                // La tabla storage_180 tiene el registro del backup. Si lo borramos, no pasa nada en la transacción siempre que el archivo físico siga ahí.

                try {
                    await sql`DELETE FROM ${sql(table)} WHERE empresa_id = ${empresaId}`;
                    console.log(`   🗑️ [Restore] Datos borrados de ${table}`);
                } catch (e) {
                    // Ignore undefined tables
                }
            }

            // B. Insertar datos (Orden Original)
            for (const table of TABLES) {
                const rows = backupData.tables[table];
                if (!rows || rows.length === 0) continue;

                console.log(`   📥 [Restore] Insertando ${rows.length} registros en ${table}`);

                // Insertar en lotes o masivo
                // sql(rows) inserta los objetos tal cual. Las columnas deben coincidir.
                // OJO: Postgres insert helper de `postgres.js` es muy potente: sql`insert into x ${sql(rows)}`
                try {
                    // Chunking por si son muchos? Postgres.js maneja bien params (hasta 65k).
                    // Si son > 1000, mejor chunk.
                    const CHUNK_SIZE = 1000;
                    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
                        const chunk = rows.slice(i, i + CHUNK_SIZE);
                        await sql`INSERT INTO ${sql(table)} ${sql(chunk)}`;
                    }
                } catch (err) {
                    console.error(`   ❌ [Restore] Fallo insertando en ${table}:`, err.message);
                    if (err.code === '42P01') {
                        console.warn(`   ⚠️ Tabla ${table} no existe en destino, saltando datos.`);
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
