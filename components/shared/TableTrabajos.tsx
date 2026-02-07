"use client";

import { useState, useMemo, useEffect } from "react";
import { ArrowDown, ArrowUp, Search, Edit, Trash2, Copy, Info } from "lucide-react";

export type WorkLogItem = {
  id: string;
  fecha: string;
  minutos: number | null;
  precio: number | null;
  descripcion: string;
  empleado_nombre?: string;
  empleado_id?: string;
  cliente_nombre?: string | null;
  work_item_nombre?: string | null;
  
  // Payment fields
  valor?: number | null;
  pagado?: number | null;
  estado_pago?: 'pendiente' | 'parcial' | 'pagado';

  // Mixed billing
  tipo_facturacion?: 'hora' | 'dia' | 'mes' | 'valorado';
  duracion_texto?: string | null;
  factura_id?: number | null;
  detalles?: string | null;
};

type ColKey =
  | "fecha"
  | "empleado_nombre"
  | "cliente_nombre"
  | "work_item_nombre"
  | "minutos"
  | "valor"
  | "estado_pago"
  | "descripcion";

type Props = {
  items: WorkLogItem[];
  isAdmin?: boolean;
  onEdit?: (item: WorkLogItem) => void;
  onDelete?: (id: string) => void;
  onClone?: (item: WorkLogItem) => void;
};

// Utils para formato
function formatDuracion(item: WorkLogItem) {
  if (item.tipo_facturacion === 'valorado') {
      return item.duracion_texto || '—';
  }
  
  const m = item.minutos;
  if (m == null) return "—";

  if (item.tipo_facturacion === 'dia') {
      // 8h = 480m = 1 dia
      const dias = m / 480;
      const val = Number(dias.toFixed(2));
      return `${val} ${val === 1 ? 'día' : 'días'}`;
  }

  if (item.tipo_facturacion === 'mes') {
      // 160h = 9600m = 1 mes (aprox standard laboral)
      const meses = m / 9600;
      const val = Number(meses.toFixed(2));
      return `${val} ${val === 1 ? 'mes' : 'meses'}`;
  }

  // Default horas
  const horas = m / 60;
  return `${Number(horas.toFixed(2))} h`;
}

export default function TableTrabajos({ 
  items, 
  isAdmin = false,
  onEdit,
  onDelete,
  onClone
}: Props) {
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<ColKey>("fecha");
  const [sortAsc, setSortAsc] = useState(false); // default desc (mas reciente primero)

  // Cargar preferencia orden de localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("trabajos-sort");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.col) setSortCol(parsed.col);
        if (typeof parsed.asc === "boolean") setSortAsc(parsed.asc);
      }
    } catch {}
  }, []);

  // Escape to clear search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSearch("");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Guardar preferencia
  function handleSort(col: ColKey) {
    let newAsc = true;
    if (sortCol === col) {
      newAsc = !sortAsc;
    } else {
      newAsc = true; // resets to asc when changing col? or default desc? let's standard asc
      if (col === "fecha") newAsc = false; // fecha mejor desc por defecto
    }

    setSortCol(col);
    setSortAsc(newAsc);
    localStorage.setItem(
      "trabajos-sort",
      JSON.stringify({ col, asc: newAsc })
    );
  }

  // Filtrado y ordenado
  const processed = useMemo(() => {
    let res = [...items];

    // 1. Filtrar global search
    if (search.trim()) {
      const q = search.toLowerCase();
      res = res.filter((it) => {
        const match = [
          it.descripcion,
          it.empleado_nombre,
          it.cliente_nombre,
          it.work_item_nombre,
          it.fecha,
        ]
          .filter(Boolean)
          .some((val) => String(val).toLowerCase().includes(q));

        return match;
      });
    }

    // 2. Ordenar
    res.sort((a, b) => {
      let valA = a[sortCol];
      let valB = b[sortCol];

      // Caso especial minutos (nulls al final)
      if (sortCol === "minutos") {
        valA = a.minutos ?? -1;
        valB = b.minutos ?? -1;
      }

      // Strings
      if (typeof valA === "string" && typeof valB === "string") {
        return sortAsc
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      }

      // Números
      if (valA! < valB!) return sortAsc ? -1 : 1;
      if (valA! > valB!) return sortAsc ? 1 : -1;
      return 0;
    });

    return res;
  }, [items, search, sortCol, sortAsc]);

  // Render header helper
  function Th({ label, col }: { label: string; col: ColKey }) {
    const active = sortCol === col;
    return (
      <th
        className="p-3 text-left cursor-pointer hover:bg-gray-200 transition-colors select-none"
        onClick={() => handleSort(col)}
      >
        <div className="flex items-center gap-1">
          {label}
          {active &&
            (sortAsc ? <ArrowUp size={14} /> : <ArrowDown size={14} />)}
        </div>
      </th>
    );
  }

  // Totales de la selección actual
  // OJO: Totalizar minutos mixtos (hora/dia/mes) puede ser confuso. 
  // Mostramos horas totales como conversión base para tener una referencia.
  const totalMin = processed.reduce((acc, curr) => acc + (curr.minutos || 0), 0);
  const totalHoras = (totalMin / 60).toFixed(2);

  return (
    <div className="space-y-3">
      {/* Buscador y Resumen */}
      <div className="flex flex-col sm:flex-row gap-3 justify-between items-end sm:items-center">
        <div className="relative w-full sm:w-64">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <Search size={16} />
          </div>
          <input
            type="text"
            className="border rounded-full pl-9 pr-4 py-2 w-full text-sm"
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="text-sm text-gray-600 font-medium">
          {processed.length} registros | Total eq:{" "}
          <span className="text-black font-bold">{totalHoras} h</span>
        </div>
      </div>

      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b">
              <tr>
                <Th label="Fecha" col="fecha" />
                {isAdmin && <Th label="Empleado" col="empleado_nombre" />}
                <Th label="Cliente" col="cliente_nombre" />
                <Th label="Duración" col="minutos" />
                <Th label="Valor" col="valor" />
                <Th label="Estado" col="estado_pago" />
                <Th label="Descripción" col="descripcion" />
                <th className="p-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {processed.length === 0 ? (
                <tr>
                  <td className="p-8 text-center text-gray-500" colSpan={isAdmin ? 8 : 7}> {/* Updated colspan */}
                    No hay resultados
                  </td>
                </tr>
              ) : (
                processed.map((it) => (
                  <tr key={it.id} className="hover:bg-gray-50">
                    <td className="p-3 whitespace-nowrap">
                      {new Date(it.fecha).toLocaleDateString("es-ES")}
                    </td>
                    {isAdmin && (
                      <td className="p-3 font-medium">
                        {it.empleado_nombre}
                      </td>
                    )}
                      <td className="p-3">
                        {it.cliente_nombre ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                            {it.cliente_nombre}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="p-3 font-mono font-medium whitespace-nowrap">
                      {formatDuracion(it)}
                    </td>
                    <td className="p-3 font-mono text-xs">
                        {it.valor ? `${Number(it.valor).toFixed(2)}€` : '—'}
                    </td>
                    <td className="p-3">
                        {it.valor ? (
                             <span className={`px-2 py-1 rounded text-xs capitalize 
                                ${it.estado_pago === 'pagado' ? 'bg-green-100 text-green-800' : 
                                  it.estado_pago === 'parcial' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                                {it.estado_pago || 'pendiente'}
                             </span>
                        ) : (
                            <span className="text-gray-300 text-xs">—</span>
                        )}
                    </td>
                     <td className="p-3 max-w-md truncate text-gray-600" title={it.descripcion + (it.detalles ? "\n\nDetalles:\n" + it.detalles : "")}>
                        <div className="flex items-center gap-1">
                          {it.descripcion}
                          {it.detalles && (
                            <Info size={14} className="text-blue-400 shrink-0" />
                          )}
                        </div>
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <button 
                          onClick={() => onClone?.(it)}
                          title="Clonar Trabajo"
                          className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <Copy size={16} />
                        </button>
                        <button 
                          onClick={() => onEdit?.(it)}
                          title="Editar"
                          className="p-1.5 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        >
                          <Edit size={16} />
                        </button>
                        <button 
                          onClick={() => {
                            if (confirm("¿Seguro que deseas eliminar este trabajo?")) {
                              onDelete?.(it.id);
                            }
                          }}
                          disabled={it.pagado != null && it.pagado > 0}
                          title={it.pagado != null && it.pagado > 0 ? "No se puede eliminar un trabajo pagado" : "Eliminar"}
                          className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
