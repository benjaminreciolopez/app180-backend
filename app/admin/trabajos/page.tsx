// app180-frontend/app/admin/trabajos/page.tsx
"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import { getUser } from "@/services/auth";
import TableTrabajos, { WorkLogItem } from "@/components/shared/TableTrabajos";
import FormTrabajos from "@/components/shared/FormTrabajos";
import { Plus, X } from "lucide-react";
import { UniversalExportButton } from "@/components/shared/UniversalExportButton";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";


export default function AdminTrabajosPage() {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const [items, setItems] = useState<WorkLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Catalogos
  const [empleados, setEmpleados] = useState<any[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);

  // UI State
  const [showForm, setShowForm] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      // Si fechas vacías, enviamos undefined o strings vacios. 
      // El backend debe soportarlo (requerirá ajuste si por defecto filtra hoy)
      const params: any = {};
      if (desde) params.desde = desde;
      if (hasta) params.hasta = hasta;

      const res = await api.get("/worklogs/admin", { params });
      setItems(Array.isArray(res.data?.items) ? res.data.items : []);
    } finally {
      setLoading(false);
    }
  }

  async function loadCatalogos() {
    try {
      // Verificar si módulo empleados está activo
      let fetchEmpleados = Promise.resolve({ data: [] } as any);
      try {
        // 🆕 Usar helper
        const user = getUser() || {};
        // Si no existe modulos, asumimos true (legacy). Si es false explícito, no cargamos.
        if (user.modulos?.empleados !== false) {
          fetchEmpleados = api.get("/employees");
        }
      } catch {}

      const results = await Promise.allSettled([
        fetchEmpleados,
        api.get("/admin/clientes"), 
      ]);

      const [eRes, cRes] = results;

      // Si falla empleados (ej 403 aunque lo intentamos evitar, o 500), ponemos array vacío sin error
      if (eRes.status === 'fulfilled' && Array.isArray(eRes.value.data)) {
        setEmpleados(eRes.value.data);
      } else {
        setEmpleados([]);
      }

      // Clientes
      if (cRes.status === 'fulfilled' && Array.isArray(cRes.value.data)) {
        setClientes(cRes.value.data);
      } else {
        setClientes([]);
      }
    } catch (err) {
      console.error("Error cargando catálogos", err);
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
          <h1 className="text-2xl font-bold">Gestión de Trabajos</h1>
          <p className="text-gray-500 text-sm">
            Registro y control de tiempos por cliente y empleado
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
            <UniversalExportButton 
                module="trabajos" 
                queryParams={{ desde, hasta }} 
                label="Exportar"
            />
           <div className="flex items-center gap-2 bg-white border rounded-lg p-1 px-2">
            <span className="text-xs text-gray-500 font-medium">Desde</span>
            <input
              type="date"
              className="text-sm outline-none bg-transparent"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 bg-white border rounded-lg p-1 px-2">
            <span className="text-xs text-gray-500 font-medium">Hasta</span>
             <input
              type="date"
              className="text-sm outline-none bg-transparent"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </div>
          
          {(desde || hasta) && (
            <button 
              onClick={() => { setDesde(""); setHasta(""); }}
              className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-200"
            >
              x
            </button>
          )}
          
          <button 
            onClick={() => setShowForm(!showForm)}
            className={`btn px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${showForm ? 'bg-gray-100 text-gray-700' : 'bg-black text-white hover:bg-gray-800'}`}
          >
            {showForm ? <><X size={16}/> Cancelar</> : <><Plus size={16}/> Crear Trabajo</>}
          </button>
        </div>
      </div>

      {/* Formulario Creación (Collapsible) */}
      {showForm && (
        <div className="animate-in fade-in slide-in-from-top-4 duration-200">
          <FormTrabajos
            isAdmin={true}
            empleados={empleados}
            clientes={clientes}
            onCreated={() => {
              loadData();
              setShowForm(false);
            }}
          />
        </div>
      )}

      {/* Tabla */}
      {loading ? (
        <div className="py-12">
            <LoadingSpinner />
        </div>
      ) : (
        <TableTrabajos items={items} isAdmin={true} />
      )}
    </div>
  );
}
