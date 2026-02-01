"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import { showSuccess, showError } from "@/lib/toast";

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

interface DrawerEditarPlaningProps {
  isOpen: boolean;
  onClose: () => void;
  asignacion: Asignacion;
  onSuccess: () => void;
}

const PRESET_COLORS = [
  "#3b82f6", // blue-500
  "#ef4444", // red-500
  "#10b981", // green-500
  "#f59e0b", // amber-500
  "#8b5cf6", // violet-500
  "#ec4899", // pink-500
  "#06b6d4", // cyan-500
  "#f97316", // orange-500
  "#6366f1", // indigo-500
  "#84cc16", // lime-500
];

export default function DrawerEditarPlaning({
  isOpen,
  onClose,
  asignacion,
  onSuccess,
}: DrawerEditarPlaningProps) {
  const [loading, setLoading] = useState(false);
  
  // Form fields
  const [alias, setAlias] = useState(asignacion.alias || "");
  const [color, setColor] = useState(asignacion.color || "");
  const [ignorarFestivos, setIgnorarFestivos] = useState(asignacion.ignorar_festivos);
  const [fechaFin, setFechaFin] = useState(asignacion.fecha_fin ? asignacion.fecha_fin.slice(0, 10) : ""); 
  const [indefinido, setIndefinido] = useState(!asignacion.fecha_fin);

  useEffect(() => {
     if(indefinido) {
         setFechaFin("");
     }
  }, [indefinido]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await api.put(`/admin/plantillas/asignaciones/${asignacion.id}`, {
        alias,
        color,
        ignorar_festivos: ignorarFestivos,
        fecha_fin: indefinido ? null : fechaFin
      });
      onSuccess();
    } catch (err) {
      console.error(err);
      showError("Error al actualizar la asignación");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Overlay backdrop */}
      <div
        className={`fixed inset-0 z-[100] bg-black/40 transition-opacity ${
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`
          fixed inset-y-0 right-0 z-[101]
          w-full max-w-md bg-card shadow-2xl border-l border-border
          transform transition-transform duration-300 ease-in-out flex flex-col
          ${isOpen ? "translate-x-0" : "translate-x-full"}
        `}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
            <div>
              <h2 className="text-lg font-bold">Editar Planing</h2>
              <p className="text-xs text-muted-foreground">{asignacion.plantilla_nombre} - {asignacion.empleado_nombre || "Admin"}</p>
            </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-full"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <form id="form-editar-planing" onSubmit={handleSubmit} className="space-y-6">
            
            {/* --- ALIAS Y COLOR --- */}
            <div className="space-y-4 border p-4 rounded-md bg-muted/20">
              <h3 className="font-semibold text-sm">Personalización</h3>
              
              <div>
                <label className="block text-sm font-medium mb-1">Nombre Personalizado (Alias)</label>
                <input
                  type="text"
                  className="input w-full"
                  placeholder="Ej. Obra Calle Mayor, Reforma Cocina..."
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">Nombre visible en el calendario (sobrescribe nombre de plantilla).</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Color Etiqueta</label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`w-8 h-8 rounded-full border-2 transition-transform ${
                        color === c ? "border-primary scale-110" : "border-transparent hover:scale-105"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <button
                     type="button"
                     onClick={() => setColor("")} // Reset
                     className={`px-3 py-1 text-xs border rounded hover:bg-muted ${!color ? 'bg-muted font-bold' : ''}`}
                  >
                      X
                  </button>
                </div>
              </div>
            </div>

            {/* --- FECHAS --- */}
            <div className="space-y-4 border p-4 rounded-md bg-muted/20">
              <h3 className="font-semibold text-sm">Vigencia y Reglas</h3>

              <div>
                  <label className="block text-sm font-medium mb-1">Fecha Inicio</label>
                  <input 
                      type="date"
                      className="input w-full bg-muted cursor-not-allowed"
                      value={new Date(asignacion.fecha_inicio).toISOString().slice(0,10)}
                      disabled
                  />
                  <p className="text-xs text-muted-foreground mt-1">Para cambiar inicio, elimina y crea de nuevo.</p>
              </div>

              <div>
                  <div className="flex justify-between items-center mb-1">
                      <label className="block text-sm font-medium">Fecha Fin</label>
                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input 
                              type="checkbox"
                              checked={indefinido}
                              onChange={(e) => setIndefinido(e.target.checked)}
                          />
                          Indefinido
                      </label>
                  </div>
                  
                  {!indefinido && (
                      <input 
                          type="date"
                          className="input w-full"
                          value={fechaFin}
                          onChange={(e) => setFechaFin(e.target.value)}
                          min={new Date(asignacion.fecha_inicio).toISOString().slice(0,10)}
                          required={!indefinido}
                      />
                  )}
              </div>

              <div className="flex items-start gap-2 pt-2">
                <input
                  type="checkbox"
                  id="edit-ignorar"
                  className="mt-1"
                  checked={ignorarFestivos}
                  onChange={(e) => setIgnorarFestivos(e.target.checked)}
                />
                <label htmlFor="edit-ignorar" className="text-sm cursor-pointer">
                  <strong>Forzar en festivos y bajas</strong>
                  <p className="text-xs text-muted-foreground">
                    Si se activa, se creará una barra continua ignorando festivos. Si se desactiva, se cortará la barra en días no laborables.
                  </p>
                </label>
              </div>
            </div>

          </form>
        </div>

        <div className="p-4 border-t border-border bg-muted/10 flex justify-end gap-3 sticky bottom-0">
          <button 
            type="button" 
            className="btn-secondary" 
            onClick={onClose} 
            disabled={loading}
          >
            Cancelar
          </button>
          <button 
            type="submit" 
            form="form-editar-planing" 
            className="btn-primary"
            disabled={loading}
          >
            {loading ? 'Guardando...' : 'Guardar Cambios'}
          </button>
        </div>
      </div>
    </>
  );
}
