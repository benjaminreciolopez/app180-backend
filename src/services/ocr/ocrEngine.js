import sharp from "sharp";
import { createWorker } from "tesseract.js";

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
 * SOLO IMÁGENES. Si llega PDF, error 400.
 */
export async function ocrExtractTextFromUpload(file) {
  const mime = file.mimetype || "";
  const original = (file.originalname || "").toLowerCase();

  const isPdf = mime.includes("pdf") || original.endsWith(".pdf");
  if (isPdf) {
    const err = new Error(
      "PDF no soportado en backend. Convierte el PDF a imágenes en frontend y vuelve a subirlas.",
    );
    err.status = 400;
    throw err;
  }

  // Aceptamos imagen/*
  if (!mime.startsWith("image/")) {
    const err = new Error("Formato no soportado. Sube una imagen (PNG/JPG).");
    err.status = 400;
    throw err;
  }

  const pre = await preprocessImageBuffer(file.buffer);
  const text = await ocrImageBuffer(pre);
  return text.trim();
}
