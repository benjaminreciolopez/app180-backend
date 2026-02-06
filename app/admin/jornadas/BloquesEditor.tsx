"use client";

import { useMemo } from "react";
import type { Bloque } from "./types";

function cmpTime(a: string, b: string) {
  return a.localeCompare(b);
}

function addMinutes(time: string, minutes: number) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.min(23, Math.floor(total / 60));
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}:00`;
}

function normalizeTime(t: string) {
  return t.length === 5 ? `${t}:00` : t;
}

function validate(bloques: Bloque[]) {
  const errs: string[] = [];
  const sorted = [...bloques].sort((x, y) =>
    cmpTime(x.hora_inicio, y.hora_inicio)
  );

  if (sorted.length === 0) {
    errs.push("Debe existir al menos un bloque");
    return { errs, sorted };
  }

  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];

    if (!b.tipo) errs.push(`Bloque ${i + 1}: tipo obligatorio`);
    if (!b.hora_inicio || !b.hora_fin)
      errs.push(`Bloque ${i + 1}: horas obligatorias`);

    if (
      b.hora_inicio &&
      b.hora_fin &&
      cmpTime(b.hora_inicio, b.hora_fin) >= 0
    ) {
      errs.push(`Bloque ${i + 1}: hora_fin debe ser posterior a hora_inicio`);
    }

    if (i > 0) {
      const prev = sorted[i - 1];

      // solape
      if (cmpTime(prev.hora_fin, b.hora_inicio) > 0) {
        errs.push(`Bloque ${i + 1}: solapa con el anterior`);
      }

      // contigüidad estricta
      if (cmpTime(prev.hora_fin, b.hora_inicio) !== 0) {
        errs.push(
          `Bloque ${i + 1}: debe empezar exactamente a ${prev.hora_fin}`
        );
      }
    }
  }

  return { errs, sorted };
}

export default function BloquesEditor({
  title,
  bloques,
  onChange,
  onSave,
  rangoInicio,
  rangoFin,
  clientes = [],
}: {
  title: string;
  bloques: Bloque[];
  onChange: (b: Bloque[]) => void;
  onSave: () => void;
  rangoInicio?: string;
  rangoFin?: string;
  clientes?: { id: string; nombre: string }[];
}) {
  const { errs, sorted } = useMemo(() => validate(bloques), [bloques]);

  function add() {
    if (bloques.length === 0) {
      // Default al inicio del rango (si existe), sino 08:00
      const start = rangoInicio ? normalizeTime(rangoInicio) : "08:00:00";
      
      // Intentar 60 min (petición usuario), pero clipear con fin de rango
      let end = addMinutes(start.slice(0, 5), 60);

      if (rangoFin) {
        const rf = normalizeTime(rangoFin);
        // Si start + 60 > rangoFin => usar rangoFin
        if (cmpTime(end, rf) > 0) {
            end = rf;
        }
      }

      onChange([
        {
          tipo: "trabajo",
          hora_inicio: start,
          hora_fin: end,
          obligatorio: true,
        },
      ]);
      return;
    }

    const last = sorted[sorted.length - 1];
    const start = last.hora_fin;
    
    // Default 1 hora
    let end = addMinutes(start.slice(0, 5), 60);

    // Clamping con fin de rango
    if (rangoFin) {
        const rf = normalizeTime(rangoFin);
        if (cmpTime(end, rf) > 0) {
            end = rf;
        }
        // Seguridad: si start >= rangoFin, bloque de 0 min o no añadir?
        // Dejamos que el usuario decida o ponemos 0 min, pero aquí ponemos rf
        if (cmpTime(start, rf) >= 0) {
            end = start; // Bloque inválido visualmente pero no rompe
        }
    }

    onChange([
      ...sorted,
      {
        tipo: "trabajo",
        hora_inicio: start,
        hora_fin: end,
        obligatorio: true,
      },
    ]);
  }

  function update(i: number, patch: Partial<Bloque>) {
    const next = sorted.map((b, idx) => (idx === i ? { ...b, ...patch } : b));

    // Normalizar formato
    next.forEach((b) => {
      if (b.hora_inicio) b.hora_inicio = normalizeTime(b.hora_inicio);
      if (b.hora_fin) b.hora_fin = normalizeTime(b.hora_fin);
    });

    // Forzar contigüidad
    for (let j = 1; j < next.length; j++) {
      next[j].hora_inicio = next[j - 1].hora_fin;
    }

    onChange(next);
  }

  function del(i: number) {
    const next = sorted.filter((_, idx) => idx !== i);

    // Reajustar contigüidad
    for (let j = 1; j < next.length; j++) {
      next[j].hora_inicio = next[j - 1].hora_fin;
    }

    onChange(next);
  }

  function sort() {
    onChange(sorted);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="font-semibold">{title}</div>
        <div className="flex gap-2">
          <button className="px-3 py-2 rounded bg-gray-200" onClick={sort}>
            Ordenar
          </button>
          <button
            className="px-3 py-2 rounded bg-green-600 text-white"
            onClick={add}
          >
            + Bloque
          </button>
          <button
            className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
            disabled={errs.length > 0}
            onClick={onSave}
          >
            Guardar
          </button>
        </div>
      </div>

      {errs.length > 0 && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded text-sm">
          <div className="font-semibold mb-1">Revisa antes de guardar:</div>
          <ul className="list-disc ml-5">
            {errs.map((e, idx) => (
              <li key={idx}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        {sorted.map((b, i) => (
          <div
            key={i}
            className="grid grid-cols-1 md:grid-cols-[140px_160px_100px_100px_100px_80px] gap-2 items-end border rounded p-3"
          >
            <div>
              <label className="text-xs text-gray-600">Tipo</label>
              <select
                className="border p-2 rounded w-full text-sm"
                value={b.tipo}
                onChange={(e) => update(i, { tipo: e.target.value })}
              >
                <option value="trabajo">trabajo</option>
                <option value="descanso">descanso</option>
                <option value="pausa">pausa</option>
                <option value="comida">comida</option>
                <option value="otro">otro</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-600">Sede / Cliente</label>
              <select
                className="border p-2 rounded w-full text-sm"
                value={b.cliente_id || ""}
                onChange={(e) => update(i, { cliente_id: e.target.value || null })}
              >
                <option value="">(Asignación general)</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-600">Inicio</label>
              <input
                type="time"
                className="border p-2 rounded w-full bg-gray-100"
                disabled={i !== 0}
                value={(b.hora_inicio || "").slice(0, 5)}
                onChange={(e) =>
                  update(i, { hora_inicio: `${e.target.value}:00` })
                }
              />
            </div>

            <div>
              <label className="text-xs text-gray-600">Fin</label>
              <input
                type="time"
                className="border p-2 rounded w-full"
                value={(b.hora_fin || "").slice(0, 5)}
                onChange={(e) =>
                  update(i, { hora_fin: `${e.target.value}:00` })
                }
              />
            </div>

            <div>
              <label className="text-xs text-gray-600">Obligatorio</label>
              <select
                className="border p-2 rounded w-full"
                value={b.obligatorio ? "1" : "0"}
                onChange={(e) =>
                  update(i, { obligatorio: e.target.value === "1" })
                }
              >
                <option value="1">Sí</option>
                <option value="0">No</option>
              </select>
            </div>

            <div className="flex justify-end">
              <button
                className="px-3 py-2 rounded bg-red-600 text-white"
                onClick={() => del(i)}
              >
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
