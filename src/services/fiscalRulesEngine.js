/**
 * MOTOR DE REGLAS FISCALES CONFIGURABLE
 *
 * Carga reglas fiscales desde BD (fiscal_reglas_180) en vez de constantes hardcodeadas.
 * Cada enero, solo hay que insertar/actualizar filas para el nuevo ejercicio.
 *
 * Incluye caché en memoria con TTL para no consultar BD en cada petición.
 *
 * Uso:
 *   import { FiscalRules } from '../services/fiscalRulesEngine.js';
 *   const rules = await FiscalRules.forYear(2026);
 *   const tramos = rules.get('tramos_irpf', 'estatal');
 *   const minimo = rules.getNum('minimos_personales', 'general'); // 5550
 */

import { sql } from "../db.js";

// ============================================================
// CACHÉ EN MEMORIA (TTL 10 minutos)
// ============================================================
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos
const rulesCache = new Map(); // Map<ejercicio, { data, timestamp }>
const patternsCache = { data: null, timestamp: 0 };

function isCacheValid(entry) {
    return entry && (Date.now() - entry.timestamp) < CACHE_TTL_MS;
}

// ============================================================
// CLASE FiscalRules — Acceso tipado a reglas de un ejercicio
// ============================================================
class FiscalRulesYear {
    constructor(ejercicio, rules) {
        this.ejercicio = ejercicio;
        this._rules = rules; // Map<"categoria:clave", valor_parsed>
    }

    /**
     * Obtener valor JSONB parseado de una regla
     * @param {string} categoria - ej: 'tramos_irpf', 'minimos_personales'
     * @param {string} clave - ej: 'estatal', 'general'
     * @param {*} defaultValue - valor por defecto si no existe
     */
    get(categoria, clave, defaultValue = null) {
        const key = `${categoria}:${clave}`;
        return this._rules.has(key) ? this._rules.get(key) : defaultValue;
    }

    /**
     * Obtener valor numérico
     */
    getNum(categoria, clave, defaultValue = 0) {
        const val = this.get(categoria, clave);
        if (val === null || val === undefined) return defaultValue;
        return typeof val === 'number' ? val : parseFloat(val) || defaultValue;
    }

    /**
     * Obtener array (ej: tramos, descendientes)
     */
    getArray(categoria, clave, defaultValue = []) {
        const val = this.get(categoria, clave);
        return Array.isArray(val) ? val : defaultValue;
    }

    /**
     * Obtener string
     */
    getString(categoria, clave, defaultValue = '') {
        const val = this.get(categoria, clave);
        return typeof val === 'string' ? val : defaultValue;
    }

    /**
     * Obtener todas las reglas de una categoría
     */
    getCategory(categoria) {
        const result = {};
        for (const [key, val] of this._rules.entries()) {
            if (key.startsWith(categoria + ':')) {
                const clave = key.substring(categoria.length + 1);
                result[clave] = val;
            }
        }
        return result;
    }

    /**
     * Obtener tramos IRPF formateados para calcularCuotaTramos()
     * Convierte {hasta: null} → {hasta: Infinity}
     */
    getTramos(tipo = 'estatal') {
        const tramos = this.getArray('tramos_irpf', tipo);
        return tramos.map(t => ({
            hasta: t.hasta === null ? Infinity : t.hasta,
            tipo: t.tipo
        }));
    }

    /**
     * Verificar si existe una regla
     */
    has(categoria, clave) {
        return this._rules.has(`${categoria}:${clave}`);
    }
}

// ============================================================
// API PÚBLICA
// ============================================================
export const FiscalRules = {
    /**
     * Obtener reglas fiscales para un ejercicio
     * @param {number} ejercicio - Año fiscal (2025, 2026, etc.)
     * @returns {Promise<FiscalRulesYear>}
     */
    async forYear(ejercicio) {
        // Verificar caché
        const cached = rulesCache.get(ejercicio);
        if (isCacheValid(cached)) {
            return cached.data;
        }

        // Cargar desde BD
        const rows = await sql`
            SELECT categoria, clave, valor
            FROM fiscal_reglas_180
            WHERE ejercicio = ${ejercicio} AND activo = true
            ORDER BY categoria, clave
        `;

        const rulesMap = new Map();
        for (const row of rows) {
            const key = `${row.categoria}:${row.clave}`;
            // El valor ya viene como JSONB parseado por postgres
            rulesMap.set(key, row.valor);
        }

        // Si no hay reglas para ese año, intentar con el año más reciente
        if (rulesMap.size === 0) {
            const [latest] = await sql`
                SELECT DISTINCT ejercicio FROM fiscal_reglas_180
                WHERE ejercicio <= ${ejercicio} AND activo = true
                ORDER BY ejercicio DESC LIMIT 1
            `;
            if (latest && latest.ejercicio !== ejercicio) {
                console.warn(`⚠️ FiscalRules: No hay reglas para ${ejercicio}, usando ${latest.ejercicio}`);
                return this.forYear(latest.ejercicio);
            }
        }

        const rulesYear = new FiscalRulesYear(ejercicio, rulesMap);

        // Guardar en caché
        rulesCache.set(ejercicio, { data: rulesYear, timestamp: Date.now() });

        return rulesYear;
    },

    /**
     * Obtener patterns regex para extracción de casillas
     * @returns {Promise<Array>}
     */
    async getCasillaPatterns() {
        if (isCacheValid(patternsCache)) {
            return patternsCache.data;
        }

        const patterns = await sql`
            SELECT casilla, concepto, seccion, regex_pattern, grupo_valor, formato_origen
            FROM fiscal_casilla_patterns_180
            WHERE activo = true
            ORDER BY prioridad DESC, casilla ASC
        `;

        // Pre-compilar regex
        const compiled = patterns.map(p => {
            try {
                return {
                    ...p,
                    regex: new RegExp(p.regex_pattern, 'gmi')
                };
            } catch (e) {
                console.error(`❌ Regex inválido para casilla ${p.casilla}:`, p.regex_pattern, e.message);
                return null;
            }
        }).filter(Boolean);

        patternsCache.data = compiled;
        patternsCache.timestamp = Date.now();

        return compiled;
    },

    /**
     * Registrar acierto/fallo de un pattern (para retroalimentación)
     */
    async registerPatternResult(casilla, regexPattern, success) {
        try {
            if (success) {
                await sql`
                    UPDATE fiscal_casilla_patterns_180
                    SET aciertos = aciertos + 1, updated_at = NOW()
                    WHERE casilla = ${casilla} AND regex_pattern = ${regexPattern}
                `;
            } else {
                await sql`
                    UPDATE fiscal_casilla_patterns_180
                    SET fallos = fallos + 1, updated_at = NOW()
                    WHERE casilla = ${casilla} AND regex_pattern = ${regexPattern}
                `;
            }
        } catch (e) {
            // No bloquear por error de retroalimentación
        }
    },

    /**
     * Invalidar caché (útil al actualizar reglas desde admin)
     */
    invalidateCache(ejercicio = null) {
        if (ejercicio) {
            rulesCache.delete(ejercicio);
        } else {
            rulesCache.clear();
        }
        patternsCache.data = null;
        patternsCache.timestamp = 0;
    },

    /**
     * Copiar reglas de un ejercicio a otro (para preparar nuevo año)
     * @param {number} desde - Ejercicio origen
     * @param {number} hasta - Ejercicio destino
     */
    async copyRules(desde, hasta) {
        const result = await sql`
            INSERT INTO fiscal_reglas_180 (ejercicio, categoria, clave, valor, descripcion)
            SELECT ${hasta}, categoria, clave, valor, descripcion
            FROM fiscal_reglas_180
            WHERE ejercicio = ${desde} AND activo = true
            ON CONFLICT (ejercicio, categoria, clave) DO NOTHING
        `;
        this.invalidateCache(hasta);
        return result.count;
    }
};

// ============================================================
// FUNCIONES DE CÁLCULO (usan reglas dinámicas)
// ============================================================

/**
 * Calcula cuota por tramos progresivos
 * @param {number} baseImponible
 * @param {Array} tramos - [{hasta, tipo}, ...]
 */
export function calcularCuotaTramos(baseImponible, tramos) {
    let cuota = 0;
    let baseRestante = baseImponible;
    let limiteAnterior = 0;
    const desglose = [];

    for (const tramo of tramos) {
        if (baseRestante <= 0) break;

        const anchoTramo = tramo.hasta === Infinity
            ? baseRestante
            : tramo.hasta - limiteAnterior;
        const baseEnTramo = Math.min(baseRestante, anchoTramo);
        const cuotaTramo = baseEnTramo * tramo.tipo / 100;

        desglose.push({
            desde: limiteAnterior,
            hasta: tramo.hasta === Infinity ? null : tramo.hasta,
            tipo: tramo.tipo,
            base: Math.round(baseEnTramo * 100) / 100,
            cuota: Math.round(cuotaTramo * 100) / 100,
        });

        cuota += cuotaTramo;
        baseRestante -= baseEnTramo;
        limiteAnterior = tramo.hasta === Infinity ? limiteAnterior : tramo.hasta;
    }

    return { cuota: Math.round(cuota * 100) / 100, desglose };
}

/**
 * Calcula mínimos personales y familiares usando reglas dinámicas
 * @param {Object} datosPersonales
 * @param {FiscalRulesYear} rules
 * @param {Object} options
 * @param {string} options.tipo - 'estatal' | 'autonomico' (para usar mínimos autonómicos si existen)
 * @param {string} options.ccaa - código CCAA (ej: 'andalucia') para mínimos autonómicos
 */
export function calcularMinimosPersonales(datosPersonales, rules, options = {}) {
    const { tipo = 'estatal', ccaa = null } = options;

    // Para autonómico, usar mínimos específicos de CCAA si existen, sino los estatales
    const catMinimos = (tipo === 'autonomico' && ccaa && rules.has(`minimos_autonomicos_${ccaa}`, 'general'))
        ? `minimos_autonomicos_${ccaa}`
        : (tipo === 'autonomico' && rules.has('minimos_autonomicos', 'general'))
            ? 'minimos_autonomicos'
            : 'minimos_personales';

    let minimo = rules.getNum(catMinimos, 'general', 5550);

    if (!datosPersonales) return minimo;

    // Declaración individual con cónyuge → descendientes al 50%
    const tipoDeclaracion = datosPersonales.tipo_declaracion_preferida || 'individual';
    const tieneConyuge = datosPersonales.estado_civil === 'casado' || datosPersonales.estado_civil === 'pareja_hecho';
    const prorrateoDesc = (tipoDeclaracion === 'individual' && tieneConyuge) ? 0.5 : 1;

    // Edad declarante
    if (datosPersonales.fecha_nacimiento) {
        const nacimiento = new Date(datosPersonales.fecha_nacimiento);
        const edad = Math.floor((Date.now() - nacimiento.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
        if (edad >= 75) minimo += rules.getNum(catMinimos, 'edad_75', 1400);
        else if (edad >= 65) minimo += rules.getNum(catMinimos, 'edad_65', 1150);
    }

    // Discapacidad declarante
    const disc = datosPersonales.discapacidad_porcentaje || 0;
    if (disc >= 65) minimo += rules.getNum(catMinimos, 'discapacidad_65', 12000);
    else if (disc >= 33) minimo += rules.getNum(catMinimos, 'discapacidad_33', 3000);

    // Descendientes
    const minimosDesc = rules.getArray(catMinimos, 'descendientes', [2400, 2700, 4000, 4500]);
    const menorDe3 = rules.getNum(catMinimos, 'descendiente_menor_3', 2800);
    const descendientes = datosPersonales.descendientes || [];

    descendientes.forEach((d, i) => {
        const nacDesc = d.fecha_nacimiento ? new Date(d.fecha_nacimiento) : null;
        const edadDesc = nacDesc
            ? Math.floor((Date.now() - nacDesc.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
            : 99;

        if (edadDesc < 25 || (d.discapacidad_porcentaje && d.discapacidad_porcentaje >= 33)) {
            const minimoBase = minimosDesc[Math.min(i, minimosDesc.length - 1)] || minimosDesc[minimosDesc.length - 1];
            minimo += minimoBase * prorrateoDesc;

            if (edadDesc < 3) minimo += menorDe3 * prorrateoDesc;

            const discDesc = d.discapacidad_porcentaje || 0;
            if (discDesc >= 65) minimo += rules.getNum(catMinimos, 'discapacidad_65', 12000) * prorrateoDesc;
            else if (discDesc >= 33) minimo += rules.getNum(catMinimos, 'discapacidad_33', 3000) * prorrateoDesc;
        }
    });

    // Ascendientes
    const ascendientes = datosPersonales.ascendientes || [];
    ascendientes.forEach(a => {
        const nacAsc = a.fecha_nacimiento ? new Date(a.fecha_nacimiento) : null;
        const edadAsc = nacAsc
            ? Math.floor((Date.now() - nacAsc.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
            : 0;

        if (edadAsc >= 65 && a.convivencia) {
            minimo += rules.getNum(catMinimos, 'ascendiente_65', 1150);
            if (edadAsc >= 75) minimo += rules.getNum(catMinimos, 'ascendiente_75', 1400);

            const discAsc = a.discapacidad_porcentaje || 0;
            if (discAsc >= 65) minimo += rules.getNum(catMinimos, 'discapacidad_65', 12000);
            else if (discAsc >= 33) minimo += rules.getNum(catMinimos, 'discapacidad_33', 3000);
        }
    });

    return minimo;
}

/**
 * Calcula deducciones autonómicas según CCAA
 * @param {Object} datosPersonales
 * @param {FiscalRulesYear} rules
 * @param {string} ccaa - código CCAA
 * @param {number} baseImponibleGeneral - para comprobar límites de renta
 * @returns {Object} { total, desglose: { familia_numerosa, discapacidad_desc, ... } }
 */
export function calcularDeduccionesAutonomicas(datosPersonales, rules, ccaa, baseImponibleGeneral = 0) {
    const desglose = {};
    let total = 0;

    if (!datosPersonales || !ccaa) return { total: 0, desglose };

    const tipoDeclaracion = datosPersonales.tipo_declaracion_preferida || 'individual';
    const tieneConyuge = datosPersonales.estado_civil === 'casado' || datosPersonales.estado_civil === 'pareja_hecho';
    const prorrateo = (tipoDeclaracion === 'individual' && tieneConyuge) ? 0.5 : 1;

    // Descendientes con derecho a mínimo
    const descendientes = datosPersonales.descendientes || [];
    const numHijosConDerecho = descendientes.filter(d => {
        const nac = d.fecha_nacimiento ? new Date(d.fecha_nacimiento) : null;
        const edad = nac ? Math.floor((Date.now() - nac.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : 99;
        return edad < 25 || (d.discapacidad_porcentaje && d.discapacidad_porcentaje >= 33);
    }).length;

    // Familia numerosa: 3+ hijos con derecho
    const esFamiliaNumerosa = numHijosConDerecho >= 3;
    const esFamiliaNumerosaEspecial = numHijosConDerecho >= 5;

    // Deducción familia numerosa autonómica
    if (esFamiliaNumerosa) {
        const limiteRenta = tipoDeclaracion === 'individual'
            ? rules.getNum('deducciones_autonomicas', 'familia_numerosa_limite_ind', 25000)
            : rules.getNum('deducciones_autonomicas', 'familia_numerosa_limite_conj', 30000);

        if (baseImponibleGeneral <= limiteRenta) {
            const importe = esFamiliaNumerosaEspecial
                ? rules.getNum('deducciones_autonomicas', 'familia_numerosa_especial', 400)
                : rules.getNum('deducciones_autonomicas', 'familia_numerosa_general', 200);
            const deduccion = importe * prorrateo;
            desglose.familia_numerosa = deduccion;
            total += deduccion;
        }
    }

    // Deducción por discapacidad de descendientes (≥33%)
    const descConDiscapacidad = descendientes.filter(d => {
        const nac = d.fecha_nacimiento ? new Date(d.fecha_nacimiento) : null;
        const edad = nac ? Math.floor((Date.now() - nac.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : 99;
        return (edad < 25 || (d.discapacidad_porcentaje >= 33)) && d.discapacidad_porcentaje >= 33;
    });

    if (descConDiscapacidad.length > 0) {
        const limitDiscInd = rules.getNum('deducciones_autonomicas', 'discapacidad_desc_limite_ind', 80000);
        if (baseImponibleGeneral <= limitDiscInd) {
            const importePorHijo = rules.getNum('deducciones_autonomicas', 'discapacidad_descendiente', 100);
            const deduccion = importePorHijo * descConDiscapacidad.length * prorrateo;
            desglose.discapacidad_descendientes = deduccion;
            total += deduccion;
        }
    }

    // Deducción por discapacidad del contribuyente (≥33%)
    const discContrib = datosPersonales.discapacidad_porcentaje || 0;
    if (discContrib >= 33) {
        const importeDiscContrib = rules.getNum('deducciones_autonomicas', 'discapacidad_contribuyente', 150);
        desglose.discapacidad_contribuyente = importeDiscContrib;
        total += importeDiscContrib;
    }

    return { total: Math.round(total * 100) / 100, desglose };
}

/**
 * Calcula deducción estatal por familia numerosa (Art. 81 bis LIRPF)
 * Se aplica sobre la cuota diferencial (puede generar devolución)
 * @param {Object} datosPersonales
 * @param {FiscalRulesYear} rules
 * @param {number} anticipoFamiliaNumerosa - pagos anticipados recibidos (Modelo 143)
 * @returns {Object} { deduccion_bruta, anticipos, deduccion_neta }
 */
export function calcularDeduccionFamiliaNumerosa(datosPersonales, rules, anticipoFamiliaNumerosa = 0) {
    if (!datosPersonales) return { deduccion_bruta: 0, anticipos: 0, deduccion_neta: 0 };

    const descendientes = datosPersonales.descendientes || [];
    const numHijosConDerecho = descendientes.filter(d => {
        const nac = d.fecha_nacimiento ? new Date(d.fecha_nacimiento) : null;
        const edad = nac ? Math.floor((Date.now() - nac.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : 99;
        return edad < 25 || (d.discapacidad_porcentaje && d.discapacidad_porcentaje >= 33);
    }).length;

    if (numHijosConDerecho < 3) return { deduccion_bruta: 0, anticipos: 0, deduccion_neta: 0 };

    const esEspecial = numHijosConDerecho >= 5;
    const baseDeduccion = esEspecial
        ? rules.getNum('deducciones_estatales', 'familia_numerosa_especial', 2400)
        : rules.getNum('deducciones_estatales', 'familia_numerosa_general', 1200);

    // Hijos adicionales sobre el mínimo de la categoría
    const minimoCategoria = esEspecial ? 5 : 3;
    const hijosExtra = Math.max(0, numHijosConDerecho - minimoCategoria);
    const importeExtra = hijosExtra * rules.getNum('deducciones_estatales', 'familia_numerosa_hijo_extra', 600);

    const deduccionBruta = baseDeduccion + importeExtra;
    const deduccionNeta = deduccionBruta - anticipoFamiliaNumerosa;

    return {
        deduccion_bruta: deduccionBruta,
        anticipos: anticipoFamiliaNumerosa,
        deduccion_neta: deduccionNeta,
        tipo: esEspecial ? 'especial' : 'general',
        num_hijos: numHijosConDerecho
    };
}

// Lista de CCAA disponibles para selector
export const COMUNIDADES_AUTONOMAS = [
    { codigo: 'andalucia', nombre: 'Andalucía', regimen: 'comun' },
    { codigo: 'aragon', nombre: 'Aragón', regimen: 'comun' },
    { codigo: 'asturias', nombre: 'Asturias', regimen: 'comun' },
    { codigo: 'baleares', nombre: 'Islas Baleares', regimen: 'comun' },
    { codigo: 'canarias', nombre: 'Canarias', regimen: 'comun' },
    { codigo: 'cantabria', nombre: 'Cantabria', regimen: 'comun' },
    { codigo: 'castilla_la_mancha', nombre: 'Castilla-La Mancha', regimen: 'comun' },
    { codigo: 'castilla_y_leon', nombre: 'Castilla y León', regimen: 'comun' },
    { codigo: 'cataluna', nombre: 'Cataluña', regimen: 'comun' },
    { codigo: 'ceuta_melilla', nombre: 'Ceuta y Melilla', regimen: 'comun' },
    { codigo: 'extremadura', nombre: 'Extremadura', regimen: 'comun' },
    { codigo: 'galicia', nombre: 'Galicia', regimen: 'comun' },
    { codigo: 'madrid', nombre: 'Madrid', regimen: 'comun' },
    { codigo: 'murcia', nombre: 'Murcia', regimen: 'comun' },
    { codigo: 'la_rioja', nombre: 'La Rioja', regimen: 'comun' },
    { codigo: 'valencia', nombre: 'Comunitat Valenciana', regimen: 'comun' },
    { codigo: 'pais_vasco', nombre: 'País Vasco', regimen: 'foral' },
    { codigo: 'navarra', nombre: 'Navarra', regimen: 'foral' },
];

/**
 * Convierte importe español "25.432,18" a número 25432.18
 */
export function parseImporteEspanol(str) {
    if (!str) return 0;
    const cleaned = str.toString().trim()
        .replace(/\s/g, '')
        .replace(/\./g, '')      // quitar separador de miles
        .replace(',', '.');       // coma decimal → punto
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
}

/**
 * Extrae casillas de un texto de PDF usando solo regex patterns (sin IA)
 * @param {string} pdfText - Texto extraído del PDF
 * @returns {Promise<{casillas: Object, confianza: number, sinResolver: string[]}>}
 */
export async function extractCasillasConRegex(pdfText) {
    const patterns = await FiscalRules.getCasillaPatterns();
    const casillas = {};
    const resueltas = new Set();
    const patternResults = []; // Para retroalimentación

    for (const pattern of patterns) {
        if (resueltas.has(pattern.casilla)) continue; // Ya resuelta con mayor prioridad

        // Resetear lastIndex del regex
        pattern.regex.lastIndex = 0;
        const match = pattern.regex.exec(pdfText);

        if (match && match[pattern.grupo_valor]) {
            const valorStr = match[pattern.grupo_valor];
            const valor = parseImporteEspanol(valorStr);

            if (valor !== 0) {
                casillas[pattern.casilla] = valor;
                resueltas.add(pattern.casilla);
                patternResults.push({ casilla: pattern.casilla, pattern: pattern.regex_pattern, success: true });
            }
        }
    }

    // Retroalimentación asíncrona (no bloquea)
    for (const r of patternResults) {
        FiscalRules.registerPatternResult(r.casilla, r.pattern, r.success).catch(() => {});
    }

    // Casillas esperadas (ampliadas para formato AEAT autónomos)
    const casillasEsperadas = [
        '003', '012', '027', '063', '109',        // Rendimientos clásicos
        '180', '223', '224', '231', '235',         // Actividades económicas detalle
        '420', '435', '460',                       // Bases imponibles
        '505', '510', '519', '520',                // Bases liquidables + mínimos
        '545', '546', '570', '571',                // Cuotas íntegras y líquidas
        '587', '595', '604', '609',                // Cuota resultante + pagos a cuenta
        '610', '670', '695', '700'                 // Resultado
    ];

    // Para autónomos sin rendimientos del trabajo, no penalizar confianza
    // por casillas de trabajo (003, 012) si hay casillas de actividades (224, 235)
    const tieneActividades = resueltas.has('224') || resueltas.has('235') || resueltas.has('231');
    const casillasRelevantes = tieneActividades
        ? casillasEsperadas.filter(c => !['003', '012', '109'].includes(c))
        : casillasEsperadas;

    const sinResolver = casillasRelevantes.filter(c => !resueltas.has(c));
    const confianza = Math.min(1, resueltas.size / Math.max(1, casillasRelevantes.length * 0.4));

    return { casillas, confianza, sinResolver, totalResueltas: resueltas.size };
}
