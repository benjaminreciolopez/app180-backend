import { backupService } from "../services/backupService.js";

export const adminBackupController = {
    /**
     * Forzar backup manual (POST /admin/backup/force)
     */
    async forceBackup(req, res) {
        try {
            const empresaId = req.user.empresa_id;
            const file = await backupService.generateBackup(empresaId);
            res.json({ success: true, message: "Backup generado correctamente", path: file.storage_path });
        } catch (error) {
            console.error("Error forceBackup:", error);
            res.status(500).json({ success: false, error: "Error generando backup" });
        }
    },

    /**
     * Restaurar desde el backup automático (POST /admin/backup/restore)
     */
    async restoreBackup(req, res) {
        try {
            const empresaId = req.user.empresa_id;
            // TODO: Verificar password o confirmación extra si es crítico?
            // Por ahora confiamos en que el usuario ya está autenticado como admin y ha confirmado en frontend.

            await backupService.restoreBackup(empresaId);
            res.json({ success: true, message: "Sistema restaurado correctamente desde el último backup" });
        } catch (error) {
            console.error("Error restoreBackup:", error);
            res.status(500).json({ success: false, error: error.message || "Error restaurando backup" });
        }
    },

    /**
     * Restaurar desde archivo subido (POST /admin/backup/restore-upload)
     */
    async restoreFromUpload(req, res) {
        try {
            const empresaId = req.user.empresa_id;

            if (!req.file) {
                return res.status(400).json({ success: false, error: "No se proporcionó archivo" });
            }

            // Leer contenido del archivo en memoria (buffer a string)
            const fileContent = req.file.buffer.toString('utf-8');
            let backupData;

            try {
                backupData = JSON.parse(fileContent);
            } catch (e) {
                return res.status(400).json({ success: false, error: "El archivo no es un JSON válido" });
            }

            // Validar estructura básica
            if (!backupData.tables) {
                return res.status(400).json({ success: false, error: "Estructura de backup inválida" });
            }

            await backupService.restoreFromData(empresaId, backupData);

            res.json({ success: true, message: "Sistema restaurado correctamente desde archivo local" });

        } catch (error) {
            console.error("Error restoreFromUpload:", error);
            res.status(500).json({ success: false, error: error.message || "Error restaurando desde archivo" });
        }
    }
};
