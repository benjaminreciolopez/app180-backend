/**
 * Cron Job: Weekly fiscal alert scan
 * Scans all companies with alerts enabled and generates notifications.
 */

import { runAlertScanAllCompanies } from "../services/fiscalAlertService.js";

export const runFiscalAlertScan = async () => {
    try {
        console.log("[FiscalAlerts] Starting weekly scan...");
        await runAlertScanAllCompanies();
        console.log("[FiscalAlerts] Weekly scan complete.");
    } catch (err) {
        console.error("[FiscalAlerts] Error in weekly scan:", err);
    }
};
