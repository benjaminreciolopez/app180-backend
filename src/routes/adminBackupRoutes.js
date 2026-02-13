import express from "express";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { adminBackupController } from "../controllers/adminBackupController.js";

import multer from "multer";

const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB max para backup
});

const router = express.Router();

router.post("/force", authRequired, roleRequired("admin"), adminBackupController.forceBackup);
router.post("/restore", authRequired, roleRequired("admin"), adminBackupController.restoreBackup);
router.post("/restore-upload", authRequired, roleRequired("admin"), upload.single("file"), adminBackupController.restoreFromUpload);
router.get("/download", authRequired, roleRequired("admin"), adminBackupController.downloadBackup);

export default router;
