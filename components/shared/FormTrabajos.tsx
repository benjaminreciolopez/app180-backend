"use client";

import { useState, useEffect } from "react";
import { api } from "@/services/api";

type Option = { id: string; nombre: string; modo_defecto?: string };

type Props = {
  isAdmin?: boolean;
  empleados?: Option[]; // Solo necesario si isAdmin
  clientes: Option[];
  onCreated: () => void;
};

export default function FormTrabajos({
  isAdmin = false,
  empleados = [],
  clientes,
  onCreated,
}: Props) {
  const [loading, setLoading] = useState(false);

  // Fields
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [descripcion, setDescripcion] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [workItemNombre, setWorkItemNombre] = useState("");
  
  // Admin only
  const [empleadoId, setEmpleadoId] = useState("");

  // Billing Mode
  // 'hora', 'dia', 'mes', 'valorado' (fixed)
  const [billingType, setBillingType] = useState("hora"); 
  
  // Inputs per mode
  const [horas, setHoras] = useState("1");
  const [dias, setDias] = useState("1");
  const [meses, setMeses] = useState("1");
  
  const [duracionTexto, setDuracionTexto] = useState(""); // For 'valorado' display
  const [precioFijo, setPrecioFijo] = useState(""); // For 'valorado' (admin only)

  // Detect client default mode
  useEffect(() => {
      if(clienteId) {
          const c = clientes.find(x => x.id === clienteId);
          if(c?.modo_defecto && c.modo_defecto !== 'mixto') {
              setBillingType(c.modo_defecto);
          }
           // If 'mixto', keep current or default to 'hora'
      }
  }, [clienteId, clientes]);

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
      await api.post("/worklogs", {
        fecha,
        minutos: calculatedMinutes, 
        descripcion,
        cliente_id: clienteId || null,
        work_item_nombre: workItemNombre || null, 
        empleado_id: isAdmin ? (empleadoId || null) : undefined,
        
        // New fields
        tipo_facturacion: billingType,
        duracion_texto: billingType === 'valorado' ? duracionTexto : null, 
        precio: finalPrecio
      });

      // Reset
      setDescripcion("");
      setHoras("1");
      setDias("1");
      setMeses("1");
      setDuracionTexto("");
      setPrecioFijo("");
      // setClienteId(""); // Keep client selected for faster entry? Or reset? Usually reset.
      setClienteId("");
      setWorkItemNombre("");
      if (isAdmin) setEmpleadoId(""); 
      
      onCreated();
    } catch (err) {
      console.error(err);
      alert("Error al guardar el trabajo");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">Registrar nuevo trabajo</h3>
      </div>

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

      <div className="space-y-1">
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
                placeholder="Detalles del trabajo..."
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
             />
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={loading}
          className="btn-primary px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Guardando..." : "Guardar Trabajo"}
        </button>
      </div>
    </form>
  );
}
