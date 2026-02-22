import { chatConAgente } from "../services/aiAgentService.js";
import { sql } from "../db.js";
import { processInvoiceFile } from "../services/ocr/qrExtractor.js";
import { ocrExtractTextFromUpload } from "../services/ocr/ocrEngine.js";

/**
 * Obtiene el ID de la empresa del usuario autenticado
 */
async function getEmpresaId(userId) {
  const r = await sql`select id from empresa_180 where user_id=${userId} limit 1`;
  if (!r[0]) {
    const e = new Error("Empresa no asociada");
    e.status = 403;
    throw e;
  }
  return r[0].id;
}

/**
 * POST /admin/ai/chat
 * Endpoint para chatear con el agente IA
 */
export async function chat(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { mensaje, historial } = req.body;

    if (!mensaje || typeof mensaje !== 'string') {
      return res.status(400).json({ error: "El mensaje es requerido" });
    }

    const empresaId = await getEmpresaId(userId);

    // Llamar al servicio de IA
    const respuesta = await chatConAgente({
      empresaId,
      userId,
      userRole,
      mensaje,
      historial: historial || []
    });

    res.json({
      mensaje: respuesta.mensaje,
      timestamp: new Date().toISOString(),
      accion_realizada: respuesta.accion_realizada || false
    });

  } catch (error) {
    console.error("[AI Controller] Error:", error);

    if (error.message?.includes("API key")) {
      return res.status(500).json({
        error: "Servicio de IA no configurado. Contacta al administrador."
      });
    }

    res.status(500).json({
      error: error.message || "Error al procesar tu mensaje"
    });
  }
}

/**
 * POST /admin/ai/chat-with-file
 * Chat con archivo adjunto (PDF/imagen) - extrae QR + texto para CONTENDO
 */
export async function chatWithFile(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const mensaje = req.body.mensaje || "Analiza este documento y extrae los datos fiscales del QR si lo tiene.";
    const historial = req.body.historial ? JSON.parse(req.body.historial) : [];
    const password = req.body.password || null;

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No se subió ningún archivo" });
    }

    const empresaId = await getEmpresaId(userId);

    // 1. Extraer QR del archivo
    let qrResult = null;
    try {
      qrResult = await processInvoiceFile(file.buffer, file.mimetype, password);
    } catch (err) {
      if (err.code === "PDF_PASSWORD_REQUIRED") {
        return res.status(400).json({ error: err.message, code: "PDF_PASSWORD_REQUIRED" });
      }
      console.warn("[AI+QR] Error extrayendo QR:", err.message);
    }

    // 2. Extraer texto OCR del archivo
    let ocrText = "";
    try {
      ocrText = await ocrExtractTextFromUpload(file);
    } catch (err) {
      console.warn("[AI+QR] Error OCR:", err.message);
      // Si falla OCR, usar el texto del QR extractor
      if (qrResult?.textContent) {
        ocrText = qrResult.textContent;
      }
    }

    // 3. Construir contexto enriquecido para CONTENDO
    let fileContext = `\n\n---\n📎 **Archivo adjunto**: ${file.originalname}\n`;

    if (qrResult?.qrData) {
      const qr = qrResult.qrData;
      fileContext += `\n🔍 **Datos extraídos del QR de la factura**:\n`;
      if (qr.tipo) fileContext += `- Tipo QR: ${qr.tipo}\n`;
      if (qr.nif_emisor) fileContext += `- NIF emisor: ${qr.nif_emisor}\n`;
      if (qr.serie) fileContext += `- Serie: ${qr.serie}\n`;
      if (qr.numero_factura) fileContext += `- Número factura: ${qr.numero_factura}\n`;
      if (qr.fecha) fileContext += `- Fecha: ${qr.fecha}\n`;
      if (qr.importe_total) fileContext += `- Importe total: ${qr.importe_total}€\n`;
      if (qr.url) fileContext += `- URL: ${qr.url}\n`;
    } else if (qrResult?.qrRaw?.length > 0) {
      fileContext += `\n🔍 **QR detectado (sin formato conocido)**: ${qrResult.qrRaw[0]}\n`;
    } else {
      fileContext += `\n⚠️ No se detectó código QR en el documento.\n`;
    }

    if (ocrText && ocrText.length > 10) {
      // Limitar texto OCR para no exceder tokens
      const truncated = ocrText.length > 3000 ? ocrText.substring(0, 3000) + "..." : ocrText;
      fileContext += `\n📄 **Texto extraído del documento**:\n\`\`\`\n${truncated}\n\`\`\`\n`;
    }

    // 4. Enviar al agente con contexto enriquecido
    const mensajeEnriquecido = mensaje + fileContext;

    const respuesta = await chatConAgente({
      empresaId,
      userId,
      userRole,
      mensaje: mensajeEnriquecido,
      historial
    });

    res.json({
      mensaje: respuesta.mensaje,
      timestamp: new Date().toISOString(),
      accion_realizada: respuesta.accion_realizada || false,
      qr_detectado: !!qrResult?.qrData,
      qr_data: qrResult?.qrData || null
    });

  } catch (error) {
    console.error("[AI+File] Error:", error);
    res.status(500).json({
      error: error.message || "Error al procesar el archivo"
    });
  }
}

/**
 * GET /admin/ai/status
 * Verifica si el servicio de IA está disponible
 */
export async function status(req, res) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    res.json({
      disponible: !!apiKey && apiKey.length > 10,
      modelo: "claude-haiku-4-5-20251001",
      proveedor: "Anthropic"
    });
  } catch (error) {
    console.error("[AI Controller] Error en status:", error);
    res.status(500).json({ error: error.message });
  }
}
