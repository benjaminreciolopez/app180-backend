// backend/src/controllers/siiController.js
// Controller for SII (Suministro Inmediato de Informacion) asesor routes

import { siiService } from "../services/siiService.js";
import { sql } from "../db.js";

// ─── GET SII CONFIG ─────────────────────────────────────────

export async function getSiiConfig(req, res) {
  try {
    const { empresa_id } = req.params;
    const config = await siiService.getSiiConfig(empresa_id);

    res.json({
      success: true,
      data: config || {
        sii_activo: false,
        sii_obligatorio: false,
        modo: 'manual',
        entorno: 'pruebas',
      },
    });
  } catch (err) {
    console.error("Error getSiiConfig:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

// ─── UPDATE SII CONFIG ─────────────────────────────────────

export async function updateSiiConfig(req, res) {
  try {
    const { empresa_id } = req.params;
    const {
      sii_activo, sii_obligatorio, fecha_alta_sii, modo, entorno,
      certificado_id, notas, sii_motivo, sii_inicio, envio_automatico,
    } = req.body;

    const updated = await siiService.updateSiiConfig(empresa_id, {
      sii_activo,
      sii_motivo,
      sii_inicio: sii_inicio || fecha_alta_sii,
      certificado_id,
      envio_automatico,
      entorno,
    });

    // Update extended fields
    if (updated) {
      await sql`
        UPDATE sii_config_180
        SET sii_obligatorio = COALESCE(${sii_obligatorio ?? null}, sii_obligatorio),
            fecha_alta_sii = COALESCE(${fecha_alta_sii ?? null}, fecha_alta_sii),
            modo = COALESCE(${modo ?? null}, modo),
            notas = COALESCE(${notas ?? null}, notas),
            updated_at = now()
        WHERE empresa_id = ${empresa_id}
      `;
    }

    const config = await siiService.getSiiConfig(empresa_id);
    res.json({ success: true, data: config });
  } catch (err) {
    console.error("Error updateSiiConfig:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

// ─── GET SII ENVIOS ─────────────────────────────────────────

export async function getSiiEnvios(req, res) {
  try {
    const { empresa_id } = req.params;
    const { ejercicio, periodo, estado, tipo_libro, limit = 50, offset = 0 } = req.query;

    const result = await siiService.getHistorial(empresa_id, {
      ejercicio: ejercicio ? parseInt(ejercicio) : undefined,
      periodo,
      estado,
      tipo_libro,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error("Error getSiiEnvios:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

// ─── GET ENVIO DETALLE ──────────────────────────────────────

export async function getEnvioDetalle(req, res) {
  try {
    const { empresa_id, id } = req.params;
    const envio = await siiService.getEnvioDetalle(empresa_id, id);

    if (!envio) {
      return res.status(404).json({ error: "Envio no encontrado" });
    }

    res.json({ success: true, data: envio });
  } catch (err) {
    console.error("Error getEnvioDetalle:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

// ─── PREPARAR ENVIO ─────────────────────────────────────────

export async function prepararEnvio(req, res) {
  try {
    const { empresa_id } = req.params;
    const { tipo_libro = 'facturas_emitidas', ejercicio, mes } = req.body;

    const result = await siiService.prepararEnvio(
      empresa_id,
      tipo_libro,
      ejercicio ? parseInt(ejercicio) : undefined,
      mes,
    );

    res.json({ success: true, data: result });
  } catch (err) {
    console.error("Error prepararEnvio:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

// ─── SIMULAR ENVIO ──────────────────────────────────────────

export async function simularEnvio(req, res) {
  try {
    const { empresa_id } = req.params;
    const { envio_id } = req.body;

    if (!envio_id) {
      return res.status(400).json({ error: "envio_id requerido" });
    }

    const result = await siiService.simularEnvio(empresa_id, envio_id);

    res.json({ success: true, data: result });
  } catch (err) {
    console.error("Error simularEnvio:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

// ─── ESTADISTICAS SII ───────────────────────────────────────

export async function getEstadisticasSii(req, res) {
  try {
    const { empresa_id } = req.params;
    const stats = await siiService.getEstadisticasSii(empresa_id);

    res.json({ success: true, data: stats });
  } catch (err) {
    console.error("Error getEstadisticasSii:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}
