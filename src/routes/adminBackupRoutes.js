import express from "express";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { adminBackupController } from "../controllers/adminBackupController.js";

const router = express.Router();

router.post("/force", authRequired, roleRequired("admin"), adminBackupController.forceBackup);
router.post("/restore", authRequired, roleRequired("admin"), adminBackupController.restoreBackup);

export default router;
