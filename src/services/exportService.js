import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Con 'puppeteer' (full) no necesitamos buscar paths manualmente para Linux/Windows 
// ya que descarga su propio Chrome/Chromium compatible.

/**
 * Genera un PDF a partir de contenido HTML
 * @param {string} htmlContent 
 * @param {object} options 
 * @returns {Buffer} PDF Buffer
 */
export const generatePdf = async (htmlContent, options = {}) => {
    let browser = null;
    try {
        const launchOptions = {
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            headless: 'new'
        };

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
