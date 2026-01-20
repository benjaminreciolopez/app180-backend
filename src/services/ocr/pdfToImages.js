import fs from "fs";
import os from "os";
import path from "path";
import { convert } from "pdf-poppler";

function tmpDir() {
  const dir = path.join(
    os.tmpdir(),
    `ocrpdf_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Convierte PDF a PNGs, devuelve lista de paths
 */
export async function pdfToImages(pdfPath) {
  const outDir = tmpDir();
  const opts = {
    format: "png",
    out_dir: outDir,
    out_prefix: "page",
    page: null, // todas
    dpi: 200,
  };

  await convert(pdfPath, opts);

  // pdf-poppler nombra page-1.png, page-2.png, etc
  const files = fs
    .readdirSync(outDir)
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .map((f) => path.join(outDir, f))
    .sort();

  return files;
}
