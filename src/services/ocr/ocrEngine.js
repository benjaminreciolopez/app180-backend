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
 * Extrae texto de imágenes o PDFs
 */
/**
 * Extrae texto de TODAS las páginas de un PDF (para extractos bancarios)
 */
export async function extractFullPdfText(buffer, maxPages = 20, password = null) {
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
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    fullText += textContent.items.map(item => item.str).join(" ") + "\n";
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
