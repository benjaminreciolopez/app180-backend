
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

        // IVA DEVENGADO - Desglosado por tipos
        const porTipo = modelo303.devengado.por_tipo || {};
        const al4  = porTipo.al_4  || { base: 0, cuota: 0 };
        const al10 = porTipo.al_10 || { base: 0, cuota: 0 };
        const al21 = porTipo.al_21 || { base: 0, cuota: 0 };

        // Régimen general: casillas [01]-[09] (4%, 10%, 21%)
        setCasilla(209, al4.base);   // [01] Base imponible 4%
        setCasilla(226, 4);          // [02] Tipo %
        setCasilla(231, al4.cuota);  // [03] Cuota 4%
        setCasilla(248, al10.base);  // [04] Base imponible 10%
        setCasilla(265, 10);         // [05] Tipo %
        setCasilla(270, al10.cuota); // [06] Cuota 10%
        setCasilla(287, al21.base);  // [07] Base imponible 21%
        setCasilla(304, 21);         // [08] Tipo %
        setCasilla(309, al21.cuota); // [09] Cuota 21%

        setCasilla(696, modelo303.devengado.cuota); // [27] Total cuota devengada

        // IVA DEDUCIBLE - Desglosado por tipos
        const porTipoDed = modelo303.deducible.por_tipo || {};
        const ded4  = porTipoDed.al_4  || { base: 0, cuota: 0 };
        const ded10 = porTipoDed.al_10 || { base: 0, cuota: 0 };
        const ded21 = porTipoDed.al_21 || { base: 0, cuota: 0 };

        setCasilla(713, ded4.base + ded10.base + ded21.base);   // [28] Base total op. interiores
        setCasilla(730, ded4.cuota + ded10.cuota + ded21.cuota); // [29] Cuota total deducible
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
     * Generar fichero BOE para Modelo 115 (Retenciones por arrendamientos)
     */
    generarBOE115(datos) {
        const { year, trimestre, nif, nombre, modelo115 } = datos;
        const u = BOE_UTILS;
        const periodo = trimestre.padStart(2, '0');

        // REGISTRO TIPO 1 (Cabecera)
        let r1 = "<T";
        r1 += "115";
        r1 += "0";
        r1 += year;
        r1 += periodo;
        r1 += "0000>";
        r1 += "<AUX>";
        r1 = r1.padEnd(322, ' ');
        r1 += "</AUX>";
        r1 = r1.padEnd(500, ' ');

        // REGISTRO TIPO 2 (Liquidación)
        let r2 = "<T";
        r2 += "115";
        r2 += "01";
        r2 += "000>";
        r2 += " ";    // Complementaria
        r2 += "I";    // Tipo declaración
        r2 += u.padText(nif, 9);
        r2 += u.padText(nombre.split(' ')[0], 60);
        r2 += u.padText(nombre.split(' ').slice(1).join(' '), 20);
        r2 += year;
        r2 += periodo;

        let r2_liq = "".padEnd(600, ' ');
        const setNum = (pos, valor, lon) => {
            const formatted = u.padInt(valor, lon);
            r2_liq = r2_liq.substring(0, pos - 1) + formatted + r2_liq.substring(pos + lon - 1);
        };
        const setImporte = (pos, valor) => {
            const formatted = u.padNumber(valor, 17);
            r2_liq = r2_liq.substring(0, pos - 1) + formatted + r2_liq.substring(pos + 16);
        };

        // [01] Nº de perceptores (arrendadores)
        setNum(109, modelo115.num_gastos, 8);
        // [02] Base retenciones (total alquileres)
        setImporte(117, modelo115.total_alquileres);
        // [03] Retenciones e ingresos a cuenta
        setImporte(134, modelo115.total_retenciones);
        // [04] Resultado a ingresar
        setImporte(151, modelo115.a_ingresar);

        r2 += r2_liq.substring(108, 400);
        r2 += "</T11501000>";

        return r1 + "\n" + r2;
    },

    /**
     * Generar fichero BOE para Modelo 349 (Operaciones intracomunitarias)
     */
    generarBOE349(datos) {
        const { year, trimestre, nif, nombre, modelo349 } = datos;
        const u = BOE_UTILS;
        const periodo = trimestre.padStart(2, '0');

        // REGISTRO TIPO 1 (Declarante)
        let r1 = "1";                      // Pos 1: Tipo registro
        r1 += "349";                       // Pos 2-4: Modelo
        r1 += u.padText(year, 4);          // Pos 5-8: Ejercicio
        r1 += u.padText(nif, 9);           // Pos 9-17: NIF declarante
        r1 += u.padText(nombre, 40);       // Pos 18-57: Razón social
        r1 += "T";                         // Pos 58: Soporte (T=telemático)
        r1 += u.padText("", 9);            // Pos 59-67: Teléfono contacto
        r1 += u.padText("", 40);           // Pos 68-107: Nombre contacto
        r1 += "349" + year + periodo;      // Pos 108-116: Identificador
        r1 += " ";                         // Pos 117: Complementaria
        r1 += " ";                         // Pos 118: Sustitutiva
        r1 += u.padInt(modelo349.operaciones.length, 9); // Pos 119-127: Nº operaciones
        r1 += u.padNumber(modelo349.total_intracomunitario, 15); // Pos 128-142: Importe total
        r1 += u.padInt(0, 9);              // Pos 143-151: Nº operadores rectificadas
        r1 += u.padNumber(0, 15);          // Pos 152-166: Importe rectificaciones
        r1 += periodo;                     // Pos 167-168: Período (trimestre)
        r1 = r1.padEnd(500, ' ');

        // REGISTROS TIPO 2 (Una línea por operador)
        const lineas = [r1];
        for (const op of (modelo349.operaciones || [])) {
            let r2 = "2";                              // Pos 1: Tipo registro
            r2 += "349";                               // Pos 2-4: Modelo
            r2 += u.padText(year, 4);                  // Pos 5-8: Ejercicio
            r2 += u.padText(nif, 9);                   // Pos 9-17: NIF declarante
            r2 += u.padText(op.nif_cif || '', 17);     // Pos 18-34: NIF operador UE
            r2 += u.padText(op.cliente || '', 40);     // Pos 35-74: Nombre operador
            r2 += "E";                                 // Pos 75: Clave operación (E=Entregas)
            r2 += u.padNumber(parseFloat(op.total), 13); // Pos 76-88: Base imponible
            r2 = r2.padEnd(500, ' ');
            lineas.push(r2);
        }

        return lineas.join("\n");
    },

    /**
     * Enviar presentación a la AEAT
     * URLs reales del servicio de presentación telemática AEAT
     * Documentación: https://sede.agenciatributaria.gob.es/static_files/Sede/Tema/Presentacion_Declaraciones/
     */
    async presentarModelo(empresaId, contenidoBOE, modelo) {
        const cert = await this.getCertificado(empresaId);

        // URLs reales de presentación AEAT por modelo
        // Preproducción (pruebas): www7.aeat.es
        // Producción (real): www1.agenciatributaria.gob.es
        const AEAT_PATHS = {
            '303': '/wlpl/OVCT-CALC/ModificarDeclaracion?Ession_MOD=303&ESSION_AM=I',
            '130': '/wlpl/OVCT-CALC/ModificarDeclaracion?Ession_MOD=130&ESSION_AM=I',
            '111': '/wlpl/OVCT-CALC/ModificarDeclaracion?Ession_MOD=111&SESSION_AM=I',
            '115': '/wlpl/OVCT-CALC/ModificarDeclaracion?Session_MOD=115&SESSION_AM=I',
            '349': '/wlpl/INOI-PRES/PresentarDeclaracion?modelo=349',
        };

        const usarPreproduccion = process.env.AEAT_ENTORNO !== 'produccion';
        const hostname = usarPreproduccion
            ? 'www7.aeat.es'
            : 'www1.agenciatributaria.gob.es';

        const modeloPath = AEAT_PATHS[modelo];
        if (!modeloPath) {
            throw new Error(`Modelo ${modelo} no tiene URL de presentación configurada`);
        }

        const options = {
            hostname,
            port: 443,
            path: modeloPath,
            method: 'POST',
            pfx: cert.pfx,
            passphrase: cert.passphrase,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(contenidoBOE)
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve({
                            success: true,
                            raw_response: data,
                            entorno: usarPreproduccion ? 'preproduccion' : 'produccion',
                            hostname
                        });
                    } else {
                        reject(new Error(`Error AEAT (${hostname}): ${res.statusCode} - ${data}`));
                    }
                });
            });

            req.on('error', (e) => {
                reject(new Error(`Error de conexión con ${hostname}: ${e.message}`));
            });

            req.write(contenidoBOE);
            req.end();
        });
    }
};
