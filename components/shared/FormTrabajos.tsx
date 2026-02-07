"use client";

import { useState, useEffect } from "react";
import { api } from "@/services/api";
import { X, Save, Copy, ChevronDown, Trash2, Edit } from "lucide-react";

type Option = { id: string; nombre: string; modo_defecto?: string };
type Template = { id: string; descripcion: string; detalles?: string };

type Props = {
  isAdmin?: boolean;
  empleados?: Option[]; 
  clientes: Option[];
  onCreated: () => void;
  initialData?: any;
  mode?: 'create' | 'edit' | 'clone';
  onCancel?: () => void;
};

export default function FormTrabajos({
  isAdmin = false,
  empleados = [],
  clientes,
  onCreated,
  initialData,
  mode = 'create',
  onCancel
}: Props) {
  const [loading, setLoading] = useState(false);

  // Fields
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [descripcion, setDescripcion] = useState("");
  const [detalles, setDetalles] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [workItemNombre, setWorkItemNombre] = useState("");
  
  // Admin only
  const [empleadoId, setEmpleadoId] = useState("");

  // Billing Mode
  const [billingType, setBillingType] = useState("hora"); 
  
  // Inputs per mode
  const [horas, setHoras] = useState("1");
  const [dias, setDias] = useState("1");
  const [meses, setMeses] = useState("1");
  
  const [duracionTexto, setDuracionTexto] = useState(""); 
  const [precioFijo, setPrecioFijo] = useState(""); 

  // Templates
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);

  // Multiple dates (for cloning)
  const [extraDates, setExtraDates] = useState<string[]>([]);

  // Detect client default mode (only on creation)
  useEffect(() => {
      if(clienteId && mode === 'create') {
          const c = clientes.find(x => x.id === clienteId);
          if(c?.modo_defecto && c.modo_defecto !== 'mixto') {
              setBillingType(c.modo_defecto);
          }
      }
  }, [clienteId, clientes, mode]);

  // Load Templates
  useEffect(() => {
    api.get("/worklogs/templates").then(res => {
      if(Array.isArray(res.data)) setTemplates(res.data);
    }).catch(console.error);
  }, []);

  // Sync with initialData (Edit / Clone)
  useEffect(() => {
    if (initialData) {
      setFecha(initialData.fecha ? new Date(initialData.fecha).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
      setDescripcion(initialData.descripcion || "");
      setDetalles(initialData.detalles || "");
      setClienteId(initialData.cliente_id || "");
      setWorkItemNombre(initialData.work_item_nombre || "");
      setEmpleadoId(initialData.employee_id || "");
      setBillingType(initialData.tipo_facturacion || "hora");
      setDuracionTexto(initialData.duracion_texto || "");
      setPrecioFijo(initialData.valor ? String(initialData.valor) : "");

      // Calc helper inputs
      if (initialData.tipo_facturacion === 'hora' && initialData.minutos) setHoras(String(initialData.minutos / 60));
      if (initialData.tipo_facturacion === 'dia' && initialData.minutos) setDias(String(initialData.minutos / 480));
      if (initialData.tipo_facturacion === 'mes' && initialData.minutos) setMeses(String(initialData.minutos / 9600));
    } else {
      // Reset to defaults if initialData is null
      setDescripcion("");
      setDetalles("");
      setWorkItemNombre("");
      setSaveAsTemplate(false);
      setExtraDates([]);
    }
  }, [initialData, mode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!descripcion.trim()) {
      alert("La descripción es obligatoria");
      return;
    }

    let calculatedMinutes = 0;
    let finalPrecio = null;

    if (billingType === 'hora') {
        const h = parseFloat(horas.replace(",", "."));
        if (isNaN(h) || h <= 0) return alert("Horas inválidas");
        calculatedMinutes = Math.round(h * 60);
    } else if (billingType === 'dia') {
        const d = parseFloat(dias.replace(",", "."));
        if (isNaN(d) || d <= 0) return alert("Días inválidos");
        calculatedMinutes = Math.round(d * 8 * 60); // 8h/day standard
    } else if (billingType === 'mes') {
        const m = parseFloat(meses.replace(",", "."));
        // 22 days * 8 hours? or just placeholder minutes. 
        // Let's say 1 month = 160h = 9600 min
        calculatedMinutes = Math.round(m * 160 * 60); 
    } else if (billingType === 'valorado') {
        // En valorado, la duración es texto libre para mostrar, pero para stats guardamos 0 si no se pide.
        // Pero guardemos 0 minutos.
        calculatedMinutes = 0; 
        if(precioFijo) finalPrecio = parseFloat(precioFijo.replace(",", "."));
    }

    setLoading(true);
    try {
      const payload = {
        fecha,
        minutos: calculatedMinutes, 
        descripcion,
        detalles,
        cliente_id: clienteId || null,
        work_item_nombre: workItemNombre || null, 
        empleado_id: isAdmin ? (empleadoId || null) : undefined,
        tipo_facturacion: billingType,
        duracion_texto: billingType === 'valorado' ? duracionTexto : null, 
        precio: finalPrecio,
        save_as_template: saveAsTemplate
      };

      if (mode === 'edit' && initialData?.id) {
        await api.put(`/worklogs/${initialData.id}`, payload);
      } else if (mode === 'clone' && initialData?.id) {
        // Combinamos fecha base + extraDates
        const allDates = [fecha, ...extraDates].filter(Boolean);
        await api.post("/worklogs/clonar", {
          work_log_id: initialData.id,
          fechas: allDates,
          cliente_id: clienteId || null
        });
      } else {
        await api.post("/worklogs", payload);
      }

      // Reset
      if (mode === 'create') {
        setDescripcion("");
        setDetalles("");
        setWorkItemNombre("");
        setHoras("1");
        setDias("1");
        setMeses("1");
        setDuracionTexto("");
        setPrecioFijo("");
        setClienteId("");
        if (isAdmin) setEmpleadoId(""); 
      }
      
      onCreated();
      // Reload templates if one was saved
      if (saveAsTemplate) {
        api.get("/worklogs/templates").then(res => {
          if(Array.isArray(res.data)) setTemplates(res.data);
        });
      }
    } catch (err) {
      console.error(err);
      alert("Error al guardar el trabajo");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`card space-y-4 border-2 transition-colors ${mode === 'edit' ? 'border-indigo-200 bg-indigo-50/10' : mode === 'clone' ? 'border-blue-200 bg-blue-50/10' : 'border-transparent'}`}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg flex items-center gap-2">
          {mode === 'edit' ? <><Edit size={20} className="text-indigo-600"/> Editar Trabajo</> : 
           mode === 'clone' ? <><Copy size={20} className="text-blue-600"/> Clonar Trabajo (Multifecha)</> : 
           "Registrar nuevo trabajo"}
        </h3>
        {onCancel && (
          <button type="button" onClick={onCancel} className="p-1 hover:bg-gray-100 rounded-full">
            <X size={20}/>
          </button>
        )}
      </div>

      {/* Selector Plantillas */}
      {templates.length > 0 && mode === 'create' && (
        <div className="relative">
          <button 
            type="button"
            onClick={() => setShowTemplates(!showTemplates)}
            className="flex items-center gap-1 text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-1 rounded hover:bg-indigo-100"
          >
            Usar de Plantilla <ChevronDown size={14}/>
          </button>
          {showTemplates && (
            <div className="absolute top-8 left-0 z-50 w-64 bg-white border border-gray-200 rounded-lg shadow-xl py-1 animate-in fade-in zoom-in duration-100">
              <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b">Tus descripciones favoritas</div>
              {templates.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setDescripcion(t.descripcion);
                    if(t.detalles) setDetalles(t.detalles);
                    setShowTemplates(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 group flex items-center justify-between"
                >
                  <span className="truncate pr-2">{t.descripcion}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {isAdmin && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">
              Empleado
            </label>
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
              value={empleadoId}
              onChange={(e) => setEmpleadoId(e.target.value)}
            >
              <option value="">(Yo / Asignarme a mí)</option>
              {empleados.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Fecha</label>
          <input
            type="date"
            required
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">
            Cliente <span className="text-gray-400 font-normal">(Opcional)</span>
          </label>
          <select
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={clienteId}
            onChange={(e) => setClienteId(e.target.value)}
          >
            <option value="">- Seleccionar -</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>

        {/* Facturacion Mode */}
        <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Facturación</label>
            <select 
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={billingType}
                onChange={e => setBillingType(e.target.value)}
            >
                <option value="hora">Por Horas</option>
                <option value="dia">Por Días</option>
                <option value="mes">Por Meses</option>
                <option value="valorado">Precio Cerrado</option>
            </select>
        </div>

        {/* Dynamic Duration Input */}
        {billingType === 'hora' && (
             <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Duración (Horas)</label>
                <input
                    type="number" step="0.1" min="0.1" required
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={horas}
                    onChange={(e) => setHoras(e.target.value)}
                />
             </div>
        )}
        {billingType === 'dia' && (
             <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Duración (Días)</label>
                <input
                    type="number" step="0.5" min="0.5" required
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={dias}
                    onChange={(e) => setDias(e.target.value)}
                />
             </div>
        )}
        {billingType === 'mes' && (
             <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Duración (Meses)</label>
                <input
                    type="number" step="0.1" min="0.1" required
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={meses}
                    onChange={(e) => setMeses(e.target.value)}
                />
             </div>
        )}
        {billingType === 'valorado' && (
           <>
             <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Duración (Texto)</label>
                <input
                    type="text"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={duracionTexto}
                    onChange={(e) => setDuracionTexto(e.target.value)}
                    placeholder="Ej: 2 semanas"
                />
             </div>
             {isAdmin && (
                <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-500">Importe (€)</label>
                    <input
                        type="number" step="0.01"
                        className="w-full border rounded-lg px-3 py-2 text-sm font-bold text-green-700"
                        value={precioFijo}
                        onChange={(e) => setPrecioFijo(e.target.value)}
                        placeholder="0.00"
                    />
                </div>
             )}
           </>
        )}

      </div>

      {/* Clonación Multiple Fechas */}
      {mode === 'clone' && (
        <div className="bg-blue-50/50 p-3 rounded-lg border border-blue-100 space-y-2">
           <label className="text-xs font-bold text-blue-700 uppercase tracking-tight">Fechas adicionales para clonar</label>
           <div className="flex flex-wrap gap-2">
              {extraDates.map((d, i) => (
                <div key={i} className="flex items-center gap-1 bg-white border border-blue-200 pl-2 pr-1 py-1 rounded-md text-sm text-blue-800 shadow-sm">
                   {new Date(d).toLocaleDateString()}
                   <button type="button" onClick={() => setExtraDates(extraDates.filter((_, idx) => idx !== i))} className="p-0.5 hover:text-red-500">
                      <X size={14}/>
                   </button>
                </div>
              ))}
              <input 
                type="date"
                className="text-xs border rounded px-2 py-1 outline-none"
                onChange={(e) => {
                  if(e.target.value) {
                    setExtraDates([...extraDates, e.target.value]);
                    e.target.value = "";
                  }
                }}
              />
           </div>
           <p className="text-[10px] text-blue-500 italic">Cada fecha generará una copia exacta de este registro.</p>
        </div>
      )}

      <div className="space-y-4">
        <label className="text-xs font-medium text-gray-500">
            Descripción / Trabajo
            {billingType !== 'valorado' && (
                <span className="text-gray-400 font-normal ml-2">
                    (Puedes indicar tipo, p.ej: "Fontanería")
                </span>
            )}
        </label>
        
        {/* Combined input for simple usage, or separate type? 
            Original form had "Type" and "Description". Keeping it simple.
        */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-3">
             <input
                type="text"
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={workItemNombre}
                onChange={(e) => setWorkItemNombre(e.target.value)}
                placeholder="Tipo (Ej: Revisión)"
             />
             <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="Descripción corta (aparece en factura)..."
                required
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
             />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-500">Detalles adicionales (Opcional)</label>
        <textarea
          className="w-full border rounded-lg px-3 py-2 text-sm min-h-[80px]"
          placeholder="Explicación detallada del trabajo realizado..."
          value={detalles}
          onChange={(e) => setDetalles(e.target.value)}
        />
        {mode === 'create' && (
          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input 
              type="checkbox" 
              className="rounded text-indigo-600"
              checked={saveAsTemplate}
              onChange={(e) => setSaveAsTemplate(e.target.checked)}
            />
            <span className="text-xs text-gray-500">Guardar descripción y detalles como plantilla favorita</span>
          </label>
        )}
      </div>

       <div className="flex justify-end pt-2 gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Cancelar
          </button>
        )}
        <button
          type="submit"
          disabled={loading}
          className="btn-primary px-8 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? "Guardando..." : (
            mode === 'edit' ? <><Save size={18}/> Guardar Cambios</> : 
            mode === 'clone' ? <><Copy size={18}/> Iniciar Clonación</> : 
            "Guardar Trabajo"
          )}
        </button>
      </div>
    </form>
  );
}
