// app180-frontend/app/empleado/trabajos/page.tsx
"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import TableTrabajos, { WorkLogItem } from "@/components/shared/TableTrabajos";
import FormTrabajos from "@/components/shared/FormTrabajos";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

function ymd(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function EmpleadoTrabajosPage() {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  
  const [items, setItems] = useState<WorkLogItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Catalogos
  const [clientes, setClientes] = useState<any[]>([]);

  async function loadData() {
    setLoading(true);
    try {
      const params: any = {};
      if (desde) params.desde = desde;
      if (hasta) params.hasta = hasta;
      
      const res = await api.get("/worklogs/mis", { params });
      setItems(Array.isArray(res.data) ? res.data : []);
    } finally {
      setLoading(false);
    }
  }

  async function loadCatalogos() {
    try {
      const results = await Promise.allSettled([
        api.get("/empleado/clientes"),
      ]);
      const [cRes] = results;
      
      setClientes(cRes.status === 'fulfilled' && Array.isArray(cRes.value.data) ? cRes.value.data : []);
    } catch {
      setClientes([]);
    }
  }

  useEffect(() => {
    loadCatalogos();
  }, []);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta]);

  return (
    <div className="app-main space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Mis Trabajos</h1>
          <p className="text-gray-500 text-sm">
            Registra tu actividad diaria
          </p>
        </div>

        <div className="flex gap-2 bg-gray-50 p-1 rounded-lg border">
          <input
            type="date"
            className="bg-transparent text-sm px-2 outline-none"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
          <span className="text-gray-400">→</span>
          <input
            type="date"
            className="bg-transparent text-sm px-2 outline-none"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
          {(desde || hasta) && (
            <button 
              onClick={() => { setDesde(""); setHasta(""); }}
              className="px-2 text-gray-400 hover:text-red-500 font-bold"
            >
              ✕
            </button>
          )}
           <button 
             onClick={loadData}
             className="px-3 py-1 bg-white border rounded text-xs font-medium shadow-sm active:translate-y-0.5"
           >
             Filtrar
           </button>
        </div>
      </div>

      {/* Formulario siempre visible para empleados */}
      <FormTrabajos
        isAdmin={false}
        clientes={clientes}
        onCreated={loadData}
      />

      {/* Tabla */}
      {loading ? (
        <div className="py-10">
            <LoadingSpinner />
        </div>
      ) : (
        <TableTrabajos items={items} isAdmin={false} />
      )}
    </div>
  );
}
