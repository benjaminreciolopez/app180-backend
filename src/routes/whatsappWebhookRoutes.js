import { Router } from "express";
import { handleWhatsAppMessage, handleWhatsAppStatus } from "../controllers/whatsappWebhookController.js";

const router = Router();

// Endpoints publicos - validados por API key en el controlador (sin JWT)
router.post("/webhook/whatsapp", handleWhatsAppMessage);
router.post("/webhook/whatsapp/status", handleWhatsAppStatus);

export default router;
