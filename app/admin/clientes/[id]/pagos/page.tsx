"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, X, Trash2, Check, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";

async function api(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem("token");
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${url}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Error API");
  }
  return res.json();
}

type TrabajoPendiente = {
    id: string;
    fecha: string;
    descripcion: string;
    valor: number;
    pagado: number;
    estado_pago: string;
};

export default function PagosPage() {
  const { id } = useParams(); // Client ID
  const router = useRouter();

  const [pagos, setPagos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // New Payment Form
  const [newPay, setNewPay] = useState({
    importe: "",
    metodo: "transferencia",
    fecha_pago: "",
    referencia: "",
    notas: ""
  });

  // Allocation Logic
  const [pendientes, setPendientes] = useState<TrabajoPendiente[]>([]);
  const [loadingPendientes, setLoadingPendientes] = useState(false);
  const [selectedJobs, setSelectedJobs] = useState<Record<string, number>>({}); 

  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
        setLoading(true);
        const data = await api(`/admin/clientes/${id}/pagos`); 
        setPagos(data);
    } catch(e) {
        console.error(e);
    } finally {
        setLoading(false);
    }
  }

  async function loadPendientes() {
      setLoadingPendientes(true);
      try {
          const data = await api(`/admin/clientes/${id}/trabajos-pendientes`);
          setPendientes(data);
      } catch(e) {
          toast.error("Error cargando trabajos pendientes");
      } finally {
          setLoadingPendientes(false);
      }
  }

  useEffect(() => {
    if(id) load();
    setNewPay(p => ({ ...p, fecha_pago: new Date().toISOString().slice(0, 10) }));
  }, [id]);

  useEffect(() => {
     if(drawerOpen) {
         loadPendientes();
         setSelectedJobs({});
     }
  }, [drawerOpen]);

  // Auto-distribute logic
  function autoDistribute() {
      const totalAmount = Number(newPay.importe);
      if(!totalAmount) return;

      let remaining = totalAmount;
      const newSelection: Record<string, number> = {};

      for(const job of pendientes) {
          if(remaining <= 0.01) break;
          
          const debt = Number(job.valor) - Number(job.pagado || 0);
          const pay = Math.min(remaining, debt);
          
          if (pay > 0) {
              newSelection[job.id] = Number(pay.toFixed(2));
              remaining -= pay;
          }
      }
      setSelectedJobs(newSelection);
  }

  // Helper to calculate currently allocated
  const currentAllocated = Object.values(selectedJobs).reduce((a,b) => a+b, 0);

  async function createPayment() {
    if(!newPay.importe) return toast.error("Indica importe");
    if(submitting) return; // Prevent double click
    
    // Prepare Allocations
    const asignaciones = Object.entries(selectedJobs).map(([work_log_id, importe]) => ({
        work_log_id,
        importe
    })).filter(x => x.importe > 0);

    // Validate if allocations <= total
    const totalAllocated = asignaciones.reduce((a,b) => a + b.importe, 0);
    if(totalAllocated > Number(newPay.importe) + 0.05) { // epsilon tolerance 
        return toast.error(`Has asignado más (${formatCurrency(totalAllocated)}) del importe del pago (${formatCurrency(Number(newPay.importe))})`);
    }

    setSubmitting(true);
    try {
        await api(`/admin/pagos`, {
            method: "POST",
            body: JSON.stringify({
                cliente_id: id,
                importe: Number(newPay.importe),
                metodo: newPay.metodo,
                fecha_pago: newPay.fecha_pago,
                referencia: newPay.referencia,
                notas: newPay.notas,
                asignaciones
            })
        });
        toast.success("Pago registrado correctamente");
        setDrawerOpen(false);
        load();
        setNewPay({ importe: "", metodo: "transferencia", fecha_pago: new Date().toISOString().slice(0, 10), referencia: "", notas: "" });
    } catch(e: any) {
        toast.error(e.message);
    } finally {
        setSubmitting(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          onClick={() => router.push(`/admin/facturacion`)}
        >
          <ArrowLeft size={18} />
        </Button>
        <h1 className="text-2xl font-semibold flex-1">Gestión de Pagos</h1>
      </div>

        {/* List */}
        <div className="space-y-3">
            {pagos.map(p => (
                <Card key={p.id}>
                    <CardContent className="p-4 flex justify-between items-center">
                        <div>
                            <div className="font-bold text-lg">{formatCurrency(p.importe)}</div>
                            <div className="text-sm text-gray-500">
                                {new Date(p.fecha_pago).toLocaleDateString()} · <span className="capitalize">{p.metodo}</span>
                            </div>
                            {p.notas && <div className="text-xs text-gray-400 mt-1">{p.notas}</div>}
                        </div>
                        <div className="text-right">
                             <div className={`text-xs px-2 py-1 rounded capitalize ${p.estado === 'registrado' ? 'bg-green-100 text-green-800' : 'bg-gray-100'}`}>
                                {p.estado || "Registrado"}
                             </div>
                        </div>
                    </CardContent>
                </Card>
            ))}
            {!loading && pagos.length === 0 && <div className="text-center py-10 text-gray-400">No hay pagos registrados</div>}
        </div>

      {/* Drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <motion.div
            className="fixed inset-0 bg-black/40 z-50 flex justify-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDrawerOpen(false)}
          >
            <motion.div
              className="bg-white w-full max-w-2xl h-full flex flex-col shadow-2xl"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-6 border-b">
                <h2 className="text-xl font-bold">Registrar Pago</h2>
                <Button variant="ghost" size="sm" onClick={() => setDrawerOpen(false)}>
                  <X size={20} />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                 
                 {/* Datos Generales */}
                 <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label className="text-sm font-medium">Importe (€)</label>
                        <Input 
                            type="number" 
                            className="text-lg font-bold"
                            value={newPay.importe} 
                            onChange={e => setNewPay({...newPay, importe: e.target.value})}
                        />
                     </div>
                     <div>
                        <label className="text-sm font-medium">Fecha Pago</label>
                        <Input 
                            type="date" 
                            value={newPay.fecha_pago} 
                            onChange={e => setNewPay({...newPay, fecha_pago: e.target.value})}
                        />
                     </div>
                     <div>
                        <label className="text-sm font-medium">Método</label>
                        <select 
                            className="w-full border rounded px-3 py-2"
                            value={newPay.metodo}
                            onChange={e => setNewPay({...newPay, metodo: e.target.value})}
                        >
                            <option value="transferencia">Transferencia</option>
                            <option value="efectivo">Efectivo</option>
                            <option value="tarjeta">Tarjeta</option>
                            <option value="bizum">Bizum</option>
                            <option value="otro">Otro</option>
                        </select>
                     </div>
                     <div>
                        <label className="text-sm font-medium">Referencia</label>
                        <Input 
                            placeholder="Ej. Factura 123"
                            value={newPay.referencia} 
                            onChange={e => setNewPay({...newPay, referencia: e.target.value})}
                        />
                     </div>
                 </div>

                 {/* Selector de Trabajos */}
                 <div className="border rounded-lg p-4 bg-gray-50">
                     <div className="flex justify-between items-center mb-4">
                         <h3 className="font-semibold text-gray-700">Imputar a Trabajos Pendientes</h3>
                         <div className="text-xs text-gray-500">
                            Disponble: <span className="font-mono font-bold">{formatCurrency(Math.max(0, Number(newPay.importe) - currentAllocated))}</span>
                         </div>
                         <Button size="sm" variant="outline" onClick={autoDistribute}>
                            Auto-distribuir
                         </Button>
                     </div>

                     {loadingPendientes ? (
                         <div className="text-center py-4 text-gray-400">Cargando trabajos...</div>
                     ) : (
                         <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                             {pendientes.length === 0 && <p className="text-sm text-gray-400 text-center">No hay trabajos pendientes de pago.</p>}
                             
                             {pendientes.map(job => {
                                 const debt = Number(job.valor) - Number(job.pagado || 0);
                                 const isSelected = selectedJobs[job.id] !== undefined;
                                 
                                 return (
                                     <div key={job.id} className={`p-3 rounded border text-sm flex items-center gap-3 transition-colors ${isSelected ? "bg-blue-50 border-blue-200" : "bg-white"}`}>
                                         <input 
                                            type="checkbox" 
                                            checked={isSelected}
                                            onChange={(e) => {
                                                if(e.target.checked) {
                                                    // Smart Select:
                                                    const totalPay = Number(newPay.importe);
                                                    const alreadyAllocated = Object.values(selectedJobs).reduce((a,b) => a+b, 0);
                                                    
                                                    const remainingCapacity = Math.max(0, totalPay - alreadyAllocated);
                                                    
                                                    const amountToAssign = Math.min(debt, remainingCapacity);
                                                    
                                                    setSelectedJobs(prev => ({ ...prev, [job.id]: Number(amountToAssign.toFixed(2)) }))
                                                } else {
                                                    const copy = {...selectedJobs};
                                                    delete copy[job.id];
                                                    setSelectedJobs(copy);
                                                }
                                            }}
                                            className="h-4 w-4"
                                         />
                                         <div className="flex-1">
                                             <div className="font-medium text-gray-800">{new Date(job.fecha).toLocaleDateString()} - {job.descripcion}</div>
                                             <div className="text-xs text-gray-500">
                                                 Valor: {formatCurrency(job.valor)} · Pagado: {formatCurrency(job.pagado || 0)} · <span className="text-red-600 font-bold">Pendiente: {formatCurrency(debt)}</span>
                                             </div>
                                         </div>
                                         {isSelected && (
                                             <div className="w-24">
                                                 <Input 
                                                    type="number" 
                                                    className="h-8 text-right bg-white"
                                                    value={selectedJobs[job.id]}
                                                    onChange={e => {
                                                        const val = Number(e.target.value);
                                                        setSelectedJobs(prev => ({...prev, [job.id]: val}));
                                                    }}
                                                 />
                                             </div>
                                         )}
                                     </div>
                                 )
                             })}
                         </div>
                     )}
                 </div>

                 <div>
                    <label className="text-sm font-medium">Notas</label>
                    <Input 
                        placeholder="Notas internas..."
                        value={newPay.notas} 
                        onChange={e => setNewPay({...newPay, notas: e.target.value})}
                    />
                 </div>

              </div>

              <div className="p-6 border-t bg-gray-50 flex justify-between items-center">
                  <div className="text-sm text-gray-600">
                      Asignado: <span className="font-bold text-black">{formatCurrency(Object.values(selectedJobs).reduce((a,b)=>a+b, 0))}</span>
                  </div>
                  <Button onClick={createPayment} className="w-1/2" disabled={submitting}>
                    {submitting ? "Registrando..." : "Registrar Pago"}
                  </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
