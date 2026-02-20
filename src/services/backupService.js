import { sql } from "../db.js";
import { saveToStorage } from "../controllers/storageController.js";
import path from "path";
import fs from "fs";
import { registrarEventoVerifactu } from "../controllers/verifactuEventosController.js";

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
    { name: "empresa_180", strategy: "direct", pk: "id" },

    { name: "empresa_calendar_config_180", strategy: "direct" },
    { name: "empresa_email_config_180", strategy: "direct" },
    { name: "calendario_empresa_180", strategy: "direct" },


    // Clientes y Facturación
    { name: "clients_180", strategy: "direct" },
    { name: "client_fiscal_data_180", strategy: "join", parent: "clients_180", fk: "cliente_id" },
    { name: "concepto_180", strategy: "direct" },
    { name: "factura_180", strategy: "direct" },
    { name: "lineafactura_180", strategy: "join", parent: "factura_180", fk: "factura_id" },
    { name: "iva_180", strategy: "direct" },

    // Compras y Gastos
    { name: "purchases_180", strategy: "direct" },

    // Empleados y Jornadas
    { name: "employees_180", strategy: "direct" },
    { name: "employee_devices_180", strategy: "direct" },
    { name: "jornadas_180", strategy: "direct" },
    { name: "plantillas_jornada_180", strategy: "direct" },
    { name: "plantilla_dias_180", strategy: "join", parent: "plantillas_jornada_180", fk: "plantilla_id" },
    { name: "plantilla_bloques_180", strategy: "join", parent: "plantilla_dias_180", fk: "plantilla_dia_id" },
    { name: "plantilla_excepciones_180", strategy: "join", parent: "plantillas_jornada_180", fk: "plantilla_id" },
    { name: "plantilla_excepcion_bloques_180", strategy: "join", parent: "plantilla_excepciones_180", fk: "excepcion_id" },
    { name: "empleado_plantillas_180", strategy: "direct" },
    { name: "empleado_clientes_180", strategy: "direct" },
    { name: "ausencias_180", strategy: "direct" },
    { name: "ausencias_adjuntos_180", strategy: "join", parent: "ausencias_180", fk: "ausencia_id" },


    // Trabajo y Fichajes
    { name: "work_logs_180", strategy: "direct" },
    { name: "partes_dia_180", strategy: "direct" },
    { name: "fichajes_180", strategy: "direct" },

    // Nóminas
    { name: "nominas_180", strategy: "direct" },

    // Auditoría y Veri*Factu
    { name: "auditoria_180", strategy: "direct" },
    { name: "audit_log_180", strategy: "direct" },
    { name: "registroverifactu_180", strategy: "direct" },
    { name: "registroverifactueventos_180", strategy: "direct" },

    // Archivos
    { name: "storage_180", strategy: "direct" }
];

const BACKUP_FILENAME = "backup_auto.json";
const BACKUP_FOLDER = "system_backups";

export const backupService = {
    /**
     * Genera un backup completo de la empresa y lo guarda en storage
     * @param {string} empresaId 
     */
    async generateBackupData(empresaId) {
        console.log(`📦 [Backup] Generando datos de backup para empresa ${empresaId}...`);

        const backupData = {
            empresaId,
            timestamp: new Date().toISOString(),
            version: "1.1",
            tables: {}
        };

        // 1. Leer datos de cada tabla con seguimiento de IDs para relaciones
        const loadedIdsByTable = {};

        for (const config of TABLES_CONFIG) {
            const table = config.name;
            try {
                let rows = [];

                if (config.strategy === 'direct') {
                    const filterCol = config.pk || 'empresa_id';
                    rows = await sql`SELECT * FROM ${sql(table)} WHERE ${sql(filterCol)} = ${empresaId}`;
                } else if (config.strategy === 'join') {
                    const parentIds = loadedIdsByTable[config.parent] || [];

                    if (parentIds.length === 0) {
                        console.warn(`⚠️ [Backup] Saltando tabla ${table} porque no hay registros cargados del padre ${config.parent}`);
                        rows = [];
                    } else {
                        // Filtrar por los IDs ya cargados del padre
                        rows = await sql`
                            SELECT * 
                            FROM ${sql(table)} 
                            WHERE ${sql(config.fk)} IN ${sql(parentIds)}
                        `;
                    }
                }

                backupData.tables[table] = rows;
                // Guardar los IDs cargados para que las tablas hijas puedan usarlos
                loadedIdsByTable[table] = rows.map(r => r.id);
            } catch (error) {
                console.error(`   ❌ Error leyendo tabla ${table}:`, error.message);
                backupData.tables[table] = []; // Fallback para no romper todo el backup
                loadedIdsByTable[table] = [];
            }
        }
        return backupData;
    },

    async generateBackup(empresaId) {
        console.log(`📦 [Backup] Iniciando proceso de backup para empresa ${empresaId}...`);

        try {
            const backupData = await this.generateBackupData(empresaId);

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

            console.log(`✅ [Backup] Completado en Storage. Guardado en: ${saved?.storage_path}`);

            // 🔒 Registro Veri*Factu: Backup Generado
            registrarEventoVerifactu({
                empresaId,
                tipo_evento: 'BACKUP_GENERADO',
                descripcion: `Copia de seguridad integral generada. Path: ${saved?.storage_path}`,
                meta_data: { storage_path: saved?.storage_path, method: 'auto' }
            });

            // 4. Guardado Local (Sincronización solicitada por usuario)
            try {
                // Obtener configuración para ver si hay una ruta definida
                const [config] = await sql`SELECT backup_local_path FROM configuracionsistema_180 WHERE empresa_id = ${empresaId} LIMIT 1`;
                const customPath = config?.backup_local_path;

                let localBaseDir = customPath;
                let forceCreate = !!customPath;

                if (!localBaseDir) {
                    localBaseDir = path.join(process.cwd(), 'uploads', empresaId);
                }

                // Validación de ruta incongruente (Windows path en Linux)
                if (process.platform !== 'win32' && /^[a-zA-Z]:\\/.test(localBaseDir)) {
                    console.warn(`⚠️ [Backup] ATENCIÓN: Se ha detectado una ruta de Windows (${localBaseDir}) en un servidor ${process.platform}. El archivo se guardará localmente EN EL SERVIDOR rematadamente, no en tu PC.`);
                }

                console.log(`🔍 [Backup] Comprobando ruta local: ${localBaseDir}`);

                if (fs.existsSync(localBaseDir) || forceCreate) {
                    const localPath = path.join(localBaseDir, BACKUP_FOLDER, BACKUP_FILENAME);
                    if (!fs.existsSync(path.dirname(localPath))) {
                        fs.mkdirSync(path.dirname(localPath), { recursive: true });
                    }
                    fs.writeFileSync(localPath, jsonContent, "utf-8");

                    if (process.platform !== 'win32' && /^[a-zA-Z]:\\/.test(localBaseDir)) {
                        console.log(`ℹ️ [Backup] Almacenado en disco VIRTUAL del servidor: ${localPath}`);
                    } else {
                        console.log(`✅ [Backup] Sincronización local exitosa: ${localPath}`);
                    }
                }
                else {
                    console.log(`ℹ️ [Backup] Saltando sync local: La carpeta base por defecto no existe en el servidor y no hay ruta personalizada definida.`);
                }
            } catch (localError) {
                console.error("⚠️ [Backup] Error en sincronización local (no bloqueante):", localError.message);
            }

            return saved;

        } catch (error) {
            console.error("❌ [Backup] Error generando backup:", error);
            throw error;
        }
    },

    /**
     * Lógica core de restauración a partir de un objeto de datos
     * @param {string} empresaId 
     * @param {object} backupData 
     */
    async restoreFromData(empresaId, backupData) {
        if (!backupData || !backupData.tables) {
            throw new Error("Datos de backup inválidos");
        }

        // Transacción de restauración
        return await sql.begin(async sql => {
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

            // 🔒 Registro Veri*Factu: Restauración Sistema
            registrarEventoVerifactu({
                empresaId,
                tipo_evento: 'RESTAURACION_SISTEMA',
                descripcion: `Restauración completa del sistema realizada con éxito.`
            });

            return true;
        });
    },

    /**
     * Restaura el backup desde el storage
     * @param {string} empresaId 
     */
    async restoreBackup(empresaId) {
        console.log(`♻️ [Restore] Iniciando restauración desde Storage para empresa ${empresaId}...`);

        const storagePath = `${empresaId}/${BACKUP_FOLDER}/${BACKUP_FILENAME}`;
        let backupData = null;

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

        // Llamar a la lógica core extracted
        await this.restoreFromData(empresaId, backupData);

        console.log("✅ [Restore] Restauración completada con éxito.");
        return true;
    }
};
