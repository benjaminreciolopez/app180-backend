
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

        setCasilla(1019, modelo303.resultado_regimen_general ?? modelo303.resultado); // [46] Resultado régimen general

        // Página 3 - Resultado
        setCasilla(1036, modelo303.resultado_regimen_general ?? modelo303.resultado); // [64] Suma de resultados
        setCasilla(1053, 10000); // [65] % Atribuible Adm. Estado (100,00 → 5 dígitos: 3 enteros + 2 dec)
        setCasilla(1058, modelo303.resultado_regimen_general ?? modelo303.resultado); // [66] Atribuible Adm. Estado
        setCasilla(1092, modelo303.cuotas_compensar_pendientes || 0);   // [110] Cuotas a compensar pend. periodos anteriores
        setCasilla(1109, modelo303.cuotas_compensar_aplicadas || 0);    // [78] Cuotas compensar aplicadas este periodo
        setCasilla(1126, modelo303.cuotas_compensar_pendientes_posterior || 0); // [87] Pend. periodos posteriores
        setCasilla(1177, modelo303.resultado); // [69] Resultado de la autoliquidación
        setCasilla(1211, modelo303.resultado); // [71] Resultado final

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

    // =====================================================================
    // GENERADORES — RENTA (100) y SOCIEDADES (200)
    // =====================================================================

    /**
     * Generar fichero SES para Modelo 100 (Renta IRPF)
     * Formato: <T> tags (autoliquidación), multi-página
     * El 100 es el modelo más complejo con ~15 páginas
     */
    generarBOE100(datos) {
        const u = BOE_UTILS;
        const d = datos;
        const year = d.ejercicio?.toString() || '';
        const nif = d.nif || '';
        const nombre = d.nombre || '';

        // REGISTRO CABECERA (Hoja DP10000)
        let r1 = "<T";
        r1 += "100";
        r1 += "0";
        r1 += year;
        r1 += "0A";       // Periodo anual
        r1 += "0000>";
        r1 += "<AUX>";
        r1 = r1.padEnd(322, ' ');
        r1 += "</AUX>";
        r1 = r1.padEnd(500, ' ');

        // PÁGINA 1: Datos identificativos
        let p1 = "<T";
        p1 += "100";
        p1 += "01000>";
        p1 += " ";           // Complementaria
        p1 += " ";           // Tipo declaración
        p1 += u.padText(nif, 9);
        p1 += u.padText(nombre, 80);
        p1 += year;
        p1 += "0A";

        let p1_liq = "".padEnd(3000, ' ');
        const setC = (pos, valor) => {
            const formatted = u.padNumber(valor, 17);
            p1_liq = p1_liq.substring(0, pos - 1) + formatted + p1_liq.substring(pos + 16);
        };

        // Rendimientos actividad económica
        setC(200, d.ingresos_actividad || 0);              // [0200] Ingresos actividad
        setC(217, d.gastos_deducibles_actividad || 0);     // [0201] Gastos deducibles
        setC(234, d.rendimiento_neto_actividad || 0);      // [0202] Rendimiento neto
        setC(251, d.gastos_dificil_justificacion || 0);    // [0203] Gastos difícil justificación
        setC(268, d.rendimiento_neto_reducido_actividad || 0); // [0204] Rendimiento neto reducido

        // Rendimientos del trabajo
        setC(400, d.rendimientos_trabajo || 0);            // [0003] Rendimientos trabajo
        setC(417, d.retenciones_trabajo || 0);             // [0004] Retenciones trabajo

        // Rendimientos inmobiliarios
        setC(500, d.ingresos_alquiler || 0);               // [0061] Ingresos alquiler
        setC(517, d.gastos_alquiler || 0);                 // [0062] Gastos alquiler
        setC(534, d.rendimiento_inmobiliario || 0);        // [0063] Rendimiento inmobiliario

        // Rendimientos capital mobiliario
        setC(600, d.intereses_cuentas || 0);               // [0022] Intereses
        setC(617, d.dividendos || 0);                      // [0023] Dividendos

        // Ganancias patrimoniales
        setC(700, d.ganancias_patrimoniales || 0);         // [0266] Ganancias
        setC(717, d.perdidas_patrimoniales || 0);          // [0270] Pérdidas

        // Bases imponibles
        setC(1000, d.base_imponible_general || 0);         // [0435] BI General
        setC(1017, d.base_imponible_ahorro || 0);          // [0460] BI Ahorro

        // Reducciones
        setC(1100, d.reduccion_tributacion_conjunta || 0); // [0470] Reducción conjunta
        setC(1117, d.aportaciones_planes_pensiones || 0);  // [0480] Planes pensiones

        // Bases liquidables
        setC(1200, d.base_liquidable_general || 0);        // [0500] BL General
        setC(1217, d.base_liquidable_ahorro || 0);         // [0510] BL Ahorro

        // Cuotas
        setC(1400, d.cuota_integra_estatal || 0);          // [0519] Cuota íntegra estatal
        setC(1417, d.cuota_integra_autonomica || 0);       // [0520] Cuota íntegra autonómica
        setC(1434, d.cuota_integra_total || 0);            // [0521] Cuota íntegra total

        // Deducciones
        setC(1500, d.deduccion_vivienda_habitual || 0);    // [0547] Deducción vivienda
        setC(1517, d.deduccion_maternidad || 0);           // [0611] Deducción maternidad
        setC(1534, d.total_deducciones || 0);              // [0660] Total deducciones

        // Cuota líquida
        setC(1600, d.cuota_liquida || 0);                  // [0670] Cuota líquida

        // Retenciones y pagos a cuenta
        setC(1700, d.retenciones_pagos_cuenta || 0);       // [0735] Retenciones
        setC(1717, d.pagos_fraccionados || 0);             // [0740] Pagos fraccionados (mod 130)

        // Resultado final
        setC(1800, d.cuota_diferencial || 0);              // [0760] Cuota diferencial
        setC(1900, d.importe_resultado || 0);              // [0770] Resultado declaración

        p1 += p1_liq.substring(130, 2000);
        p1 += "</T10001000>";

        return r1 + "\n" + p1;
    },

    /**
     * Generar fichero XML para Modelo 200 (Impuesto de Sociedades)
     * Formato: XML (Sociedades WEB) — único modelo que usa XML
     * Esquema: sede.agenciatributaria.gob.es
     */
    generarXML200(datos) {
        const d = datos;
        const year = d.ejercicio?.toString() || '';
        const nif = d.nif || '';
        const nombre = d.nombre || '';

        const escaparXml = (str) => {
            if (!str) return '';
            return str.toString()
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
        };

        const fmt = (val) => {
            if (val === undefined || val === null) return '0.00';
            return parseFloat(val).toFixed(2);
        };

        const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<Modelo200>
  <Cabecera>
    <Modelo>200</Modelo>
    <Ejercicio>${year}</Ejercicio>
    <Periodo>0A</Periodo>
    <NIF>${escaparXml(nif)}</NIF>
    <RazonSocial>${escaparXml(nombre)}</RazonSocial>
    <TipoDeclaracion>I</TipoDeclaracion>
  </Cabecera>
  <CuentaResultados>
    <IngresosExplotacion>${fmt(d.ingresos_explotacion)}</IngresosExplotacion>
    <GastosExplotacion>${fmt(d.gastos_explotacion)}</GastosExplotacion>
    <ResultadoExplotacion>${fmt(d.resultado_explotacion)}</ResultadoExplotacion>
    <IngresosFinancieros>${fmt(d.ingresos_financieros)}</IngresosFinancieros>
    <GastosFinancieros>${fmt(d.gastos_financieros)}</GastosFinancieros>
    <ResultadoFinanciero>${fmt(d.resultado_financiero)}</ResultadoFinanciero>
    <ResultadoAntesImpuestos>${fmt(d.resultado_antes_impuestos)}</ResultadoAntesImpuestos>
  </CuentaResultados>
  <BaseImponible>
    <AjustesPositivos>${fmt(d.ajustes_positivos)}</AjustesPositivos>
    <AjustesNegativos>${fmt(d.ajustes_negativos)}</AjustesNegativos>
    <BaseImponiblePrevia>${fmt(d.base_imponible_previa)}</BaseImponiblePrevia>
    <CompensacionBIN>${fmt(d.compensacion_bin)}</CompensacionBIN>
    <BaseImponible>${fmt(d.base_imponible)}</BaseImponible>
  </BaseImponible>
  <Liquidacion>
    <TipoGravamen>${fmt(d.tipo_gravamen)}</TipoGravamen>
    <TipoAplicado>${escaparXml(d.tipo_aplicado)}</TipoAplicado>
    <CuotaIntegra>${fmt(d.cuota_integra)}</CuotaIntegra>
    <DeduccionDobleImposicion>${fmt(d.deduccion_doble_imposicion)}</DeduccionDobleImposicion>
    <DeduccionesID>${fmt(d.deducciones_id)}</DeduccionesID>
    <Bonificaciones>${fmt(d.bonificaciones)}</Bonificaciones>
    <OtrasDeducciones>${fmt(d.otras_deducciones)}</OtrasDeducciones>
    <TotalDeducciones>${fmt(d.total_deducciones)}</TotalDeducciones>
    <CuotaLiquida>${fmt(d.cuota_liquida)}</CuotaLiquida>
    <Retenciones>${fmt(d.retenciones)}</Retenciones>
    <PagosFraccionados>${fmt(d.pagos_fraccionados)}</PagosFraccionados>
    <CuotaDiferencial>${fmt(d.cuota_diferencial)}</CuotaDiferencial>
    <Resultado>${escaparXml(d.resultado)}</Resultado>
    <ImporteResultado>${fmt(d.importe_resultado)}</ImporteResultado>
  </Liquidacion>
</Modelo200>`;

        return xml;
    },

    // =====================================================================
    // GENERADORES BOE — MODELOS ANUALES
    // =====================================================================

    /**
     * Generar fichero SES para Modelo 390 (Resumen anual IVA)
     * Formato: <T> tags (autoliquidación), mismo patrón que 303
     * Diseño de registro: sede.agenciatributaria.gob.es/Sede/ayuda/disenos-registro/modelos-300-399.html
     */
    generarBOE390(datos) {
        const { year, nif, nombre, devengado, deducible, resultado, compensaciones,
                resultado_final, operaciones_exentas, operaciones_intracomunitarias,
                volumen_operaciones } = datos;
        const u = BOE_UTILS;

        // REGISTRO TIPO 1 (Cabecera - Hoja DP39000)
        let r1 = "<T";
        r1 += "390";
        r1 += "0";
        r1 += year;
        r1 += "0A";       // Periodo anual
        r1 += "0000>";
        r1 += "<AUX>";
        r1 = r1.padEnd(322, ' ');
        r1 += "</AUX>";
        r1 = r1.padEnd(390, ' ');

        // REGISTRO TIPO 2 - Página 1: Identificación declarante
        let r2 = "<T";
        r2 += "390";
        r2 += "01000>";
        r2 += " ";          // Complementaria
        r2 += " ";          // Sustitutiva
        r2 += u.padText(nif, 9);
        r2 += u.padText(nombre, 80);
        r2 += year;
        r2 += "0A";         // Periodo anual

        let r2_liq = "".padEnd(2500, ' ');
        const setCasilla = (pos, valor) => {
            const formatted = u.padNumber(valor, 17);
            r2_liq = r2_liq.substring(0, pos - 1) + formatted + r2_liq.substring(pos + 16);
        };

        // IVA DEVENGADO — Régimen general por tipos
        const porTipo = devengado.por_tipo || {};
        const al4  = porTipo.al_4  || { base: 0, cuota: 0 };
        const al10 = porTipo.al_10 || { base: 0, cuota: 0 };
        const al21 = porTipo.al_21 || { base: 0, cuota: 0 };

        // Casillas [01]-[09]: Régimen general (misma estructura que 303)
        setCasilla(209, al4.base);       // [01] Base imponible 4%
        setCasilla(226, 4);              // [02] Tipo %
        setCasilla(231, al4.cuota);      // [03] Cuota 4%
        setCasilla(248, al10.base);      // [04] Base imponible 10%
        setCasilla(265, 10);             // [05] Tipo %
        setCasilla(270, al10.cuota);     // [06] Cuota 10%
        setCasilla(287, al21.base);      // [07] Base imponible 21%
        setCasilla(304, 21);             // [08] Tipo %
        setCasilla(309, al21.cuota);     // [09] Cuota 21%

        // [27] Total cuota devengada
        setCasilla(696, devengado.cuota_total);

        // IVA DEDUCIBLE
        const porTipoDed = deducible.por_tipo || {};
        const ded4  = porTipoDed.al_4  || { base: 0, cuota: 0 };
        const ded10 = porTipoDed.al_10 || { base: 0, cuota: 0 };
        const ded21 = porTipoDed.al_21 || { base: 0, cuota: 0 };

        setCasilla(713, ded4.base + ded10.base + ded21.base);    // [190] Base total op. interiores
        setCasilla(730, ded4.cuota + ded10.cuota + ded21.cuota); // [191] Cuota total deducible
        setCasilla(1002, deducible.cuota_total);  // [45] Total a deducir

        // Resultado
        setCasilla(1019, resultado);              // [64] Resultado régimen general
        setCasilla(1036, resultado);              // [84] Suma de resultados
        setCasilla(1053, 10000);                  // [85] % Atribuible Adm. Estado (100,00)
        setCasilla(1058, resultado);              // [86] Atribuible Adm. Estado
        setCasilla(1092, compensaciones || 0);    // [110] Compensaciones aplicadas en 303
        setCasilla(1177, resultado_final);        // [95] Resultado liquidación anual

        // Volumen de operaciones (Página específica del 390)
        setCasilla(1500, operaciones_exentas || 0);          // [99] Operaciones exentas
        setCasilla(1517, operaciones_intracomunitarias || 0); // [103] Op. intracomunitarias
        setCasilla(1600, volumen_operaciones || 0);           // [108] Volumen total operaciones

        r2 += r2_liq.substring(130, 1700);
        r2 += "</T39001000>";

        return r1 + "\n" + r2;
    },

    /**
     * Generar fichero BOE para Modelo 190 (Resumen anual retenciones IRPF)
     * Formato: Multi-registro ancho fijo (declaración informativa)
     * Registro Tipo 1 (Declarante) + Tipo 2 (Perceptor) — 500 chars por línea
     */
    generarBOE190(datos) {
        const { year, nif, nombre, trabajadores, profesionales,
                total_perceptores, total_rendimientos, total_retenciones } = datos;
        const u = BOE_UTILS;

        // REGISTRO TIPO 1 — Declarante (500 chars)
        let r1 = "1";                                    // Pos 1: Tipo registro
        r1 += "190";                                     // Pos 2-4: Modelo
        r1 += u.padText(year, 4);                        // Pos 5-8: Ejercicio
        r1 += u.padText(nif, 9);                         // Pos 9-17: NIF declarante
        r1 += u.padText(nombre, 40);                     // Pos 18-57: Razón social
        r1 += "T";                                       // Pos 58: Soporte (T=telemático)
        r1 += u.padText("", 9);                          // Pos 59-67: Teléfono contacto
        r1 += u.padText("", 40);                         // Pos 68-107: Nombre contacto
        r1 += u.padInt(0, 13);                           // Pos 108-120: Nº justificante (se rellena al presentar)
        r1 += "  ";                                      // Pos 121-122: Complementaria/sustitutiva
        r1 += u.padInt(0, 13);                           // Pos 123-135: Nº justificante anterior
        r1 += u.padInt(total_perceptores, 9);            // Pos 136-144: Nº total percepciones
        r1 += " " + u.padNumber(total_rendimientos, 14); // Pos 145-159: Importe total percepciones (signo + 14)
        r1 += " " + u.padNumber(total_retenciones, 14);  // Pos 160-174: Importe total retenciones (signo + 14)
        r1 = r1.padEnd(500, ' ');                        // Pos 175-500: Blancos

        const lineas = [r1];

        // REGISTROS TIPO 2 — Perceptores (trabajadores clave A)
        for (const t of (trabajadores || [])) {
            let r2 = "2";                                        // Pos 1: Tipo registro
            r2 += "190";                                         // Pos 2-4: Modelo
            r2 += u.padText(year, 4);                            // Pos 5-8: Ejercicio
            r2 += u.padText(nif, 9);                             // Pos 9-17: NIF declarante
            r2 += u.padText(t.nif || '', 9);                    // Pos 18-26: NIF perceptor
            r2 += u.padText("", 9);                              // Pos 27-35: NIF representante legal
            r2 += u.padText(t.nombre || '', 40);                 // Pos 36-75: Nombre perceptor
            r2 += u.padInt(0, 2);                                // Pos 76-77: Código provincia
            r2 += u.padText(t.clave || 'A', 2);                 // Pos 78-79: Clave percepción
            r2 += u.padText(t.subclave || '01', 2);             // Pos 80-81: Subclave
            r2 += " " + u.padNumber(t.retribuciones_integras, 14); // Pos 82-96: Percepciones dinerarias
            r2 += " " + u.padNumber(t.retenciones, 14);         // Pos 97-111: Retenciones
            r2 += " " + u.padNumber(0, 14);                     // Pos 112-126: Percepciones en especie
            r2 += " " + u.padNumber(0, 14);                     // Pos 127-141: Ingresos a cuenta repercutidos
            r2 += u.padText("", 5);                              // Pos 142-146: Ejercicio devengo
            r2 += " ";                                           // Pos 147: Ceuta/Melilla
            r2 = r2.padEnd(500, ' ');                            // Pos 148-500: Blancos
            lineas.push(r2);
        }

        // REGISTROS TIPO 2 — Perceptores (profesionales clave G)
        for (const p of (profesionales || [])) {
            let r2 = "2";
            r2 += "190";
            r2 += u.padText(year, 4);
            r2 += u.padText(nif, 9);
            r2 += u.padText(p.nif || '', 9);
            r2 += u.padText("", 9);
            r2 += u.padText(p.nombre || '', 40);
            r2 += u.padInt(0, 2);
            r2 += u.padText(p.clave || 'G', 2);
            r2 += u.padText(p.subclave || '01', 2);
            r2 += " " + u.padNumber(p.retribuciones_integras, 14);
            r2 += " " + u.padNumber(p.retenciones, 14);
            r2 += " " + u.padNumber(0, 14);
            r2 += " " + u.padNumber(0, 14);
            r2 += u.padText("", 5);
            r2 += " ";
            r2 = r2.padEnd(500, ' ');
            lineas.push(r2);
        }

        return lineas.join("\r\n");
    },

    /**
     * Generar fichero BOE para Modelo 180 (Resumen anual retenciones arrendamientos)
     * Formato: Multi-registro ancho fijo (declaración informativa)
     * Registro Tipo 1 (Declarante) + Tipo 2 (Arrendador) — 500 chars por línea
     */
    generarBOE180(datos) {
        const { year, nif, nombre, arrendadores,
                total_arrendadores, total_alquileres, total_retenciones } = datos;
        const u = BOE_UTILS;

        // REGISTRO TIPO 1 — Declarante (500 chars)
        let r1 = "1";                                    // Pos 1: Tipo registro
        r1 += "180";                                     // Pos 2-4: Modelo
        r1 += u.padText(year, 4);                        // Pos 5-8: Ejercicio
        r1 += u.padText(nif, 9);                         // Pos 9-17: NIF declarante
        r1 += u.padText(nombre, 40);                     // Pos 18-57: Razón social
        r1 += "T";                                       // Pos 58: Soporte
        r1 += u.padText("", 9);                          // Pos 59-67: Teléfono
        r1 += u.padText("", 40);                         // Pos 68-107: Persona contacto
        r1 += u.padInt(0, 13);                           // Pos 108-120: Nº justificante
        r1 += "  ";                                      // Pos 121-122: Complementaria/sustitutiva
        r1 += u.padInt(0, 13);                           // Pos 123-135: Nº justificante anterior
        r1 += u.padInt(total_arrendadores, 9);           // Pos 136-144: Nº total percepciones
        r1 += " " + u.padNumber(total_alquileres, 14);  // Pos 145-159: Base retenciones
        r1 += " " + u.padNumber(total_retenciones, 14); // Pos 160-174: Retenciones
        r1 = r1.padEnd(500, ' ');                        // Pos 175-500: Blancos

        const lineas = [r1];

        // REGISTROS TIPO 2 — Arrendadores
        for (const a of (arrendadores || [])) {
            let r2 = "2";                                        // Pos 1: Tipo registro
            r2 += "180";                                         // Pos 2-4: Modelo
            r2 += u.padText(year, 4);                            // Pos 5-8: Ejercicio
            r2 += u.padText(nif, 9);                             // Pos 9-17: NIF declarante
            r2 += u.padText("", 9);                              // Pos 18-26: NIF arrendador
            r2 += u.padText("", 9);                              // Pos 27-35: NIF representante legal
            r2 += u.padText(a.arrendador || '', 40);             // Pos 36-75: Nombre arrendador
            r2 += u.padInt(0, 2);                                // Pos 76-77: Código provincia
            r2 += "1 ";                                          // Pos 78-79: Clave (1=arrendamiento)
            r2 += " " + u.padNumber(a.total_alquileres, 14);    // Pos 80-94: Base retenciones
            r2 += u.padNumber(1900, 5);                          // Pos 95-99: % retención (19,00)
            r2 += " " + u.padNumber(a.total_retenciones, 14);   // Pos 100-114: Retenciones
            r2 += " ";                                           // Pos 115: Ejercicio devengo flag
            r2 += u.padText("", 4);                              // Pos 116-119: Ejercicio devengo
            r2 += u.padText("", 20);                             // Pos 120-139: Referencia catastral
            r2 += u.padInt(0, 5);                                // Pos 140-144: Tipo vía
            r2 += u.padText("", 50);                             // Pos 145-194: Nombre vía
            r2 += u.padText("", 3);                              // Pos 195-197: Tipo numeración
            r2 += u.padInt(0, 5);                                // Pos 198-202: Número casa
            r2 += u.padText("", 5);                              // Pos 203-207: Calificador
            r2 += u.padText("", 4);                              // Pos 208-211: Bloque
            r2 += u.padText("", 2);                              // Pos 212-213: Portal
            r2 += u.padText("", 3);                              // Pos 214-216: Escalera
            r2 += u.padText("", 3);                              // Pos 217-219: Planta
            r2 += u.padText("", 3);                              // Pos 220-222: Puerta
            r2 += u.padInt(0, 5);                                // Pos 223-227: Código municipio
            r2 += u.padText("", 30);                             // Pos 228-257: Municipio
            r2 += u.padText("", 30);                             // Pos 258-287: Municipio ampliado
            r2 += u.padInt(0, 5);                                // Pos 288-292: Código postal
            r2 = r2.padEnd(500, ' ');                            // Pos 293-500: Blancos
            lineas.push(r2);
        }

        return lineas.join("\r\n");
    },

    /**
     * Generar fichero BOE para Modelo 347 (Operaciones con terceros >3.005,06 EUR)
     * Formato: Multi-registro ancho fijo (declaración informativa)
     * Registro Tipo 1 (Declarante) + Tipo 2 (Declarado) — 500 chars por línea
     */
    generarBOE347(datos) {
        const { year, nif, nombre, terceros, total_terceros, importe_total } = datos;
        const u = BOE_UTILS;

        // REGISTRO TIPO 1 — Declarante (500 chars)
        let r1 = "1";                                    // Pos 1: Tipo registro
        r1 += "347";                                     // Pos 2-4: Modelo
        r1 += u.padText(year, 4);                        // Pos 5-8: Ejercicio
        r1 += u.padText(nif, 9);                         // Pos 9-17: NIF declarante
        r1 += u.padText(nombre, 40);                     // Pos 18-57: Razón social
        r1 += "T";                                       // Pos 58: Soporte
        r1 += u.padText("", 9);                          // Pos 59-67: Teléfono
        r1 += u.padText("", 40);                         // Pos 68-107: Persona contacto
        r1 += u.padInt(0, 13);                           // Pos 108-120: Nº justificante
        r1 += "  ";                                      // Pos 121-122: Complementaria/sustitutiva
        r1 += u.padInt(0, 13);                           // Pos 123-135: Nº justificante anterior
        r1 += u.padInt(total_terceros, 9);               // Pos 136-144: Nº total declarados
        r1 += " " + u.padNumber(importe_total, 16);     // Pos 145-161: Importe total operaciones
        r1 += u.padInt(0, 9);                            // Pos 162-170: Nº total inmuebles
        r1 += " " + u.padNumber(0, 16);                 // Pos 171-187: Importe total inmuebles
        r1 = r1.padEnd(500, ' ');                        // Pos 188-500: Blancos

        const lineas = [r1];

        // REGISTROS TIPO 2 — Declarados (un registro por tercero)
        for (const t of (terceros || [])) {
            // Clave operación: A=compras al proveedor, B=ventas al cliente
            const claveOp = t.tipo === 'proveedor' ? 'A' : 'B';

            let r2 = "2";                                        // Pos 1: Tipo registro
            r2 += "347";                                         // Pos 2-4: Modelo
            r2 += u.padText(year, 4);                            // Pos 5-8: Ejercicio
            r2 += u.padText(nif, 9);                             // Pos 9-17: NIF declarante
            r2 += u.padText(t.nif || '', 9);                    // Pos 18-26: NIF declarado
            r2 += u.padText("", 9);                              // Pos 27-35: NIF representante
            r2 += u.padText(t.nombre || '', 40);                 // Pos 36-75: Nombre declarado
            r2 += "D";                                           // Pos 76: Tipo hoja (D=detalle)
            r2 += u.padInt(0, 2);                                // Pos 77-78: Código provincia
            r2 += "  ";                                          // Pos 79-80: Código país
            r2 += claveOp;                                       // Pos 81: Clave operación (A/B)
            r2 += " " + u.padNumber(t.total, 15);               // Pos 82-97: Importe anual (signo + 15)
            r2 += " ";                                           // Pos 98: Operación seguro
            r2 += " ";                                           // Pos 99: Arrendamiento local negocio
            r2 += " " + u.padNumber(0, 15);                     // Pos 100-115: Importe metálico
            r2 += u.padText("", 4);                              // Pos 116-119: Ejercicio cobro metálico
            r2 += " " + u.padNumber(t.q1 || 0, 15);             // Pos 120-135: Importe 1T
            r2 += " " + u.padNumber(t.q2 || 0, 15);             // Pos 136-151: Importe 2T
            r2 += " " + u.padNumber(t.q3 || 0, 15);             // Pos 152-167: Importe 3T
            r2 += " " + u.padNumber(t.q4 || 0, 15);             // Pos 168-183: Importe 4T
            r2 += u.padText("", 20);                             // Pos 184-203: Referencia catastral
            r2 = r2.padEnd(500, ' ');                            // Pos 204-500: Blancos
            lineas.push(r2);
        }

        return lineas.join("\r\n");
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
            // Autoliquidaciones trimestrales
            '303': '/wlpl/OVCT-CALC/ModificarDeclaracion?Ession_MOD=303&ESSION_AM=I',
            '130': '/wlpl/OVCT-CALC/ModificarDeclaracion?Ession_MOD=130&ESSION_AM=I',
            '111': '/wlpl/OVCT-CALC/ModificarDeclaracion?Ession_MOD=111&SESSION_AM=I',
            '115': '/wlpl/OVCT-CALC/ModificarDeclaracion?Session_MOD=115&SESSION_AM=I',
            // Autoliquidación anual
            '390': '/wlpl/OVCT-CALC/ModificarDeclaracion?Ession_MOD=390&ESSION_AM=I',
            // Declaraciones informativas
            '349': '/wlpl/INOI-PRES/PresentarDeclaracion?modelo=349',
            '190': '/wlpl/INOI-PRES/PresentarDeclaracion?modelo=190',
            '180': '/wlpl/INOI-PRES/PresentarDeclaracion?modelo=180',
            '347': '/wlpl/INOI-PRES/PresentarDeclaracion?modelo=347',
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
