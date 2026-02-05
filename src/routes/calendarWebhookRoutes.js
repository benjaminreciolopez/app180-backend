import express from 'express';
import { authRequired } from '../middlewares/authMiddleware.js';
import { roleRequired } from '../middlewares/roleRequired.js';
import {
  handleWebhook,
  setup,
  stop
} from '../controllers/calendarWebhookController.js';

const router = express.Router();

// Webhook público (sin auth, validación por headers)
router.post('/calendar-webhook', handleWebhook);

// Gestión de webhooks (admin)
router.post('/calendar-webhook/setup', authRequired, roleRequired('admin'), setup);
router.post('/calendar-webhook/stop', authRequired, roleRequired('admin'), stop);

export default router;
