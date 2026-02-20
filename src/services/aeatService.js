
import fs from 'fs';
import path from 'path';
import https from 'https';
import { sql } from "../db.js";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
        // TODO: Implementar la lógica real de generación del formato BOE
        // Esto es extremadamente complejo y específico (posiciones fijas, códigos, etc.)
        // Por ahora retornamos un mock para pruebas de integración

        const { year, trimestre, modelo303, nif, nombre } = datos;

        // Estructura SIMPLIFICADA de ejemplo (NO VÁLIDA PARA PRESENTACIÓN REAL AÚN)
        // Registro de Cabecera (Tipo 1)
        let boe = "";
        boe += `1303${year}${trimestre}${nif.padEnd(9)}${nombre.padEnd(40)}\n`;

        // Registro de Liquidación
        // Casilla 01 (Base Devengado): modelo303.devengado.base
        // Casilla 03 (Cuota Devengado): modelo303.devengado.cuota
        // ...

        return boe;
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
