import puppeteer from 'puppeteer';
import fs from 'fs';
import { execSync } from 'child_process';

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
                const executablePath = puppeteer.executablePath();
                console.log("👉 Executable Path detectado:", executablePath);
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
        const pdfBuffer = await page.pdf({
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
