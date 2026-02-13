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
    }
};
