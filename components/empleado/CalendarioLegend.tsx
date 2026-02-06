"use client";

import { COLOR_MAP } from "./calendarioColors";

function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

export default function CalendarioLegend() {
  return (
    <div className="legend-horizontal text-xs text-gray-700 flex flex-wrap gap-x-4 gap-y-2">
      <span className="legend-item inline-flex items-center gap-2">
        <Dot color={COLOR_MAP.vacaciones} /> Vacaciones
      </span>
      <span className="legend-item inline-flex items-center gap-2">
        <Dot color={COLOR_MAP.baja_medica} /> Baja médica
      </span>
      <span className="legend-item inline-flex items-center gap-2">
        <Dot color={COLOR_MAP.festivo_nacional} /> Festivo
      </span>
      <span className="legend-item inline-flex items-center gap-2">
        <Dot color={COLOR_MAP.convenio} /> Convenio
      </span>
      <span className="legend-item inline-flex items-center gap-2">
        <Dot color={COLOR_MAP.cierre_empresa} /> Cierre empresa
      </span>
    </div>
  );
}
