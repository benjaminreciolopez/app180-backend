import { sql } from "../db.js";

async function getEmpresaIdAdminOrThrow(userId) {
  const r =
    await sql`select id from empresa_180 where user_id=${userId} limit 1`;
  const empresaId = r[0]?.id ?? null;
  if (!empresaId) {
    const err = new Error("Empresa no asociada al usuario");
    err.status = 403;
    throw err;
  }
  return empresaId;
}

export async function listarImportaciones(req, res) {
  try {
    const userId = req.user?.id;
    const empresaId = await getEmpresaIdAdminOrThrow(userId);

    const rows = await sql`
      select
        i.id,
        i.created_at,
        i.origen,
        i.stats,
        i.reverted_at,
        u.nombre as creado_por_nombre
      from calendario_importacion_180 i
      left join users_180 u on u.id = i.creado_por
      where i.empresa_id = ${empresaId}
      order by i.created_at desc
      limit 200
    `;

    return res.json({ ok: true, importaciones: rows });
  } catch (e) {
    console.error("[importaciones/listar] error:", e);
    return res
      .status(e.status || 500)
      .json({ error: e.message || "Error listando importaciones" });
  }
}

export async function getImportacionDetalle(req, res) {
  try {
    const userId = req.user?.id;
    const empresaId = await getEmpresaIdAdminOrThrow(userId);
    const id = req.params.id;

    const head = await sql`
      select *
      from calendario_importacion_180
      where id=${id} and empresa_id=${empresaId}
      limit 1
    `;
    if (!head[0])
      return res.status(404).json({ error: "Importación no encontrada" });

    const items = await sql`
      select fecha, tipo, nombre, descripcion, es_laborable, label, activo, origen
      from calendario_importacion_item_180
      where importacion_id=${id} and empresa_id=${empresaId}
      order by fecha asc
    `;

    return res.json({ ok: true, importacion: head[0], items });
  } catch (e) {
    console.error("[importaciones/detalle] error:", e);
    return res
      .status(e.status || 500)
      .json({ error: e.message || "Error detalle importación" });
  }
}

export async function deshacerImportacion(req, res) {
  try {
    const userId = req.user?.id;
    const empresaId = await getEmpresaIdAdminOrThrow(userId);
    const id = req.params.id;

    const head = await sql`
      select id, reverted_at
      from calendario_importacion_180
      where id=${id} and empresa_id=${empresaId}
      limit 1
    `;
    if (!head[0])
      return res.status(404).json({ error: "Importación no encontrada" });
    if (head[0].reverted_at)
      return res.status(409).json({ error: "La importación ya fue deshecha" });

    // Rollback A: desactivar SOLO lo que esa importación haya dejado actualmente aplicado
    const result = await sql.begin(async (tx) => {
      const r1 = await tx`
        update calendario_empresa_180
        set activo = false,
            updated_at = now()
        where empresa_id = ${empresaId}
          and importacion_id = ${id}
      `;

      await tx`
        update calendario_importacion_180
        set reverted_at = now(),
            revertido_por = ${userId}
        where id = ${id}
          and empresa_id = ${empresaId}
      `;

      return { affected: r1.count ?? 0 };
    });

    return res.json({ ok: true, desactivados: result.affected });
  } catch (e) {
    console.error("[importaciones/deshacer] error:", e);
    return res
      .status(e.status || 500)
      .json({ error: e.message || "Error deshacer importación" });
  }
}

export async function compararImportaciones(req, res) {
  try {
    const userId = req.user?.id;
    const empresaId = await getEmpresaIdAdminOrThrow(userId);

    const a = req.query.a;
    const b = req.query.b;
    if (!a || !b)
      return res.status(400).json({ error: "Faltan parámetros a y b" });

    // Cargamos snapshots (inmutables)
    const [A, B] = await Promise.all([
      sql`
        select fecha, tipo, nombre, descripcion, es_laborable, label, activo, origen
        from calendario_importacion_item_180
        where empresa_id=${empresaId} and importacion_id=${a}
      `,
      sql`
        select fecha, tipo, nombre, descripcion, es_laborable, label, activo, origen
        from calendario_importacion_item_180
        where empresa_id=${empresaId} and importacion_id=${b}
      `,
    ]);

    const mapA = new Map(A.map((x) => [String(x.fecha), x]));
    const mapB = new Map(B.map((x) => [String(x.fecha), x]));
    const allDates = Array.from(
      new Set([...mapA.keys(), ...mapB.keys()]),
    ).sort();

    function normalizeItem(x) {
      if (!x) return null;
      return {
        fecha: String(x.fecha),
        tipo: x.tipo,
        label: x.label ?? null,
        descripcion: x.descripcion ?? null,
        es_laborable: !!x.es_laborable,
        activo: x.activo !== false,
        origen: x.origen ?? "ocr",
      };
    }

    function isSame(x, y) {
      if (!x && !y) return true;
      if (!x || !y) return false;
      return (
        x.tipo === y.tipo &&
        x.label === y.label &&
        x.descripcion === y.descripcion &&
        x.es_laborable === y.es_laborable &&
        x.activo === y.activo
      );
    }

    const rows = allDates.map((d) => {
      const ia = normalizeItem(mapA.get(d));
      const ib = normalizeItem(mapB.get(d));

      let status = "igual";
      if (!ia && ib) status = "añadido";
      else if (ia && !ib) status = "eliminado";
      else if (!isSame(ia, ib)) status = "modificado";

      return { fecha: d, status, a: ia, b: ib };
    });

    // Comparar modo B: devolvemos todo, pero marcamos los cambios
    return res.json({ ok: true, rows });
  } catch (e) {
    console.error("[importaciones/compare] error:", e);
    return res
      .status(e.status || 500)
      .json({ error: e.message || "Error comparar importaciones" });
  }
}
