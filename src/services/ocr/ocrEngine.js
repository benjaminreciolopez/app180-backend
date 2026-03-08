import sharp from "sharp";
import { createWorker } from "tesseract.js";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

async function preprocessImageBuffer(buf) {
  return sharp(buf).grayscale().normalize().sharpen().threshold(180).toBuffer();
}

async function ocrImageBuffer(buf) {
  const worker = await createWorker("spa"); // español
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: "6",
    });

    const { data } = await worker.recognize(buf);
    return data?.text || "";
  } finally {
    await worker.terminate();
  }
}

/**
 * Convierte la primera página de un PDF a un Buffer de imagen (PNG)
 */
async function convertPdfToImage(pdfBuffer) {
  const data = new Uint8Array(pdfBuffer);
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2.0 });

  // Nota: En entornos de Node, pdfjs-dist requiere un canvas compatible
  // pero para extración simple de texto/imagen podemos usar el motor de texto de pdfjs
  // o intentar renderizar. Si no hay canvas, usamos el extractor de texto de pdfjs directamente.
  const textContent = await page.getTextContent();
  return textContent.items.map(item => item.str).join(" ");
}

/**
 * Reconstruye texto de una página preservando la estructura de líneas y columnas.
 * Usa las coordenadas X/Y de cada item para agrupar en líneas y mantener espaciado.
 */
function reconstructPageLayout(textContent) {
  const items = textContent.items.filter(item => item.str && item.str.trim().length > 0);
  if (items.length === 0) return "";

  // Cada item tiene item.transform = [scaleX, skewX, skewY, scaleY, x, y]
  // y = coordenada vertical (crece hacia arriba en PDF), x = horizontal
  const positioned = items.map(item => ({
    str: item.str,
    x: Math.round(item.transform[4]),
    y: Math.round(item.transform[5]),
    width: item.width || 0,
    height: Math.abs(item.transform[3]) || 10
  }));

  // Agrupar items en líneas: items con Y similar (±tolerancia basada en altura del texto)
  positioned.sort((a, b) => b.y - a.y || a.x - b.x); // top-to-bottom, left-to-right

  const lines = [];
  let currentLine = [positioned[0]];
  let currentY = positioned[0].y;

  for (let i = 1; i < positioned.length; i++) {
    const item = positioned[i];
    const tolerance = Math.max(item.height * 0.5, 3);

    if (Math.abs(item.y - currentY) <= tolerance) {
      currentLine.push(item);
    } else {
      lines.push(currentLine);
      currentLine = [item];
      currentY = item.y;
    }
  }
  lines.push(currentLine);

  // Construir texto preservando espaciado horizontal
  const result = lines.map(line => {
    line.sort((a, b) => a.x - b.x);
    let lineText = "";
    let lastEndX = 0;

    for (const item of line) {
      // Calcular espacio entre este item y el anterior
      const gap = item.x - lastEndX;
      if (lastEndX > 0 && gap > 8) {
        // Gran espacio → separador de columna (tab o múltiples espacios)
        const numSpaces = Math.min(Math.max(Math.round(gap / 6), 2), 10);
        lineText += " ".repeat(numSpaces);
      } else if (lastEndX > 0 && gap > 2) {
        lineText += " ";
      }
      lineText += item.str;
      lastEndX = item.x + (item.width || item.str.length * 6);
    }
    return lineText;
  });

  return result.join("\n");
}

/**
 * Extrae texto de TODAS las páginas de un PDF.
 * @param {Buffer} buffer - Buffer del PDF
 * @param {number} maxPages - Máximo de páginas a extraer (default 20)
 * @param {string|null} password - Contraseña si el PDF está protegido
 * @param {Object} options - Opciones adicionales
 * @param {boolean} options.preserveLayout - Si true, reconstruye layout con posiciones X/Y (ideal para formularios fiscales)
 */
export async function extractFullPdfText(buffer, maxPages = 20, password = null, options = {}) {
  const data = new Uint8Array(buffer);
  const opts = { data };
  if (password) opts.password = password;
  const loadingTask = pdfjs.getDocument(opts);
  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (err) {
    if (err?.name === "PasswordException") {
      const e = new Error("El PDF está protegido con contraseña. Introduce la contraseña para continuar.");
      e.code = "PDF_PASSWORD_REQUIRED";
      e.status = 400;
      throw e;
    }
    throw err;
  }
  let fullText = "";
  const numPages = Math.min(pdf.numPages, maxPages);
  const useLayout = options.preserveLayout === true;

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    if (useLayout) {
      fullText += `\n--- PÁGINA ${i} ---\n`;
      fullText += reconstructPageLayout(textContent) + "\n";
    } else {
      fullText += textContent.items.map(item => item.str).join(" ") + "\n";
    }
  }
  return fullText.trim();
}

/**
 * Extrae texto de imágenes o PDFs
 */
export async function ocrExtractTextFromUpload(file) {
  const mime = file.mimetype || "";
  const original = (file.originalname || "").toLowerCase();

  const isPdf = mime.includes("pdf") || original.endsWith(".pdf");

  if (isPdf) {
    // Para PDF, intentamos extraer el texto directamente (más preciso para facturas digitales como Amazon)
    try {
      const data = new Uint8Array(file.buffer);
      const loadingTask = pdfjs.getDocument({ data });
      const pdf = await loadingTask.promise;
      let fullText = "";

      // Extraemos texto de las primeras 2 páginas (suficiente para la mayoría de facturas)
      const numPages = Math.min(pdf.numPages, 2);
      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map(item => item.str).join(" ") + "\n";
      }

      if (fullText.trim().length > 10) {
        return fullText.trim();
      }
    } catch (err) {
      console.warn("Error extrayendo texto directo del PDF, reintentando con OCR de imagen:", err);
    }

    // Si falla la extracción directa (PDF escaneado), el backend necesitaría renderizar a imagen.
    // Por ahora, devolvemos error descriptivo o intentamos manejarlo.
    throw new Error("El PDF parece ser una imagen escaneada. Por favor, sube una foto o un PDF con texto seleccionable.");
  }

  // Aceptamos imagen/*
  if (!mime.startsWith("image/")) {
    const err = new Error("Formato no soportado. Sube una imagen (PNG/JPG) o un PDF.");
    err.status = 400;
    throw err;
  }

  const pre = await preprocessImageBuffer(file.buffer);
  const text = await ocrImageBuffer(pre);
  return text.trim();
}
