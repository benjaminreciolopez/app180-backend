import express from 'express';
import { authRequired } from '../middlewares/authMiddleware.js';
import { roleRequired } from '../middlewares/roleRequired.js';
import {
  handleSyncToGoogle,
  handleSyncFromGoogle,
  handleSyncBidirectional,
  getStatus,
  getHistory
} from '../controllers/calendarSyncController.js';

const router = express.Router();

// Sincronización
router.post('/calendar-sync/to-google', authRequired, roleRequired('admin'), handleSyncToGoogle);
router.post('/calendar-sync/from-google', authRequired, roleRequired('admin'), handleSyncFromGoogle);
router.post('/calendar-sync/bidirectional', authRequired, roleRequired('admin'), handleSyncBidirectional);
router.get('/calendar-sync/status', authRequired, roleRequired('admin'), getStatus);
router.get('/calendar-sync/history', authRequired, roleRequired('admin'), getHistory);

export default router;
