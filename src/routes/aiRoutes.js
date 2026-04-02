import { Router } from "express";
import multer from "multer";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  chat, chatWithFile, status, usage,
  mcpConsumption, mcpConsumptionGlobal, mcpQuotas, mcpUpdateQuota,
  mcpPricing, mcpProviderCredits, mcpUpdateProviderCredits, mcpTrend,
  mcpUsers, mcpUserConsumption, mcpUserQuotas, mcpUpdateUserQuota,
  mcpToggleUserAI, mcpUpdateUserApp
} from "../controllers/aiController.js";

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

// ── MCP: Control centralizado cross-app ──
router.get("/ai/mcp/consumption", mcpConsumption);
router.get("/ai/mcp/consumption/global", mcpConsumptionGlobal);
router.get("/ai/mcp/quotas", mcpQuotas);
router.put("/ai/mcp/quotas", mcpUpdateQuota);
router.get("/ai/mcp/pricing", mcpPricing);
router.get("/ai/mcp/provider-credits", mcpProviderCredits);
router.put("/ai/mcp/provider-credits", mcpUpdateProviderCredits);
router.get("/ai/mcp/trend", mcpTrend);

// ── MCP: Superadmin - Gestión de usuarios cross-app ──
router.get("/ai/mcp/users", mcpUsers);
router.get("/ai/mcp/users/:userId/consumption", mcpUserConsumption);
router.get("/ai/mcp/users/:userId/quotas", mcpUserQuotas);
router.put("/ai/mcp/users/:userId/quotas", mcpUpdateUserQuota);
router.put("/ai/mcp/users/:userId/toggle-ai", mcpToggleUserAI);
router.put("/ai/mcp/users/:userId/app", mcpUpdateUserApp);

export default router;
