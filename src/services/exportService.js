import puppeteer from 'puppeteer';
import fs from 'fs';
import { execSync } from 'child_process';

// Con 'puppeteer' (full) no necesitamos buscar paths manualmente para Linux/Windows
// ya que descarga su propio Chrome/Chromium compatible.

/**
 * Encuentra el ejecutable de Chrome en el sistema
 */
const findChrome = () => {
    console.log('🔍 Buscando Chrome...');

    // 1. Variables de entorno configuradas manualmente
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        console.log('✅ Chrome encontrado vía PUPPETEER_EXECUTABLE_PATH:', process.env.PUPPETEER_EXECUTABLE_PATH);
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    if (process.env.CHROME_BIN) {
        console.log('✅ Chrome encontrado vía CHROME_BIN:', process.env.CHROME_BIN);
        return process.env.CHROME_BIN;
    }

    // 2. Buscar en caché de Puppeteer en Render
    const renderCachePaths = [
        '/opt/render/.cache/puppeteer/chrome',
        `${process.env.HOME}/.cache/puppeteer/chrome`
    ];

    for (const cacheDir of renderCachePaths) {
        try {
            if (fs.existsSync(cacheDir)) {
                // Buscar chrome ejecutable dentro del directorio de caché
                const result = execSync(
                    `find "${cacheDir}" -name chrome -type f -executable 2>/dev/null | grep "chrome-linux64/chrome" | head -n 1`,
                    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
                ).trim();

                if (result && fs.existsSync(result)) {
                    console.log('✅ Chrome encontrado en caché Puppeteer:', result);
                    return result;
                }
            }
        } catch (e) {
            console.log('⚠️  Error buscando en', cacheDir, ':', e.message);
        }
    }

    // 3. Buscar Chrome del sistema
    const systemPaths = [
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium'
    ];

    for (const systemPath of systemPaths) {
        if (fs.existsSync(systemPath)) {
            console.log('✅ Chrome del sistema encontrado:', systemPath);
            return systemPath;
        }
    }

    // 4. Dejar que Puppeteer use su propio Chrome bundled
    console.log('⚠️  No se encontró Chrome manualmente, usando Chrome bundled de Puppeteer');
    return undefined;
};

/**
 * Genera un PDF a partir de contenido HTML
 * @param {string} htmlContent
 * @param {object} options
 * @returns {Buffer} PDF Buffer
 */
export const generatePdf = async (htmlContent, options = {}) => {
    let browser = null;
    try {
        const chromePath = findChrome();

        const launchOptions = {
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-features=IsolateOrigins,site-per-process'
            ],
            headless: 'new',
            executablePath: chromePath
        };

        console.log('🚀 Intentando lanzar Chrome con opciones:', JSON.stringify({
            ...launchOptions,
            executablePath: launchOptions.executablePath || 'bundled'
        }, null, 2));

        browser = await puppeteer.launch(launchOptions);

        const page = await browser.newPage();
        
        // Set content
        await page.setContent(htmlContent, {
            waitUntil: 'networkidle0'
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
        console.error("Error generando PDF:", error);
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
