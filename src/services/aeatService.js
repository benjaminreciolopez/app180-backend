
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
     * Generar fichero BOE para Modelo 303 (Especificación 2026)
     * @param {object} datos Datos calculados del modelo
     * @returns {string} Contenido en formato BOE
     */
    generarBOE303(datos) {
        const { year, trimestre, nif, nombre, modelo303 } = datos;
        const u = BOE_UTILS;
        const periodo = trimestre === '4' ? '4T' : `${trimestre}T`;

        // REGISTRO TIPO 1 (Cabecera - Hoja DP30300)
        let r1 = "<T"; // Pos 1 (Lon 2)
        r1 += "303";   // Pos 3 (Lon 3)
        r1 += "0";     // Pos 6 (Lon 1) - Discriminante
        r1 += year;    // Pos 7 (Lon 4)
        r1 += periodo.padStart(2, '0'); // Pos 11 (Lon 2)
        r1 += "0000>"; // Pos 13 (Lon 5)
        r1 += "<AUX>"; // Pos 18 (Lon 5)
        r1 = r1.padEnd(322, ' '); // Relleno hasta constante final AUX
        r1 += "</AUX>"; // Pos 323 (Lon 6)
        r1 = r1.padEnd(390, ' '); // Longitud estándar para cabecera

        // REGISTRO TIPO 2 (Liquidación Página 1 - Hoja DP30301)
        let r2 = "<T";    // Pos 1 (Lon 2)
        r2 += "303";      // Pos 3 (Lon 3)
        r2 += "01000";    // Pos 6 (Lon 5) - Página 1
        r2 += ">";        // Pos 11 (Lon 1)
        r2 += " ";        // Pos 12 (Lon 1) - Indicador complementaria
        r2 += "I";        // Pos 13 (Lon 1) - Tipo declaración (I=Ingreso por defecto)
        r2 += u.padText(nif, 9);   // Pos 14 (Lon 9)
        r2 += u.padText(nombre, 80); // Pos 23 (Lon 80)
        r2 += year;       // Pos 103 (Lon 4)
        r2 += periodo.padStart(2, '0'); // Pos 107 (Lon 2)
        r2 += "2232222DDMMYYYY "; // Pos 109-126 (Valores por defecto/fijos según Nota 5)

        // Bloque de Casillas de Liquidación (Pos 131 en adelante)
        // [01][02][03] - 4% (Buscamos Pos 209 para casilla 01 en spec)
        // Nota: La spec indica Pos 131 para casilla 150. Vamos a mapear las que tenemos:

        let r2_liq = "".padEnd(2000, ' '); // Buffer para posicionar por índice absoluto

        const setCasilla = (pos, valor, conSigno = false) => {
            const formatted = conSigno ? u.padNumber(valor, 17) : u.padNumber(valor, 17);
            // Si tiene signo N, padNumber pone el signo. La spec dice 'N' para con signo.
            r2_liq = r2_liq.substring(0, pos - 1) + formatted + r2_liq.substring(pos + 16);
        };

        // IVA DEVENGADO
        setCasilla(209, modelo303.devengado.base); // [01]
        setCasilla(231, modelo303.devengado.cuota); // [03]
        setCasilla(326, 0); // [07] 21% Base (Estructura 2026 usa otras posiciones)
        setCasilla(348, 0); // [09] 21% Cuota
        setCasilla(696, modelo303.devengado.cuota); // [27] Total cuota devengada

        // IVA DEDUCIBLE
        setCasilla(713, modelo303.deducible.base); // [28]
        setCasilla(730, modelo303.deducible.cuota); // [29]
        setCasilla(1002, modelo303.deducible.cuota); // [45] Total a deducir

        setCasilla(1019, modelo303.resultado); // [46] Resultado régimen general

        // Construimos el string final de la página 1 recortando/rellenando
        r2 = r2 + r2_liq.substring(130, 1569);
        r2 += "</T30301000>"; // Indicador fin de registro

        return r1 + "\n" + r2;
    },

    /**
     * Generar fichero BOE para Modelo 130 (Estimación Directa)
     */
    generarBOE130(datos) {
        const { year, trimestre, nif, nombre, modelo130 } = datos;
        const u = BOE_UTILS;
        const periodo = `${trimestre}T`;

        // REGISTRO TIPO 1 (Cabecera - Hoja DR 13000)
        let r1 = "<T"; // Pos 1 (Lon 2)
        r1 += "130";   // Pos 3 (Lon 3)
        r1 += "0";     // Pos 6 (Lon 1)
        r1 += year;    // Pos 7 (Lon 4)
        r1 += periodo.padStart(2, '0'); // Pos 11 (Lon 2)
        r1 += "0000>"; // Pos 13 (Lon 5)
        r1 += "<AUX>"; // Pos 18 (Lon 5)
        r1 = r1.padEnd(322, ' ');
        r1 += "</AUX>"; // Pos 323 (Lon 6)
        r1 = r1.padEnd(390, ' '); // Relleno cabecera

        // REGISTRO TIPO 2 (Liquidación - Hoja DR 13001)
        let r2 = "<T";    // Pos 1 (Lon 2)
        r2 += "130";      // Pos 3 (Lon 3)
        r2 += "01";       // Pos 6 (Lon 2) - Página 1
        r2 += "000>";     // Pos 8 (Lon 4) - Fin identificador
        r2 += " ";        // Pos 12 (Lon 1) - Complementaria
        r2 += "I";        // Pos 13 (Lon 1) - Tipo declaración
        r2 += u.padText(nif, 9);   // Pos 14 (Lon 9)
        r2 += u.padText(nombre.split(' ')[0], 60); // Apellidos (Aprox)
        r2 += u.padText(nombre.split(' ').slice(1).join(' '), 20); // Nombre
        r2 += year;       // Pos 103 (Lon 4)
        r2 += periodo.padStart(2, '0'); // Pos 107 (Lon 2)

        let r2_liq = "".padEnd(600, ' ');
        const setCasilla = (pos, valor) => {
            const formatted = u.padNumber(valor, 17);
            r2_liq = r2_liq.substring(0, pos - 1) + formatted + r2_liq.substring(pos + 16);
        };

        setCasilla(109, modelo130.ingresos);    // [01]
        setCasilla(126, modelo130.gastos);      // [02]
        setCasilla(143, modelo130.rendimiento); // [03] (Con signo N)
        setCasilla(160, Math.max(0, modelo130.rendimiento * 0.20)); // [04]
        setCasilla(415, modelo130.a_ingresar);  // [19] Resultado (Con signo N)

        r2 += r2_liq.substring(108, 588);
        r2 += "</T13001000>"; // Fin registro tipo 2

        return r1 + "\n" + r2;
    },

    /**
     * Generar fichero BOE para Modelo 111 (Retenciones IRPF)
     */
    generarBOE111(datos) {
        const { year, trimestre, nif, nombre, modelo111 } = datos;
        const u = BOE_UTILS;
        const periodo = trimestre.padStart(2, '0');

        // REGISTRO TIPO 1 (Cabecera - Hoja M11100)
        let r1 = "<T"; // Pos 1 (Lon 2)
        r1 += "111";   // Pos 3 (Lon 3)
        r1 += "0";     // Pos 6 (Lon 1)
        r1 += year;    // Pos 7 (Lon 4)
        r1 += periodo; // Pos 11 (Lon 2)
        r1 += "0000>"; // Pos 13 (Lon 5)
        r1 += "<AUX>"; // Pos 18 (Lon 5)
        r1 = r1.padEnd(322, ' ');
        r1 += "</AUX>"; // Pos 323 (Lon 6)
        r1 = r1.padEnd(1000, ' '); // Relleno cabecera (Spec 111 es de 1000)

        // REGISTRO TIPO 2 (Liquidación - Hoja dr M11101)
        let r2 = "<T";    // Pos 1 (Lon 2)
        r2 += "111";      // Pos 3 (Lon 3)
        r2 += "01";       // Pos 6 (Lon 2) - Página 1
        r2 += "000>";     // Pos 8 (Lon 4)
        r2 += " ";        // Pos 12 (Lon 1) - Complementaria
        r2 += "I";        // Pos 13 (Lon 1) - Tipo declaración
        r2 += u.padText(nif, 9);   // Pos 14 (Lon 9)
        r2 += u.padText(nombre.split(' ')[0], 60); // Apellidos
        r2 += u.padText(nombre.split(' ').slice(1).join(' '), 20); // Nombre
        r2 += year;       // Pos 103 (Lon 4)
        r2 += periodo;    // Pos 107 (Lon 2)

        let r2_liq = "".padEnd(1000, ' ');
        const setNum = (pos, valor, lon) => {
            const formatted = u.padInt(valor, lon);
            r2_liq = r2_liq.substring(0, pos - 1) + formatted + r2_liq.substring(pos + lon - 1);
        };
        const setImporte = (pos, valor) => {
            const formatted = u.padNumber(valor, 17);
            r2_liq = r2_liq.substring(0, pos - 1) + formatted + r2_liq.substring(pos + 16);
        };

        // Rendimientos del trabajo (Nóminas)
        setNum(109, modelo111.trabajo.perceptores, 8);
        setImporte(117, modelo111.trabajo.rendimientos);
        setImporte(134, modelo111.trabajo.retenciones);

        // Rendimientos Actividades Económicas (Profesionales)
        setNum(193, modelo111.actividades.perceptores, 8);
        setImporte(201, modelo111.actividades.rendimientos);
        setImporte(218, modelo111.actividades.retenciones);

        // Totales (Casilla 41 - Resultado a ingresar)
        setImporte(521, modelo111.total_retenciones);

        r2 += r2_liq.substring(108, 988);
        r2 += "</T11101000>"; // Fin registro tipo 2

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
