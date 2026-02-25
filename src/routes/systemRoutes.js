import { Router } from "express";
import { getSystemStatus, receiveTestReport } from "../controllers/systemController.js";
import rateLimit from "express-rate-limit";

const router = Router();

import { sql } from "../db.js";

router.get("/status", getSystemStatus);

// Test report endpoint - protected by API key, rate limited
const testReportLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: { error: "Demasiados reportes. Espera 1 hora." } });
router.post("/test-report", testReportLimiter, receiveTestReport);

router.get("/health", async (req, res) => {
  try {
    const [result] = await sql`SELECT 1 as ok`;
    res.json({ status: "ok", db: result?.ok === 1 ? "connected" : "error", timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ status: "error", db: "disconnected", error: e.message, timestamp: new Date().toISOString() });
  }
});

router.get("/migrate-billing-schema", async (req, res) => {
    try {
        await sql`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_logs_180' AND column_name='tipo_facturacion') THEN 
                    ALTER TABLE work_logs_180 ADD COLUMN tipo_facturacion TEXT DEFAULT 'hora'; 
                END IF; 
            END $$;
        `;
        res.json({ ok: true, message: "Migration executed" });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
