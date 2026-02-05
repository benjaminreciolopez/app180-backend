import express from 'express';
import { authRequired } from '../middlewares/authMiddleware.js';
import { roleRequired } from '../middlewares/roleRequired.js';
import {
  getConfig,
  startOAuth2,
  handleGoogleCallback,
  disconnect,
  testConnection,
  updateSettings
} from '../controllers/calendarConfigController.js';

const router = express.Router();

// Configuración de Google Calendar
router.get('/calendar-config', authRequired, roleRequired('admin'), getConfig);
router.post('/calendar-config/oauth2/start', authRequired, roleRequired('admin'), startOAuth2);
router.post('/calendar-config/oauth2/disconnect', authRequired, roleRequired('admin'), disconnect);
router.post('/calendar-config/test', authRequired, roleRequired('admin'), testConnection);
router.put('/calendar-config/settings', authRequired, roleRequired('admin'), updateSettings);

// Callback OAuth2 (sin auth, manejado por state)
router.get('/auth/google/calendar/callback', handleGoogleCallback);

export default router;
