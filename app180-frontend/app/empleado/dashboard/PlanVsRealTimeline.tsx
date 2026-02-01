"use client";

import React, { useMemo } from "react";

type PlanBloque = {
  tipo: string;
  inicio: string; // "HH:MM:SS"
  fin: string; // "HH:MM:SS"
  obligatorio?: boolean;
};

type RealBloque = {
  tipo: "trabajo" | "descanso";
  inicio: string; // ISO
  fin: string; // ISO
  minutos?: number;
};
function minToHHMM(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function hhmmssToMin(v?: string | null) {
  if (!v) return null;
  const s = String(v).slice(0, 8);
  const [hh, mm, ss] = s.split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm + (Number.isFinite(ss) ? ss / 60 : 0);
}

function isoToMin(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function normTipo(tipo: string) {
  const t = String(tipo || "").toLowerCase();
  if (t.includes("descanso")) return "descanso";
  if (t.includes("trab")) return "trabajo";
  if (t.includes("comida")) return "descanso";
  if (t.includes("pausa")) return "descanso";
  return "otro";
}

function barClass(tipo: string) {
  const t = normTipo(tipo);
  if (t === "trabajo") return "bg-green-200 border-green-300";
  if (t === "descanso") return "bg-blue-200 border-blue-300";
  return "bg-gray-200 border-gray-300";
}

function barClassReal(tipo: string) {
  if (tipo === "trabajo") return "bg-green-500/30 border-green-400";
  return "bg-blue-500/30 border-blue-400";
}

export default function PlanVsRealTimeline({
  rango,
  planBloques,
  realBloques,
}: {
  rango: { inicio: string; fin: string } | null | undefined;
  planBloques: PlanBloque[];
  realBloques: RealBloque[];
}) {
  const rIni = hhmmssToMin(rango?.inicio || null);
  const rFin = hhmmssToMin(rango?.fin || null);

  const domain = useMemo(() => {
    // Si no hay rango, inferimos por plan o real.
    const mins: number[] = [];

    if (rIni != null) mins.push(rIni);
    if (rFin != null) mins.push(rFin);

    for (const b of planBloques || []) {
      const a = hhmmssToMin(b.inicio);
      const z = hhmmssToMin(b.fin);
      if (a != null) mins.push(a);
      if (z != null) mins.push(z);
    }

    for (const b of realBloques || []) {
      const a = isoToMin(b.inicio);
      const z = isoToMin(b.fin);
      if (a != null) mins.push(a);
      if (z != null) mins.push(z);
    }

    if (mins.length === 0) return { start: 8 * 60, end: 18 * 60 }; // fallback
    const start = Math.floor(Math.min(...mins) / 15) * 15;
    const end = Math.ceil(Math.max(...mins) / 15) * 15;
    // mínimo 2h para que no quede ridículo
    if (end - start < 120) return { start, end: start + 120 };
    return { start, end };
  }, [rIni, rFin, planBloques, realBloques]);

  function leftPct(min: number) {
    const p = ((min - domain.start) / (domain.end - domain.start)) * 100;
    return clamp(p, 0, 100);
  }

  function widthPct(a: number, b: number) {
    const w = ((b - a) / (domain.end - domain.start)) * 100;
    return clamp(w, 0, 100);
  }

  // marcas cada hora
  const ticks = useMemo(() => {
    const out: { min: number; label: string }[] = [];
    const startH = Math.ceil(domain.start / 60);
    const endH = Math.floor(domain.end / 60);
    for (let h = startH; h <= endH; h++) {
      const min = h * 60;
      out.push({ min, label: `${String(h).padStart(2, "0")}:00` });
    }
    return out;
  }, [domain.start, domain.end]);

  const planSegs = useMemo(() => {
    return (planBloques || [])
      .map((b) => {
        const a = hhmmssToMin(b.inicio);
        const z = hhmmssToMin(b.fin);
        if (a == null || z == null || z <= a) return null;
        return { tipo: b.tipo, a, z };
      })
      .filter(Boolean) as { tipo: string; a: number; z: number }[];
  }, [planBloques]);

  const realSegs = useMemo(() => {
    return (realBloques || [])
      .map((b) => {
        const a = isoToMin(b.inicio);
        const z = isoToMin(b.fin);
        if (a == null || z == null || z <= a) return null;
        return { tipo: b.tipo, a, z };
      })
      .filter(Boolean) as {
      tipo: "trabajo" | "descanso";
      a: number;
      z: number;
    }[];
  }, [realBloques]);

  if (!planSegs.length && !realSegs.length) {
    return (
      <div className="text-sm text-gray-500">
        No hay datos suficientes para la línea temporal.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ticks */}
      <div className="relative h-6">
        {ticks.map((t) => (
          <div
            key={t.min}
            className="absolute top-0 text-[11px] text-gray-500"
            style={{
              left: `${leftPct(t.min)}%`,
              transform: "translateX(-50%)",
            }}
          >
            {t.label}
          </div>
        ))}
      </div>

      {/* plan */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-gray-600">Plan</div>
        <div className="relative h-8 border rounded bg-gray-50 overflow-hidden">
          {planSegs.map((s, idx) => (
            <div
              key={`${s.tipo}-${idx}`}
              className={`absolute top-1 bottom-1 border rounded ${barClass(
                s.tipo,
              )}`}
              style={{
                left: `${leftPct(s.a)}%`,
                width: `${widthPct(s.a, s.z)}%`,
              }}
              title={`${normTipo(s.tipo)} ${minToHHMM(s.a)}–${minToHHMM(s.z)}`}
            />
          ))}
        </div>
      </div>

      {/* real */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-gray-600">Real</div>
        <div className="relative h-8 border rounded bg-white overflow-hidden">
          {realSegs.map((s, idx) => (
            <div
              key={`${s.tipo}-${idx}`}
              className={`absolute top-1 bottom-1 border rounded ${barClassReal(
                s.tipo,
              )}`}
              style={{
                left: `${leftPct(s.a)}%`,
                width: `${widthPct(s.a, s.z)}%`,
              }}
              title={`${s.tipo} ${minToHHMM(s.a)}–${minToHHMM(s.z)}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
