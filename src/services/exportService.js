import puppeteer from 'puppeteer';
import fs from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

// Con 'puppeteer' (full) no necesitamos buscar paths manualmente para Linux/Windows
// ya que descarga su propio Chrome/Chromium compatible.

// La función findChrome ya no es necesaria gracias a .puppeteerrc.cjs
// que asegura la instalación en una ruta conocida y persistente.

/**
 * Genera un PDF a partir de contenido HTML
 * @param {string} htmlContent
 * @param {object} options
 * @returns {Buffer} PDF Buffer
 */
export const generatePdf = async (htmlContent, options = {}) => {
    let browser = null;
    try {
        console.log("📂 Current PWD:", process.cwd());
        console.log("📂 Puppeteer Cache Directory (Configured):", join(process.cwd(), '.cache', 'puppeteer'));
        
        // Opciones optimizadas para Render / Docker
        const launchOptions = {
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--single-process', // A veces ayuda en entornos con recursos limitados
            ],
            headless: 'new'
        };

        // Intentar lanzar (usará la confi de .puppeteerrc.cjs automáticamente)
        try {
            console.log('🚀 Intentando lanzar Puppeteer (configuración estándar)...');
            browser = await puppeteer.launch(launchOptions);
        } catch (launchError) {
            console.warn("⚠️ Falló lanzamiento estándar, intentando detectar ejecutable...", launchError.message);
            // Fallback: intentar forzar path detectado si existe
            try {
                // Intentar buscar en la ruta exacta donde vimos que se instaló en los logs:
                // /opt/render/project/src/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome
                // Como la versión puede cambiar, intentaremos usar puppeteer.executablePath() primero, 
                // y si falla, construiremos una ruta "best guess" basada en la estructura de Render.
                
                let executablePath = puppeteer.executablePath();
                console.log("👉 Executable Path detectado por Puppeteer:", executablePath);

                if (!executablePath || !fs.existsSync(executablePath)) {
                     console.log("⚠️ Ruta detectada no existe, intentando búsqueda manual en .cache...");
                     // Buscar en .cache/puppeteer/chrome
                     const cacheBase = join(process.cwd(), '.cache', 'puppeteer', 'chrome');
                     if (fs.existsSync(cacheBase)) {
                        const chromeDirs = fs.readdirSync(cacheBase);
                        if (chromeDirs.length > 0) {
                            // Asumimos el primer directorio (ej: linux-144.0.7559.96)
                            const chromeDir = chromeDirs[0]; 
                            executablePath = join(cacheBase, chromeDir, 'chrome-linux64', 'chrome');
                            console.log("🔎 Ruta construida manualmente:", executablePath);
                        }
                     }
                }

                browser = await puppeteer.launch({
                    ...launchOptions,
                    executablePath
                });
            } catch (fallbackError) {
                console.error("❌ Falló también el fallback de executablePath:", fallbackError.message);
                throw launchError; // Lanzar el error original si todo falla
            }
        }

        const page = await browser.newPage();
        
        // Set content
        await page.setContent(htmlContent, {
            waitUntil: 'networkidle0',
            timeout: 60000 // Aumentar timeout a 60s
        });

        // Generate PDF
        const uint8Array = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '20px',
                right: '20px',
                bottom: '20px',
                left: '20px'
            },
            ...options
        });

        const pdfBuffer = Buffer.from(uint8Array);
        console.log(`✅ PDF generado con éxito. Tamaño: ${pdfBuffer.length} bytes`);

        return pdfBuffer;

    } catch (error) {
        console.error("❌ Error generando PDF:", error);
        throw error;
    } finally {
        if (browser) await browser.close();
    }
};

/**
 * Genera un CSV string a partir de datos JSON
 * @param {Array} data Array de objetos
 * @param {Array} columns Definición de columnas [{ key: 'prop', header: 'Titulo' }]
 * @returns {string} CSV content
 */
export const generateCsv = (data, columns) => {
    if (!data || !data.length) return '';

    // Encabezados
    const headerRow = columns.map(c => `"${c.header}"`).join(',');
    
    // Filas
    const rows = data.map(row => {
        return columns.map(c => {
            let val = row[c.key];
            // Manejar objetos anidados si key tiene puntos (ej employee.nombre)
            if (c.key.includes('.')) {
                val = c.key.split('.').reduce((obj, key) => (obj && obj[key] !== 'undefined') ? obj[key] : null, row);
            }
            
            if (val === null || val === undefined) val = '';
            // Escapar comillas dobles
            const stringVal = String(val).replace(/"/g, '""');
            return `"${stringVal}"`;
        }).join(',');
    });

    return [headerRow, ...rows].join('\n');
};
