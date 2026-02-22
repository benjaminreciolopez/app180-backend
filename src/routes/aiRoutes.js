import { Router } from "express";
import multer from "multer";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { chat, chatWithFile, status, usage } from "../controllers/aiController.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Todas las rutas requieren autenticación y rol admin
router.use(authRequired, roleRequired("admin"));

// POST /admin/ai/chat - Chat con el agente IA
router.post("/ai/chat", chat);

// POST /admin/ai/chat-file - Chat con archivo adjunto (QR + OCR)
router.post("/ai/chat-file", upload.single("file"), chatWithFile);

// GET /admin/ai/usage - Consumo de IA del usuario
router.get("/ai/usage", usage);

// GET /admin/ai/status - Estado del servicio de IA
router.get("/ai/status", status);

export default router;
