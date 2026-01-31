import express from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { downloadExport } from "../controllers/exportController.js";

const router = express.Router();

// Ruta universal de exportación
// Ejemplo: /admin/export/rentabilidad?format=pdf&desde=...
router.get("/:module", authRequired, downloadExport);

export default router;
