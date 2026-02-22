import sharp from "sharp";
import jsQR from "jsqr";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Extrae códigos QR de un buffer de imagen (PNG/JPG)
 * @returns {Promise<string[]>} Array de strings decodificados de QR
 */
export async function extractQRFromImage(imageBuffer) {
  // Convertir a raw RGBA con sharp
  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  if (code) {
    return [code.data];
  }

  // Si no se encuentra con la imagen original, intentar con mayor resolución y contraste
  const enhanced = await sharp(imageBuffer)
    .resize({ width: Math.max(info.width, 2000), withoutEnlargement: false })
    .grayscale()
    .normalize()
    .sharpen()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const code2 = jsQR(new Uint8ClampedArray(enhanced.data), enhanced.info.width, enhanced.info.height);
  if (code2) {
    return [code2.data];
  }

  return [];
}

/**
 * Extrae códigos QR de todas las páginas de un PDF
 * Renderiza cada página como imagen y busca QR codes
 * @returns {Promise<{qrCodes: string[], textContent: string}>}
 */
export async function extractQRFromPDF(pdfBuffer, password = null) {
  const data = new Uint8Array(pdfBuffer);
  const opts = { data };
  if (password) opts.password = password;

  const loadingTask = pdfjs.getDocument(opts);
  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (err) {
    if (err?.name === "PasswordException") {
      const e = new Error("El PDF está protegido con contraseña.");
      e.code = "PDF_PASSWORD_REQUIRED";
      e.status = 400;
      throw e;
    }
    throw err;
  }

  const qrCodes = [];
  let fullText = "";

  // Solo procesamos las primeras 3 páginas (el QR suele estar en la primera)
  const numPages = Math.min(pdf.numPages, 3);

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);

    // Extraer texto de la página
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(" ");
    fullText += pageText + "\n";

    // Si hay URLs en el texto que parecen QR data de VeriFactu/TicketBAI
    const verifactuUrls = pageText.match(/https?:\/\/[^\s]*(?:verifactu|tbai|facturae|tax)[^\s]*/gi);
    if (verifactuUrls) {
      qrCodes.push(...verifactuUrls);
    }
  }

  return { qrCodes, textContent: fullText.trim() };
}

/**
 * Parsea datos de un QR de factura española (VeriFactu / TicketBAI / Facturae)
 *
 * Formatos comunes:
 * - VeriFactu: URL con params ?nif=...&numserie=...&fecha=...&importe=...
 * - TicketBAI: tbai-<nif>-<fecha>-<serie>-<signatura>
 * - URL genérica con datos fiscales en query string
 */
export function parseInvoiceQR(qrData) {
  if (!qrData || typeof qrData !== "string") return null;

  const result = {
    raw: qrData,
    tipo: null,
    nif_emisor: null,
    nombre_emisor: null,
    serie: null,
    numero_factura: null,
    fecha: null,
    importe_total: null,
    url: null,
  };

  // Intento 1: URL con query params (formato VeriFactu / Facturae)
  try {
    if (qrData.startsWith("http")) {
      result.url = qrData;
      const url = new URL(qrData);
      const params = url.searchParams;

      // VeriFactu / Facturae común
      result.nif_emisor = params.get("nif") || params.get("NIF") || params.get("nif_emisor") || null;
      result.numero_factura = params.get("numserie") || params.get("num") || params.get("numero") || params.get("NumSerie") || null;
      result.fecha = params.get("fecha") || params.get("FechaExpedicion") || params.get("date") || null;
      result.importe_total = params.get("importe") || params.get("total") || params.get("ImporteTotal") || null;

      if (result.nif_emisor) {
        result.tipo = "verifactu";
      }

      // Extraer serie del número de factura si tiene formato SERIE-NNNN
      if (result.numero_factura) {
        const match = result.numero_factura.match(/^([A-Z]+)-?\d{4}-?(\d+)/i);
        if (match) {
          result.serie = match[1];
        }
      }
    }
  } catch { /* no es URL válida */ }

  // Intento 2: Formato TicketBAI (tbai-NIF-FECHA-SERIE-SIGNATURA)
  const tbaiMatch = qrData.match(/tbai-([A-Z0-9]+)-(\d{6,8})-([^\s-]+)/i);
  if (tbaiMatch) {
    result.tipo = "ticketbai";
    result.nif_emisor = tbaiMatch[1];
    result.fecha = tbaiMatch[2];
    result.serie = tbaiMatch[3];
  }

  // Intento 3: Datos separados por pipe o semicolons (formato genérico)
  if (!result.tipo) {
    const parts = qrData.split(/[|;]/);
    if (parts.length >= 3) {
      result.tipo = "generico";
      // Intentar identificar NIF (patrón español)
      for (const part of parts) {
        const trimmed = part.trim();
        if (/^[A-Z]\d{7}[A-Z0-9]$/i.test(trimmed) || /^\d{8}[A-Z]$/i.test(trimmed)) {
          result.nif_emisor = trimmed;
        }
        if (/^\d+[.,]\d{2}$/.test(trimmed)) {
          result.importe_total = trimmed.replace(",", ".");
        }
        if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(trimmed)) {
          result.fecha = trimmed;
        }
      }
    }
  }

  // Convertir importe a número
  if (result.importe_total && typeof result.importe_total === "string") {
    result.importe_total = parseFloat(result.importe_total.replace(",", "."));
  }

  return result.tipo ? result : null;
}

/**
 * Procesa un archivo (imagen o PDF) y extrae datos de QR de factura + texto OCR
 * @returns {Promise<{qrData: object|null, textContent: string, qrRaw: string[]}>}
 */
export async function processInvoiceFile(fileBuffer, mimetype, password = null) {
  const isPdf = mimetype?.includes("pdf");
  let qrCodes = [];
  let textContent = "";

  if (isPdf) {
    const result = await extractQRFromPDF(fileBuffer, password);
    qrCodes = result.qrCodes;
    textContent = result.textContent;
  } else {
    // Imagen
    qrCodes = await extractQRFromImage(fileBuffer);

    // Intentar extraer texto con OCR básico (el texto se procesará con IA después)
    textContent = "[imagen subida - texto se procesará con IA]";
  }

  // Parsear el primer QR que contenga datos de factura
  let qrData = null;
  for (const qr of qrCodes) {
    const parsed = parseInvoiceQR(qr);
    if (parsed) {
      qrData = parsed;
      break;
    }
  }

  return { qrData, textContent, qrRaw: qrCodes };
}
