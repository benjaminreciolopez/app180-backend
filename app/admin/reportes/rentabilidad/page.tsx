"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import { showSuccess, showError } from "@/lib/toast";
import { UniversalExportButton } from "@/components/shared/UniversalExportButton";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

// Interfaces
interface ReporteItem {
  empleado: {
      id: string;
      nombre: string;
      apellidos: string;
  };
  minutos_plan: number;
  minutos_real: number;
  diferencia: number;
  horas_plan: number;
  horas_real: number;
  estado: "ahorro" | "neutro" | "exceso";
  color: string;
}

export default function ReporteRentabilidadPage() {
  const [loading, setLoading] = useState(false);
  const [reporte, setReporte] = useState<ReporteItem[]>([]);
  
  // Filtros: Por defecto mes actual
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  
  const [desde, setDesde] = useState(firstDay);
  const [hasta, setHasta] = useState(lastDay);
  const [empleadoId, setEmpleadoId] = useState(""); // Filtro opcional

  const loadReporte = async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/reportes/rentabilidad", {
          params: { desde, hasta, empleado_id: empleadoId || undefined }
      });
      setReporte(res.data);
      showSuccess("Reporte actualizado correctamente");
    } catch (err) {
      console.error(err);
      showError("Error al cargar reporte");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReporte();
  }, []); // Carga inicial

  // KPI Totales
  const totalPlan = reporte.reduce((acc, r) => acc + r.horas_plan, 0);
  const totalReal = reporte.reduce((acc, r) => acc + r.horas_real, 0);
  const diffTotal = totalReal - totalPlan;
  const rentabilidadGlobal = totalPlan > 0 ? ((totalPlan - totalReal) / totalPlan) * 100 : 0; // % Ahorro

  return (
    <div className="h-full flex flex-col p-4 bg-background">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
           <h1 className="text-2xl font-bold">Rentabilidad y Presupuesto</h1>
           <p className="text-muted-foreground text-sm">Comparativa de Horas Planificadas (Presupuesto) vs Reales (Ejecutadas)</p>
        </div>

        <div className="flex flex-wrap gap-2 items-end bg-card p-2 rounded shadow-sm border">
            <div>
                <label className="text-xs font-semibold block mb-1">Desde</label>
                <input 
                    type="date" 
                    className="input h-8 text-sm w-36"
                    value={desde}
                    onChange={e => setDesde(e.target.value)}
                />
            </div>
            <div>
                <label className="text-xs font-semibold block mb-1">Hasta</label>
                <input 
                    type="date" 
                    className="input h-8 text-sm w-36"
                    value={hasta}
                    onChange={e => setHasta(e.target.value)}
                />
            </div>
            
            <button 
                className="btn-primary h-8 px-4 text-sm"
                onClick={loadReporte}
                disabled={loading}
            >
                {loading ? 'Generando...' : 'Generar'}
            </button>
            
            <div className="ml-2">
                <UniversalExportButton 
                    module="rentabilidad" 
                    queryParams={{ desde, hasta, empleado_id: empleadoId }} 
                    label="Exportar"
                />
            </div>
        </div>
      </div>

      {/* KPIs Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="card p-4 flex flex-col items-center justify-center text-center">
             <span className="text-xs text-muted-foreground uppercase font-bold">Horas Presupuestadas</span>
             <span className="text-2xl font-mono font-bold text-blue-600">{totalPlan.toFixed(1)}h</span>
          </div>
          <div className="card p-4 flex flex-col items-center justify-center text-center">
             <span className="text-xs text-muted-foreground uppercase font-bold">Horas Ejecutadas</span>
             <span className={`text-2xl font-mono font-bold ${totalReal > totalPlan ? 'text-red-600' : 'text-green-600'}`}>
                 {totalReal.toFixed(1)}h
             </span>
          </div>
          <div className="card p-4 flex flex-col items-center justify-center text-center">
             <span className="text-xs text-muted-foreground uppercase font-bold">Diferencia</span>
             <span className={`text-2xl font-mono font-bold ${diffTotal > 0 ? 'text-red-500' : 'text-green-500'}`}>
                 {diffTotal > 0 ? '+' : ''}{diffTotal.toFixed(1)}h
             </span>
          </div>
          <div className="card p-4 flex flex-col items-center justify-center text-center">
             <span className="text-xs text-muted-foreground uppercase font-bold">Margen Rentabilidad</span>
             <span className={`text-2xl font-bold ${rentabilidadGlobal >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                 {rentabilidadGlobal.toFixed(1)}%
             </span>
             <span className="text-[10px] text-muted-foreground">Positivo = Ahorro</span>
          </div>
      </div>

      <div className="card p-0 flex-1 overflow-auto">
         <table className="table min-w-[800px]">
             <thead className="sticky top-0 bg-card z-10 shadow-sm">
                 <tr>
                     <th>Empleado</th>
                     <th className="text-right">H. Plan</th>
                     <th className="text-right">H. Real</th>
                     <th className="text-right">Variación</th>
                     <th className="text-center">Estado</th>
                 </tr>
             </thead>
             <tbody>
                 {loading ? (
                     <tr>
                        <td colSpan={5} className="text-center p-8">
                            <LoadingSpinner />
                        </td>
                     </tr>
                 ) : reporte.length === 0 ? (
                     <tr><td colSpan={5} className="text-center p-8 text-muted-foreground">No hay datos para este periodo</td></tr>
                 ) : (
                     reporte.map((item, idx) => (
                         <tr key={item.empleado.id || idx} className="hover:bg-muted/50">
                             <td className="font-medium">{item.empleado.nombre} {item.empleado.apellidos}</td>
                             <td className="text-right font-mono text-muted-foreground">{item.horas_plan.toFixed(2)}</td>
                             <td className="text-right font-mono">{item.horas_real.toFixed(2)}</td>
                             <td className="text-right font-mono">
                                 <span className={item.diferencia > 0 ? 'text-red-600 font-bold' : item.diferencia < 0 ? 'text-green-600 font-bold' : 'text-muted-foreground'}>
                                     {item.diferencia > 0 ? '+' : ''}{(item.diferencia / 60).toFixed(2)}h
                                 </span>
                             </td>
                             <td className="text-center">
                                 {item.estado === 'ahorro' && (
                                     <span className="badge bg-green-100 text-green-800 border-green-200">
                                         🟢 A Favor ({(item.diferencia / 60).toFixed(1)}h)
                                     </span>
                                 )}
                                 {item.estado === 'neutro' && (
                                     <span className="badge bg-blue-50 text-blue-700 border-blue-200">
                                         🔵 Justo
                                     </span>
                                 )}
                                 {item.estado === 'exceso' && (
                                     <span className="badge bg-red-100 text-red-800 border-red-200">
                                         🔴 Exceso (+{(item.diferencia / 60).toFixed(1)}h)
                                     </span>
                                 )}
                             </td>
                         </tr>
                     ))
                 )}
             </tbody>
         </table>
      </div>
    </div>
  );
}
