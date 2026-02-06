"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import { showSuccess, showError } from "@/lib/toast";

type Plantilla = { id: string; nombre: string };
type Empleado = { id: string; nombre: string };
type Cliente = { id: string; nombre: string };

export default function DrawerCrearPlaningAdmin({
  fechaDefault,
  empleadoDefaultId,
  empleados = [],
  onClose,
  onCreated,
}: {
  fechaDefault?: string;
  empleadoDefaultId?: string;
  empleados?: Empleado[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loadingBase, setLoadingBase] = useState(true);

  const [empleadoSel, setEmpleadoSel] = useState(empleadoDefaultId || "");
  const [plantillaSel, setPlantillaSel] = useState("");
  const [clienteSel, setClienteSel] = useState("");
  const [fechaInicio, setFechaInicio] = useState(fechaDefault || new Date().toISOString().slice(0, 10));
  const [recurrenciaMode, setRecurrenciaMode] = useState<string>("single"); // single, custom
  const [fechaFin, setFechaFin] = useState(fechaDefault || new Date().toISOString().slice(0, 10));
  const [alias, setAlias] = useState("");
  const [color, setColor] = useState<string>("");
  const [ignorarFestivos, setIgnorarFestivos] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [rp, rc] = await Promise.all([
          api.get("/admin/plantillas"),
          api.get("/admin/clientes"),
        ]);
        setPlantillas(Array.isArray(rp.data) ? rp.data : []);
        setClientes(Array.isArray(rc.data) ? rc.data : []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingBase(false);
      }
    })();
  }, []);

  async function handleSave() {
    if (!plantillaSel || !fechaInicio) {
      showError("Plantilla y fecha de inicio obligatorias");
      return;
    }

    if (fechaFin && new Date(fechaFin) < new Date(fechaInicio)) {
      showError("La fecha de fin no puede ser anterior a la de inicio");
      return;
    }

    setSaving(true);
    try {
      await api.post("/admin/plantillas/asignar", {
        empleado_id: empleadoSel || null,
        plantilla_id: plantillaSel,
        cliente_id: clienteSel || null,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin || null,
        alias: alias || null,
        color: color || null,
        ignorar_festivos: ignorarFestivos,
      });
      showSuccess("Planing creado correctamente");
      onCreated();
      onClose();
    } catch (e: any) {
      showError(e.response?.data?.error || "Error al crear planing");
    } finally {
      setSaving(false);
    }
  }

  if (loadingBase) return <div className="p-6 text-center text-sm">Cargando datos...</div>;

  return (
    <div className="p-4 space-y-4 pb-10">
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-semibold mb-1">Empleado</label>
          <select
            className="w-full border p-2 rounded-xl bg-gray-50 text-sm"
            value={empleadoSel}
            onChange={(e) => setEmpleadoSel(e.target.value)}
          >
            <option value="">(Para el Administrador)</option>
            {empleados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">Plantilla de Horario</label>
          <select
            className="w-full border p-2 rounded-xl text-sm"
            value={plantillaSel}
            onChange={(e) => setPlantillaSel(e.target.value)}
          >
            <option value="">-- Selecciona --</option>
            {plantillas.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">Adjudicar trabajo principal a (Cliente)</label>
          <select
            className="w-full border p-2 rounded-xl text-sm"
            value={clienteSel}
            onChange={(e) => setClienteSel(e.target.value)}
          >
            <option value="">-- Por defecto --</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
          <p className="text-[11px] text-gray-500 mt-1">
            Si la plantilla tiene bloques con clientes específicos, prevalecerán sobre este.
          </p>
        </div>

        {/* V5: Personalización */}
        <div className="p-3 bg-gray-50 rounded-xl space-y-3 border border-gray-100">
           <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Nombre Personalizado (Opcional)</label>
              <input 
                type="text" 
                placeholder="Ej: Obra Calle Mayor"
                className="w-full border p-2 rounded-lg text-sm bg-white"
                value={alias}
                onChange={e => setAlias(e.target.value)}
              />
           </div>
           
           <div className="flex items-center gap-4">
             <div className="flex-1">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Color</label>
                <div className="flex items-center gap-2 overflow-x-auto pb-1 custom-scrollbar">
                  {[
                    // Palette Google Calendar style
                    "#039BE5", // Blue (Default)
                    "#D50000", // Tomato
                    "#F4511E", // Tangerine
                    "#E67C73", // Flaming
                    "#F6BF26", // Banana
                    "#33B679", // Sage
                    "#0B8043", // Basil
                    "#8E24AA", // Grape
                    "#7986CB", // Lavender
                    "#616161", // Graphite
                  ].map(c => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-6 h-6 rounded-full shrink-0 transition-transform ${color === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <button 
                    onClick={() => setColor("")}
                    className={`w-6 h-6 rounded-full border border-gray-300 flex items-center justify-center text-[10px] text-gray-500 bg-white ${!color ? 'ring-2 ring-offset-2 ring-gray-400' : ''}`}
                  >
                   X
                  </button>
                </div>
             </div>
           </div>

           <div className="flex items-center gap-2 pt-1">
              <input 
                type="checkbox" 
                id="ignorarFestivos"
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                checked={ignorarFestivos}
                onChange={e => setIgnorarFestivos(e.target.checked)}
              />
              <label htmlFor="ignorarFestivos" className="text-sm font-medium text-gray-700 select-none cursor-pointer">
                Forzar trabajo en festivos/bajas
              </label>
           </div>
           <p className="text-[10px] text-gray-400 leading-tight pl-6">
             Si marcas esta opción, el planing no se cortará en días festivos o ausencias médicas.
           </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold mb-1">Empieza el</label>
            <input
              type="date"
              className="w-full border p-2 rounded-xl text-sm"
              value={fechaInicio}
              onChange={(e) => {
                setFechaInicio(e.target.value);
                // Si estamos en modo "un solo día", actualizar fin
                if (recurrenciaMode === "single") setFechaFin(e.target.value);
              }}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Repetir</label>
            <select
              className="w-full border p-2 rounded-xl text-sm bg-gray-50"
              value={recurrenciaMode}
              onChange={(e) => {
                const m = e.target.value;
                setRecurrenciaMode(m);
                if (m === "single") setFechaFin(fechaInicio);
                if (m === "forever") setFechaFin("");
                // Para meses/semanas habría que calcular, pero por simplicidad dejamos que el usuario elija o limpiamos
                if (m === "custom") setFechaFin(""); 
              }}
            >
              <option value="single">Un solo día</option>
              {/* <option value="forever">Indefinidamente</option> Pospuesto por complejidad de UI */}
              <option value="custom">Rango de fechas</option>
            </select>
          </div>
        </div>

        {recurrenciaMode === "custom" && (
           <div className="mt-2">
             <label className="block text-sm font-semibold mb-1">Termina el (inclusive)</label>
             <input
               type="date"
               className="w-full border p-2 rounded-xl text-sm border-indigo-200 bg-indigo-50"
               value={fechaFin}
               onChange={(e) => setFechaFin(e.target.value)}
             />
           </div>
        )}
      </div>

      <div className="pt-4 flex flex-col gap-2">
        <button
          disabled={saving}
          onClick={handleSave}
          className="w-full py-3 rounded-xl bg-indigo-600 text-white font-semibold text-sm active:scale-95 transition-transform disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Crear / Asignar Planing"}
        </button>
        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl border border-black/10 text-sm font-semibold active:bg-black/5"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
