"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import { showSuccess, showError } from "@/lib/toast";
import DrawerCrearPlaningAdmin from "@/components/admin/drawer/DrawerCrearPlaningAdmin";
import DrawerEditarPlaning from "@/components/admin/drawer/DrawerEditarPlaning";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

// Interfaz para la tabla
interface Asignacion {
  id: string;
  empleado_id: string | null;
  empleado_nombre: string | null;
  plantilla_id: string;
  plantilla_nombre: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  fecha_inicio: string;
  fecha_fin: string | null;
  alias: string | null;
  color: string | null;
  ignorar_festivos: boolean;
}

export default function PlaningsPage() {
  const [loading, setLoading] = useState(true);
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([]);
  // Drawer edición/creación
  const [showDrawer, setShowDrawer] = useState(false);
  
  // Estado para edición
  const [editingAsignacion, setEditingAsignacion] = useState<Asignacion | null>(null);

  // Estado para empleados y clientes
  const [empleados, setEmpleados] = useState<{ id: string; nombre: string }[]>([]);
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>([]);

  const [filtros, setFiltros] = useState({
      estado: 'activos', // 'activos' | 'historial' | '' (todos)
      busqueda: '',
      empleado_id: '',
      cliente_id: '',
      tipo: 'proyecto' // 'proyecto' (Default: Solo con Alias/Cliente) | 'horario' (Solo Plantilla base) | 'todos'
  });

  // ... (drawer states)

  const loadData = async () => {
    setLoading(true);
    try {
      const [resAsig, resEmp, resCli] = await Promise.all([
         api.get("/admin/plantillas/asignaciones", { 
             params: { 
                 estado: filtros.estado,
                 empleado_id: filtros.empleado_id
             } 
         }),
         api.get("/employees"),
         api.get("/admin/clientes")
      ]);
      setAsignaciones(resAsig.data || []);
      setEmpleados(Array.isArray(resEmp.data) ? resEmp.data : []);
      setClientes(Array.isArray(resCli.data) ? resCli.data : []);
    } catch (err) {
      console.error("Error cargando datos", err);
      showError("Error al cargar datos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [filtros.estado, filtros.empleado_id]);

  // Filtrado local
  const filtered = asignaciones.filter(a => {
      // 1. Filtro Tipo
      if (filtros.tipo === 'proyecto') {
          // Un "Planing/Proyecto" tiene Alias O Cliente asignado.
          // Si solo es Plantilla base sin alias/cliente, es "Horario".
          const esProyecto = !!a.alias || !!a.cliente_id;
          if (!esProyecto) return false;
      } else if (filtros.tipo === 'horario') {
          const esProyecto = !!a.alias || !!a.cliente_id;
          if (esProyecto) return false;
      }

      // 2. Filtro Cliente
      if (filtros.cliente_id && a.cliente_id !== filtros.cliente_id) return false;

      // 3. Busqueda Texto
      const search = filtros.busqueda.toLowerCase();
      const matchEmpleado = (a.empleado_nombre || "Sin Asignar").toLowerCase().includes(search);
      const matchPlantilla = (a.plantilla_nombre || "").toLowerCase().includes(search);
      const matchCliente = (a.cliente_nombre || "").toLowerCase().includes(search);
      const matchAlias = (a.alias || "").toLowerCase().includes(search);
      
      return matchEmpleado || matchPlantilla || matchCliente || matchAlias;
  });

  // Estado para borrado seguro
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const borrarAsignacion = async (id: string) => {
      if(!confirm("¿Seguro que quieres eliminar este planing? Esta acción no se puede deshacer.")) return;
      
      setDeletingId(id);
      try {
          await api.delete(`/admin/plantillas/asignaciones/${id}`);
          showSuccess("Planing eliminado");
          loadData();
      } catch(err) {
          showError("Error al eliminar");
      } finally {
          setDeletingId(null);
      }
  }

  const handleEdit = (asignacion: Asignacion) => {
      // Como DrawerCrearPlaningAdmin espera props específicas de "Creación" (fecha, empleado),
      // y no está refactorizado para Edición completa aun, 
      // para esta iteración V5.5 voy a usar "Editar" para abrir un modal simple de edición de metadatos (Alias, Color, Fecha Fin)
      // o adaptar el Drawer.
      
      // Voy a optar por mostrar un Toast diciendo que la edición completa está en desarrollo si detecto conflicto,
      // pero el usuario pidió "poder editarlos... cambiar nombre, etc".
      // Así que implementaré un Drawer de Edición específico temporal O adaptaré el existente.
      
      // Estrategia: Guardar en estado `editingAsignacion` y renderizar un `DrawerEditarPlaning` (que crearé a continuación).
      setEditingAsignacion(asignacion);
  };

  return (
    <div className="app-main h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 shrink-0">
        <div>
           <h1 className="text-2xl font-bold">Gestión de Planings</h1>
           <p className="text-muted-foreground text-sm">Control centralizado de asignaciones y trabajos</p>
        </div>

        <div className="flex gap-2">
           <button 
             className="btn-primary"
             onClick={() => setShowDrawer(true)}
           >
             + Nuevo Planing
           </button>
        </div>
      </div>

      {/* Tabs Principales: Planings vs Horarios */}
      <div className="flex gap-4 mb-4 border-b">
          <button 
             className={`pb-2 px-1 text-sm font-bold border-b-2 transition-colors ${filtros.tipo === 'proyecto' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
             onClick={() => setFiltros({...filtros, tipo: 'proyecto'})}
          >
             🏗️ Servicios / Proyectos
          </button>
          <button 
             className={`pb-2 px-1 text-sm font-bold border-b-2 transition-colors ${filtros.tipo === 'horario' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
             onClick={() => setFiltros({...filtros, tipo: 'horario'})}
          >
             📅 Horarios Base
          </button>
          <button 
             className={`pb-2 px-1 text-sm font-bold border-b-2 transition-colors ${filtros.tipo === 'todos' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
             onClick={() => setFiltros({...filtros, tipo: 'todos'})}
          >
             Ver Todo
          </button>
      </div>

      <div className="flex flex-wrap gap-4 mb-4 items-end shrink-0 bg-gray-50 p-3 rounded-lg border">
         {/* Filtro Cliente */}
         <div className="form-control w-full max-w-xs">
           <label className="label py-1"><span className="label-text text-xs font-semibold">Cliente / Servicio</span></label>
           <select 
              className="select select-bordered select-sm w-full bg-white"
              value={filtros.cliente_id}
              onChange={(e) => setFiltros({...filtros, cliente_id: e.target.value})}
           >
              <option value="">-- Todos --</option>
              {clientes.map(c => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
           </select>
         </div>

         {/* Filtro Empleado */}
         <div className="form-control w-full max-w-xs">
           <label className="label py-1"><span className="label-text text-xs font-semibold">Empleado</span></label>
           <select 
              className="select select-bordered select-sm w-full bg-white"
              value={filtros.empleado_id}
              onChange={(e) => {
                 setFiltros({
                   ...filtros, 
                   empleado_id: e.target.value,
                   estado: e.target.value ? '' : 'activos' 
                 })
              }}
           >
              <option value="">-- Todos --</option>
              {empleados.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.nombre}</option>
              ))}
           </select>
         </div>
         
         {/* Botones de Estado */}
         <div className="flex items-center gap-1 border rounded p-1 bg-white ml-auto">
             <button 
                className={`px-3 py-1 rounded text-xs font-medium uppercase tracking-wide ${filtros.estado === 'activos' ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-gray-100 text-gray-600'}`}
                onClick={() => setFiltros({...filtros, estado: 'activos'})}
             >
                 Vigentes
             </button>
             <button 
                className={`px-3 py-1 rounded text-xs font-medium uppercase tracking-wide ${filtros.estado === 'historial' ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-gray-100 text-gray-600'}`}
                onClick={() => setFiltros({...filtros, estado: 'historial'})}
             >
                 Historial
             </button>
             {filtros.empleado_id && (
               <button 
                  className={`px-3 py-1 rounded text-xs font-medium uppercase tracking-wide ${filtros.estado === '' ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-gray-100 text-gray-600'}`}
                  onClick={() => setFiltros({...filtros, estado: ''})}
               >
                   Todos
               </button>
             )}
         </div>

         <input 
            type="text" 
            placeholder="Buscar..." 
            className="input input-sm border-gray-300 max-w-[150px] bg-white"
            value={filtros.busqueda}
            onChange={(e) => setFiltros({...filtros, busqueda: e.target.value})}
         />
      </div>

      <div className="card p-0 overflow-auto flex-1">
        <table className="table min-w-[900px]">
          <thead className="sticky top-0 bg-card z-10 shadow-sm">
            <tr>
              <th>Empleado</th>
              <th>Planing / Servicio</th>
              <th>Cliente / Ubicación</th>
              <th>Fechas</th>
              <th className="text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
                <tr>
                    <td colSpan={5} className="text-center p-8">
                        <LoadingSpinner />
                    </td>
                </tr>
            ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="text-center p-8 text-muted-foreground">No se encontraron planings</td></tr>
            ) : (
                filtered.map(asig => (
                    <tr key={asig.id} className="hover:bg-muted/50 group">
                        <td>
                            {asig.empleado_id ? (
                                <div className="font-medium">{asig.empleado_nombre}</div>
                            ) : (
                                <span className="badge-muted">Vacante / Admin</span>
                            )}
                        </td>
                        <td>
                            <div className="flex flex-col">
                                {asig.alias && (
                                    <span className="font-semibold text-primary" style={{ color: asig.color || undefined }}>
                                        {asig.alias}
                                    </span>
                                )}
                                <span className="text-sm text-muted-foreground">{asig.plantilla_nombre}</span>
                                {asig.ignorar_festivos && (
                                    <span className="text-[10px] bg-red-100 text-red-700 px-1 rounded w-fit mt-0.5">Ignora Festivos</span>
                                )}
                            </div>
                        </td>
                        <td>
                             {asig.cliente_nombre ? (
                                 <div className="flex items-center gap-1">
                                     <span className="badge-outline">{asig.cliente_nombre}</span>
                                 </div>
                             ) : (
                                 <span className="text-muted-foreground text-xs">-</span>
                             )}
                        </td>
                        <td>
                            <div className="text-sm">
                                <div className="flex gap-1">
                                    <span className="text-muted-foreground">Desde:</span>
                                    <span className="font-mono">{new Date(asig.fecha_inicio).toLocaleDateString()}</span>
                                </div>
                                <div className="flex gap-1">
                                    <span className="text-muted-foreground">Hasta:</span>
                                    {asig.fecha_fin ? (
                                        <span className="font-mono">{new Date(asig.fecha_fin).toLocaleDateString()}</span>
                                    ) : (
                                        <span className="font-bold text-green-600">INDEFINIDO ♾️</span>
                                    )}
                                </div>
                            </div>
                        </td>
                        <td className="text-right">
                            <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button 
                                  className="btn-secondary btn-sm disabled:opacity-50" 
                                  onClick={() => handleEdit(asig)}
                                  disabled={!!deletingId}
                                >
                                    ✏️ Editar
                                </button>
                                <button 
                                  className="btn-danger btn-sm disabled:opacity-50 flex items-center gap-1" 
                                  onClick={() => borrarAsignacion(asig.id)}
                                  disabled={!!deletingId}
                                >
                                    {deletingId === asig.id ? "⏳" : "🗑️ Borrar"}
                                </button>
                            </div>
                        </td>
                    </tr>
                ))
            )}
          </tbody>
        </table>
      </div>

       {showDrawer && (
           <DrawerCrearPlaningAdmin
               fechaDefault={new Date().toISOString().slice(0, 10)}
               empleados={empleados}
               onClose={() => setShowDrawer(false)}
               onCreated={() => {
                   setShowDrawer(false);
                   loadData();
                   showSuccess("Planing creado correctamente");
               }}
           />
       )}

       {editingAsignacion && (
           <DrawerEditarPlaning
               isOpen={!!editingAsignacion}
               onClose={() => setEditingAsignacion(null)}
               asignacion={editingAsignacion}
               onSuccess={() => {
                   setEditingAsignacion(null);
                   loadData();
                   showSuccess("Planing actualizado");
               }}
           />
       )}
    </div>
  );
}
