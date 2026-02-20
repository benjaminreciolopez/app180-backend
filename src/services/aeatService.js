
import fs from 'fs';
import path from 'path';
import https from 'https';
import { sql } from "../db.js";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Utilidades para formato BOE (Ancho fijo)
 */
const BOE_UTILS = {
    padText(text, length) {
        if (!text) return ' '.repeat(length);
        // Quitar caracteres especiales, mayúsculas y truncar/rellenar
        const clean = text.toString()
            .toUpperCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Quitar acentos
            .replace(/[^A-Z0-9 ]/g, " ")
            .substring(0, length);
        return clean.padEnd(length, ' ');
    },

    padNumber(num, length, decimals = 2) {
        if (num === undefined || num === null) num = 0;
        // El formato BOE suele ser: importe * 100, rellenado con ceros a la izquierda
        // Ejemplo: 123.45 con length 10 -> '0000012345'
        const value = Math.round(num * Math.pow(10, decimals));
        const sign = value < 0 ? '-' : '';
        const absValue = Math.abs(value).toString();

        if (sign === '-') {
            return '-' + absValue.padStart(length - 1, '0');
        }
        return absValue.padStart(length, '0');
    },

    padInt(num, length) {
        if (num === undefined || num === null) num = 0;
        return num.toString().padStart(length, '0');
    }
};

/**
 * Servicio para interactuar con la AEAT
 */
export const aeatService = {

    /**
     * Obtener certificado digital de la empresa
     * @param {string} empresaId 
     */
    async getCertificado(empresaId) {
        const [emisor] = await sql`
            SELECT certificado_path, certificado_password 
            FROM emisor_180 
            WHERE empresa_id = ${empresaId}
        `;

        if (!emisor || !emisor.certificado_path) {
            throw new Error("No hay certificado digital configurado para esta empresa.");
        }

        // Construir ruta absoluta al certificado
        // Asumimos que certificado_path es relativo a la raíz del proyecto o una carpeta específica
        // Ajustar según donde se guarden los archivos subidos
        const certPath = path.resolve(__dirname, '../../', emisor.certificado_path);

        if (!fs.existsSync(certPath)) {
            throw new Error(`El archivo del certificado no existe en la ruta: ${certPath}`);
        }

        const pfx = fs.readFileSync(certPath);

        return {
            pfx,
            passphrase: emisor.certificado_password
        };
    },

    /**
     * Generar fichero BOE para Modelo 303
     * @param {object} datos Datos calculados del modelo
     * @returns {string} Contenido en formato BOE
     */
    generarBOE303(datos) {
        const { year, trimestre, nif, nombre, modelo303 } = datos;
        const u = BOE_UTILS;

        // REGISTRO TIPO 1 (Cabecera - 390 caracteres aprox)
        let r1 = "";
        r1 += "1"; // Tipo registro
        r1 += "303"; // Modelo
        r1 += year; // Ejercicio
        r1 += trimestre === '4' ? '4T' : `${trimestre}T`.padStart(2, '0'); // Periodo (01, 02, 03, 4T o similar según diseño)
        r1 += u.padText(nif, 9);
        r1 += u.padText(nombre, 40);
        r1 = r1.padEnd(390, ' ');

        // REGISTRO TIPO 2 (Liquidación)
        let r2 = "";
        r2 += "2";
        r2 += "303";
        r2 += u.padNumber(modelo303.devengado.base, 15); // Casilla 01 (ejemplo de posición)
        r2 += u.padNumber(modelo303.devengado.cuota, 15); // Casilla 03
        r2 += u.padNumber(modelo303.deducible.base, 15); // Casilla 28
        r2 += u.padNumber(modelo303.deducible.cuota, 15); // Casilla 29
        r2 += u.padNumber(modelo303.resultado, 15); // Casilla 71
        r2 = r2.padEnd(390, ' ');

        return r1 + "\n" + r2;
    },

    /**
     * Generar fichero BOE para Modelo 130
     */
    generarBOE130(datos) {
        const { year, trimestre, nif, nombre, modelo130 } = datos;
        const u = BOE_UTILS;

        let r1 = "1130" + year + trimestre.padStart(2, '0') + u.padText(nif, 9) + u.padText(nombre, 40);
        r1 = r1.padEnd(390, ' ');

        let r2 = "2130";
        r2 += u.padNumber(modelo130.ingresos, 15);
        r2 += u.padNumber(modelo130.gastos, 15);
        r2 += u.padNumber(modelo130.rendimiento, 15);
        r2 += u.padNumber(modelo130.a_ingresar, 15);
        r2 = r2.padEnd(390, ' ');

        return r1 + "\n" + r2;
    },

    /**
     * Generar fichero BOE para Modelo 111
     */
    generarBOE111(datos) {
        const { year, trimestre, nif, nombre, modelo111 } = datos;
        const u = BOE_UTILS;

        let r1 = "1111" + year + trimestre.padStart(2, '0') + u.padText(nif, 9) + u.padText(nombre, 40);
        r1 = r1.padEnd(390, ' ');

        let r2 = "2111";
        // Trabajo
        r2 += u.padInt(modelo111.trabajo.perceptores, 8);
        r2 += u.padNumber(modelo111.trabajo.rendimientos, 15);
        r2 += u.padNumber(modelo111.trabajo.retenciones, 15);
        // Actividades
        r2 += u.padInt(modelo111.actividades.perceptores, 8);
        r2 += u.padNumber(modelo111.actividades.rendimientos, 15);
        r2 += u.padNumber(modelo111.actividades.retenciones, 15);

        r2 = r2.padEnd(390, ' ');

        return r1 + "\n" + r2;
    },

    /**
     * Enviar presentación a la AEAT
     * @param {string} empresaId 
     * @param {string} contenidoBOE 
     * @param {string} modelo '303', '130'
     */
    async presentarModelo(empresaId, contenidoBOE, modelo) {
        // 1. Obtener certificado
        const cert = await this.getCertificado(empresaId);

        // 2. Configuración de la petición HTTPS con certificado cliente
        const options = {
            hostname: 'www1.agenciatributaria.gob.es', // Entorno REAL (usar preproducción para pruebas)
            // hostname: 'www7.aeat.es', // Entorno PRUEBAS (aprox)
            port: 443,
            path: `/wlpl/POI-CONTRO/ws/Presentacion${modelo}`, // URL ficticia, buscar la real en documentación AEAT
            method: 'POST',
            pfx: cert.pfx,
            passphrase: cert.passphrase,
            headers: {
                'Content-Type': 'text/plain',
                'Content-Length': Buffer.byteLength(contenidoBOE)
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            // La AEAT suele devolver XML o HTML, hay que parsear
                            // Aquí asumimos éxito para el esqueleto
                            resolve({ success: true, raw_response: data });
                        } catch (e) {
                            reject(new Error("Error parseando respuesta AEAT"));
                        }
                    } else {
                        reject(new Error(`Error AEAT: ${res.statusCode} - ${data}`));
                    }
                });
            });

            req.on('error', (e) => {
                reject(new Error(`Error de conexión AEAT: ${e.message}`));
            });

            req.write(contenidoBOE);
            req.end();
        });
    }
};
