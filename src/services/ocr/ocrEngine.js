import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { pdfToImages } from "./pdfToImages.js";

function tmpFilePath(ext) {
  const name = `ocr_${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;
  return path.join(os.tmpdir(), name);
}

async function preprocessImageBuffer(buf) {
  // Preprocesado agresivo para documentos escaneados:
  // - grayscale
  // - normalize
  // - threshold
  // - sharpen
  return sharp(buf).grayscale().normalize().sharpen().threshold(180).toBuffer();
}

async function ocrImageBuffer(buf) {
  const worker = await createWorker("spa"); // español
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: "6", // bloque uniforme de texto
    });

    const { data } = await worker.recognize(buf);
    return data?.text || "";
  } finally {
    await worker.terminate();
  }
}

/**
 * Recibe req.file de multer (memoryStorage)
 */
export async function ocrExtractTextFromUpload(file) {
  const mime = file.mimetype || "";
  const original = file.originalname?.toLowerCase() || "";

  // PDF -> imágenes -> OCR por página
  if (mime.includes("pdf") || original.endsWith(".pdf")) {
    const pdfPath = tmpFilePath("pdf");
    fs.writeFileSync(pdfPath, file.buffer);

    const images = await pdfToImages(pdfPath);
    let fullText = "";

    for (const imgPath of images) {
      const raw = fs.readFileSync(imgPath);
      const pre = await preprocessImageBuffer(raw);
      const t = await ocrImageBuffer(pre);
      fullText += "\n" + t;

      // cleanup
      try {
        fs.unlinkSync(imgPath);
      } catch {}
    }

    try {
      fs.unlinkSync(pdfPath);
    } catch {}

    return fullText.trim();
  }

  // Imagen directa
  const pre = await preprocessImageBuffer(file.buffer);
  const text = await ocrImageBuffer(pre);
  return text.trim();
}
