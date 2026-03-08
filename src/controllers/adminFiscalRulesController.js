
import { sql } from "../db.js";
import { FiscalRules } from "../services/fiscalRulesEngine.js";

/**
 * Helper: obtener empresa_id del usuario
 */
async function getEmpresaId(userId) {
    const r = await sql`SELECT id FROM empresa_180 WHERE user_id=${userId} LIMIT 1`;
    if (!r[0]) {
        const e = new Error("Empresa no asociada");
        e.status = 403;
        throw e;
    }
    return r[0].id;
}

// ============================================================
// REGLAS FISCALES CRUD
// ============================================================

/**
 * GET /admin/fiscal/reglas/:ejercicio
 * Listar todas las reglas de un ejercicio
 */
export async function getReglasByEjercicio(req, res) {
    try {
        const { ejercicio } = req.params;
        const year = parseInt(ejercicio);
        if (!year || year < 2000 || year > 2100) {
            return res.status(400).json({ error: "Ejercicio inválido" });
        }

        const rows = await sql`
            SELECT id, ejercicio, categoria, clave, valor, descripcion, activo, created_at, updated_at
            FROM fiscal_reglas_180
            WHERE ejercicio = ${year}
            ORDER BY categoria, clave
        `;

        // Agrupar por categoría para mejor UX
        const porCategoria = {};
        for (const row of rows) {
            if (!porCategoria[row.categoria]) {
                porCategoria[row.categoria] = [];
            }
            porCategoria[row.categoria].push(row);
        }

        res.json({
            ejercicio: year,
            total: rows.length,
            categorias: Object.keys(porCategoria),
            reglas: rows,
            porCategoria
        });
    } catch (err) {
        console.error("Error getReglasByEjercicio:", err);
        res.status(500).json({ error: "Error al obtener reglas fiscales" });
    }
}

/**
 * GET /admin/fiscal/reglas
 * Listar ejercicios disponibles con resumen
 */
export async function getEjerciciosDisponibles(req, res) {
    try {
        const rows = await sql`
            SELECT
                ejercicio,
                COUNT(*) as total_reglas,
                COUNT(*) FILTER (WHERE activo = true) as reglas_activas,
                MIN(created_at) as primera_regla,
                MAX(updated_at) as ultima_actualizacion
            FROM fiscal_reglas_180
            GROUP BY ejercicio
            ORDER BY ejercicio DESC
        `;

        res.json({ ejercicios: rows });
    } catch (err) {
        console.error("Error getEjerciciosDisponibles:", err);
        res.status(500).json({ error: "Error al obtener ejercicios" });
    }
}

/**
 * PUT /admin/fiscal/reglas/:id
 * Actualizar una regla específica
 */
export async function updateRegla(req, res) {
    try {
        const { id } = req.params;
        const { valor, descripcion, activo } = req.body;

        if (valor === undefined && descripcion === undefined && activo === undefined) {
            return res.status(400).json({ error: "Debe enviar al menos un campo a actualizar (valor, descripcion, activo)" });
        }

        // Construir update dinámico
        const updates = {};
        if (valor !== undefined) updates.valor = JSON.stringify(valor);
        if (descripcion !== undefined) updates.descripcion = descripcion;
        if (activo !== undefined) updates.activo = activo;

        const [updated] = await sql`
            UPDATE fiscal_reglas_180
            SET
                valor = CASE WHEN ${valor !== undefined} THEN ${JSON.stringify(valor)}::jsonb ELSE valor END,
                descripcion = CASE WHEN ${descripcion !== undefined} THEN ${descripcion || ''} ELSE descripcion END,
                activo = CASE WHEN ${activo !== undefined} THEN ${activo} ELSE activo END,
                updated_at = NOW()
            WHERE id = ${id}
            RETURNING *
        `;

        if (!updated) {
            return res.status(404).json({ error: "Regla no encontrada" });
        }

        // Invalidar caché para ese ejercicio
        FiscalRules.invalidateCache(updated.ejercicio);

        res.json({ message: "Regla actualizada", regla: updated });
    } catch (err) {
        console.error("Error updateRegla:", err);
        res.status(500).json({ error: "Error al actualizar regla" });
    }
}

/**
 * POST /admin/fiscal/reglas
 * Crear una nueva regla
 */
export async function createRegla(req, res) {
    try {
        const { ejercicio, categoria, clave, valor, descripcion } = req.body;

        if (!ejercicio || !categoria || !clave || valor === undefined) {
            return res.status(400).json({ error: "Campos requeridos: ejercicio, categoria, clave, valor" });
        }

        const year = parseInt(ejercicio);
        if (!year || year < 2000 || year > 2100) {
            return res.status(400).json({ error: "Ejercicio inválido" });
        }

        const [created] = await sql`
            INSERT INTO fiscal_reglas_180 (ejercicio, categoria, clave, valor, descripcion)
            VALUES (${year}, ${categoria}, ${clave}, ${JSON.stringify(valor)}::jsonb, ${descripcion || ''})
            ON CONFLICT (ejercicio, categoria, clave)
            DO UPDATE SET valor = ${JSON.stringify(valor)}::jsonb,
                          descripcion = COALESCE(${descripcion}, fiscal_reglas_180.descripcion),
                          updated_at = NOW()
            RETURNING *
        `;

        // Invalidar caché
        FiscalRules.invalidateCache(year);

        res.status(201).json({ message: "Regla creada/actualizada", regla: created });
    } catch (err) {
        console.error("Error createRegla:", err);
        res.status(500).json({ error: "Error al crear regla" });
    }
}

/**
 * DELETE /admin/fiscal/reglas/:id
 * Desactivar una regla (soft delete)
 */
export async function deleteRegla(req, res) {
    try {
        const { id } = req.params;

        const [updated] = await sql`
            UPDATE fiscal_reglas_180
            SET activo = false, updated_at = NOW()
            WHERE id = ${id}
            RETURNING ejercicio, categoria, clave
        `;

        if (!updated) {
            return res.status(404).json({ error: "Regla no encontrada" });
        }

        FiscalRules.invalidateCache(updated.ejercicio);

        res.json({ message: "Regla desactivada", regla: updated });
    } catch (err) {
        console.error("Error deleteRegla:", err);
        res.status(500).json({ error: "Error al desactivar regla" });
    }
}

/**
 * POST /admin/fiscal/reglas/copiar
 * Copiar reglas de un ejercicio a otro
 */
export async function copiarReglas(req, res) {
    try {
        const { desde, hasta } = req.body;

        if (!desde || !hasta) {
            return res.status(400).json({ error: "Campos requeridos: desde (año origen), hasta (año destino)" });
        }

        const yearDesde = parseInt(desde);
        const yearHasta = parseInt(hasta);

        if (!yearDesde || !yearHasta || yearDesde === yearHasta) {
            return res.status(400).json({ error: "Los años deben ser diferentes y válidos" });
        }

        // Verificar que hay reglas en el año origen
        const [check] = await sql`
            SELECT COUNT(*) as total FROM fiscal_reglas_180
            WHERE ejercicio = ${yearDesde} AND activo = true
        `;

        if (parseInt(check.total) === 0) {
            return res.status(404).json({ error: `No hay reglas activas para el ejercicio ${yearDesde}` });
        }

        const count = await FiscalRules.copyRules(yearDesde, yearHasta);

        res.json({
            message: `${count} reglas copiadas de ${yearDesde} a ${yearHasta}`,
            desde: yearDesde,
            hasta: yearHasta,
            reglasCopiadas: count
        });
    } catch (err) {
        console.error("Error copiarReglas:", err);
        res.status(500).json({ error: "Error al copiar reglas" });
    }
}

// ============================================================
// REGEX PATTERNS CRUD
// ============================================================

/**
 * GET /admin/fiscal/reglas/patterns
 * Listar todos los regex patterns para extracción de casillas
 */
export async function getPatterns(req, res) {
    try {
        const rows = await sql`
            SELECT id, casilla, concepto, seccion, regex_pattern, grupo_valor,
                   formato_origen, prioridad, activo, aciertos, fallos,
                   created_at, updated_at
            FROM fiscal_casilla_patterns_180
            ORDER BY casilla ASC, prioridad DESC
        `;

        // Calcular estadísticas
        const stats = {
            total: rows.length,
            activos: rows.filter(r => r.activo).length,
            totalAciertos: rows.reduce((s, r) => s + (r.aciertos || 0), 0),
            totalFallos: rows.reduce((s, r) => s + (r.fallos || 0), 0),
        };
        stats.tasaExito = stats.totalAciertos + stats.totalFallos > 0
            ? Math.round(stats.totalAciertos / (stats.totalAciertos + stats.totalFallos) * 100)
            : 0;

        res.json({ patterns: rows, stats });
    } catch (err) {
        console.error("Error getPatterns:", err);
        res.status(500).json({ error: "Error al obtener patterns" });
    }
}

/**
 * POST /admin/fiscal/reglas/patterns
 * Crear un nuevo regex pattern
 */
export async function createPattern(req, res) {
    try {
        const { casilla, concepto, seccion, regex_pattern, grupo_valor, formato_origen, prioridad } = req.body;

        if (!casilla || !regex_pattern) {
            return res.status(400).json({ error: "Campos requeridos: casilla, regex_pattern" });
        }

        // Validar que el regex es válido
        try {
            new RegExp(regex_pattern, 'gmi');
        } catch (e) {
            return res.status(400).json({ error: `Regex inválido: ${e.message}` });
        }

        const [created] = await sql`
            INSERT INTO fiscal_casilla_patterns_180
                (casilla, concepto, seccion, regex_pattern, grupo_valor, formato_origen, prioridad)
            VALUES (
                ${casilla},
                ${concepto || ''},
                ${seccion || ''},
                ${regex_pattern},
                ${grupo_valor || 1},
                ${formato_origen || 'es'},
                ${prioridad || 10}
            )
            RETURNING *
        `;

        // Invalidar caché de patterns
        FiscalRules.invalidateCache();

        res.status(201).json({ message: "Pattern creado", pattern: created });
    } catch (err) {
        if (err.code === '23505') { // unique violation
            return res.status(409).json({ error: "Ya existe un pattern con esa casilla y regex" });
        }
        console.error("Error createPattern:", err);
        res.status(500).json({ error: "Error al crear pattern" });
    }
}

/**
 * PUT /admin/fiscal/reglas/patterns/:id
 * Actualizar un regex pattern
 */
export async function updatePattern(req, res) {
    try {
        const { id } = req.params;
        const { casilla, concepto, seccion, regex_pattern, grupo_valor, formato_origen, prioridad, activo } = req.body;

        // Si se envía regex, validarlo
        if (regex_pattern) {
            try {
                new RegExp(regex_pattern, 'gmi');
            } catch (e) {
                return res.status(400).json({ error: `Regex inválido: ${e.message}` });
            }
        }

        const [updated] = await sql`
            UPDATE fiscal_casilla_patterns_180
            SET
                casilla = COALESCE(${casilla || null}, casilla),
                concepto = COALESCE(${concepto || null}, concepto),
                seccion = COALESCE(${seccion || null}, seccion),
                regex_pattern = COALESCE(${regex_pattern || null}, regex_pattern),
                grupo_valor = COALESCE(${grupo_valor || null}, grupo_valor),
                formato_origen = COALESCE(${formato_origen || null}, formato_origen),
                prioridad = COALESCE(${prioridad || null}, prioridad),
                activo = CASE WHEN ${activo !== undefined} THEN ${activo} ELSE activo END,
                updated_at = NOW()
            WHERE id = ${id}
            RETURNING *
        `;

        if (!updated) {
            return res.status(404).json({ error: "Pattern no encontrado" });
        }

        FiscalRules.invalidateCache();

        res.json({ message: "Pattern actualizado", pattern: updated });
    } catch (err) {
        console.error("Error updatePattern:", err);
        res.status(500).json({ error: "Error al actualizar pattern" });
    }
}

/**
 * DELETE /admin/fiscal/reglas/patterns/:id
 * Desactivar un pattern (soft delete)
 */
export async function deletePattern(req, res) {
    try {
        const { id } = req.params;

        const [updated] = await sql`
            UPDATE fiscal_casilla_patterns_180
            SET activo = false, updated_at = NOW()
            WHERE id = ${id}
            RETURNING casilla, concepto
        `;

        if (!updated) {
            return res.status(404).json({ error: "Pattern no encontrado" });
        }

        FiscalRules.invalidateCache();

        res.json({ message: "Pattern desactivado", pattern: updated });
    } catch (err) {
        console.error("Error deletePattern:", err);
        res.status(500).json({ error: "Error al desactivar pattern" });
    }
}

/**
 * POST /admin/fiscal/reglas/patterns/:id/reset-stats
 * Resetear estadísticas de aciertos/fallos de un pattern
 */
export async function resetPatternStats(req, res) {
    try {
        const { id } = req.params;

        const [updated] = await sql`
            UPDATE fiscal_casilla_patterns_180
            SET aciertos = 0, fallos = 0, updated_at = NOW()
            WHERE id = ${id}
            RETURNING casilla, concepto
        `;

        if (!updated) {
            return res.status(404).json({ error: "Pattern no encontrado" });
        }

        res.json({ message: "Estadísticas reseteadas", pattern: updated });
    } catch (err) {
        console.error("Error resetPatternStats:", err);
        res.status(500).json({ error: "Error al resetear estadísticas" });
    }
}

// ============================================================
// UTILIDADES
// ============================================================

/**
 * POST /admin/fiscal/reglas/invalidar-cache
 * Invalidar caché de reglas fiscales
 */
export async function invalidarCache(req, res) {
    try {
        const { ejercicio } = req.body;
        FiscalRules.invalidateCache(ejercicio ? parseInt(ejercicio) : null);

        res.json({
            message: ejercicio
                ? `Caché invalidada para ejercicio ${ejercicio}`
                : "Toda la caché de reglas fiscales invalidada"
        });
    } catch (err) {
        console.error("Error invalidarCache:", err);
        res.status(500).json({ error: "Error al invalidar caché" });
    }
}

/**
 * POST /admin/fiscal/reglas/test-pattern
 * Probar un regex pattern contra un texto de ejemplo
 */
export async function testPattern(req, res) {
    try {
        const { regex_pattern, texto, grupo_valor } = req.body;

        if (!regex_pattern || !texto) {
            return res.status(400).json({ error: "Campos requeridos: regex_pattern, texto" });
        }

        // Validar regex
        let regex;
        try {
            regex = new RegExp(regex_pattern, 'gmi');
        } catch (e) {
            return res.status(400).json({ error: `Regex inválido: ${e.message}` });
        }

        const grupo = grupo_valor || 1;
        const matches = [];
        let match;
        let count = 0;

        while ((match = regex.exec(texto)) !== null && count < 20) {
            matches.push({
                fullMatch: match[0],
                groups: match.slice(1),
                valorExtraido: match[grupo] || null,
                index: match.index
            });
            count++;
        }

        res.json({
            regex_pattern,
            totalMatches: matches.length,
            matches,
            valorPrincipal: matches.length > 0 ? matches[0].valorExtraido : null
        });
    } catch (err) {
        console.error("Error testPattern:", err);
        res.status(500).json({ error: "Error al probar pattern" });
    }
}
