// backend/src/controllers/appConfigController.js
// Lectura/escritura de app_config_180. Solo el fabricante puede editar.

import { listAllConfig, setConfig } from "../services/appConfigService.js";

const FABRICANTE_EMAIL = process.env.FABRICANTE_EMAIL || "susanaybenjamin@gmail.com";

function esFabricante(req) {
  return req.user?.email === FABRICANTE_EMAIL || req.user?.role === "fabricante";
}

export async function listarConfig(req, res) {
  try {
    const items = await listAllConfig();
    return res.json({ success: true, items });
  } catch (err) {
    console.error("Error listarConfig:", err);
    return res.status(500).json({ error: err.message || "Error" });
  }
}

export async function actualizarConfig(req, res) {
  try {
    if (!esFabricante(req)) {
      return res.status(403).json({ error: "Solo el fabricante puede editar la configuración global." });
    }
    const { clave } = req.params;
    const { valor } = req.body || {};
    if (!clave) return res.status(400).json({ error: "clave requerida" });
    const result = await setConfig(clave, valor ?? "", req.user?.id);
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error("Error actualizarConfig:", err);
    return res.status(500).json({ error: err.message || "Error" });
  }
}
