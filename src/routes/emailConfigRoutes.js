import express from "express";
import { authRequired, roleRequired } from "../middleware/auth.js";
import {
  getConfig,
  startOAuth2,
  handleGoogleCallback,
  disconnectOAuth2Handler,
  sendTestEmail
} from "../controllers/emailConfigController.js";

const router = express.Router();

// Get current email configuration
router.get("/email-config", authRequired, roleRequired("admin"), getConfig);

// Start OAuth2 flow
router.post("/email-config/oauth2/start", authRequired, roleRequired("admin"), startOAuth2);

// Disconnect OAuth2
router.post("/email-config/oauth2/disconnect", authRequired, roleRequired("admin"), disconnectOAuth2Handler);

// Send test email
router.post("/email-config/test", authRequired, roleRequired("admin"), sendTestEmail);

// OAuth2 callback (no auth required - handled by state parameter)
router.get("/auth/google/callback", handleGoogleCallback);

export default router;
