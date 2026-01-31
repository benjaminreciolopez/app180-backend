import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Intento de encontrar Chrome en Windows
const findChromePath = () => {
    const paths = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe", // Fallback a Edge si es necesario
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
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
        const executablePath = findChromePath();
        if (!executablePath) {
            throw new Error("No se encontró instalación de Chrome/Edge para generar PDF.");
        }

        browser = await puppeteer.launch({
            executablePath,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
        });

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
