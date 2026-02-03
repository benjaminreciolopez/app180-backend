"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { 
  Plus, 
  Search, 
  Filter, 
  ArrowRight, 
  X, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  CreditCard,
  Banknote,
  Smartphone,
  MoreHorizontal,
  ArrowUpDown,
  Calendar as CalendarIcon,
  User,
  Loader2
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { api as apiService } from "@/services/api";
import { UniversalExportButton } from "@/components/shared/UniversalExportButton";

type TrabajoPendiente = {
    id: string;
    fecha: string;
    descripcion: string;
    valor: number;
    pagado: number;
    estado_pago: string;
};

type Payment = {
    id: string;
    cliente_id: string;
    cliente_nombre: string;
    importe: number;
    metodo: string;
    fecha_pago: string;
    referencia: string;
    notas: string;
    estado: string;
    created_at: string;
};

export default function GlobalPagosPage() {
  const router = useRouter();

  const [pagos, setPagos] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedClientFilter, setSelectedClientFilter] = useState("all");

  // New Payment Form
  const [newPay, setNewPay] = useState({
    cliente_id: "",
    importe: "",
    metodo: "transferencia",
    fecha_pago: new Date().toISOString().slice(0, 10),
    referencia: "",
    notas: ""
  });

  // Data for form
  const [clients, setClients] = useState<any[]>([]);
  const [pendientes, setPendientes] = useState<TrabajoPendiente[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Record<string, number>>({}); 

  const [submitting, setSubmitting] = useState(false);

  const loadPagos = useCallback(async () => {
    try {
        setLoading(true);
        const res = await apiService.get("/admin/payments");
        if(res.data) setPagos(res.data);
    } catch(e) {
        console.error(e);
        toast.error("Error al cargar los pagos");
    } finally {
        setLoading(false);
    }
  }, []);

  const loadClients = useCallback(async () => {
    try {
        const res = await apiService.get("/admin/clientes");
        if(res.data) setClients(res.data);
    } catch(e) {
        console.error(e);
    }
  }, []);

  useEffect(() => {
    loadPagos();
    loadClients();
  }, [loadPagos, loadClients]);

  const loadPendientes = async (clientId: string) => {
    if(!clientId) return;
    setLoadingItems(true);
    try {
        const res = await apiService.get(`/admin/clientes/${clientId}/trabajos-pendientes`);
        setPendientes(res.data || []);
        setSelectedItems({});
    } catch(e) {
        toast.error("Error cargando trabajos pendientes");
    } finally {
        setLoadingItems(false);
    }
  };

  useEffect(() => {
    if(newPay.cliente_id) {
        loadPendientes(newPay.cliente_id);
    }
  }, [newPay.cliente_id]);

  // Auto-distribute logic
  const autoDistribute = () => {
      const totalAmount = Number(newPay.importe);
      if(!totalAmount) return;

      let remaining = totalAmount;
      const newSelection: Record<string, number> = {};

      for(const item of pendientes) {
          if(remaining <= 0.01) break;
          
          const debt = Number(item.valor) - Number(item.pagado || 0);
          const pay = Math.min(remaining, debt);
          
          if (pay > 0) {
              newSelection[item.id] = Number(pay.toFixed(2));
              remaining -= pay;
          }
      }
      setSelectedItems(newSelection);
  };

  const currentAllocated = Object.values(selectedItems).reduce((a,b) => a+b, 0);

  async function handleCreatePayment() {
    if(!newPay.cliente_id) return toast.error("Selecciona un cliente");
    if(!newPay.importe || Number(newPay.importe) <= 0) return toast.error("Indica un importe válido");
    
    // Prepare Allocations
    const asignaciones = Object.entries(selectedItems).map(([work_log_id, importe]) => ({
        work_log_id,
        importe
    })).filter(x => x.importe > 0);

    const totalAllocated = asignaciones.reduce((a,b) => a + b.importe, 0);
    if(totalAllocated > Number(newPay.importe) + 0.05) { 
        return toast.error(`Has asignado más (${formatCurrency(totalAllocated)}) del importe del pago (${formatCurrency(Number(newPay.importe))})`);
    }

    setSubmitting(true);
    try {
        await apiService.post("/admin/pagos", {
            cliente_id: newPay.cliente_id,
            importe: Number(newPay.importe),
            metodo: newPay.metodo,
            fecha_pago: newPay.fecha_pago,
            referencia: newPay.referencia,
            notas: newPay.notas,
            asignaciones
        });
        toast.success("Pago registrado correctamente");
        setDrawerOpen(false);
        loadPagos();
        // Reset form
        setNewPay({ 
            cliente_id: "", 
            importe: "", 
            metodo: "transferencia", 
            fecha_pago: new Date().toISOString().slice(0, 10), 
            referencia: "", 
            notas: "" 
        });
        setSelectedItems({});
    } catch(e: any) {
        toast.error(e.response?.data?.error || "Error al registrar el pago");
    } finally {
        setSubmitting(false);
    }
  }

  const filteredPagos = pagos.filter(p => {
      const matchesSearch = p.cliente_nombre?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           p.referencia?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesClient = selectedClientFilter === "all" || p.cliente_id === selectedClientFilter;
      return matchesSearch && matchesClient;
  });

  const getMethodIcon = (method: string) => {
      switch(method) {
          case 'transferencia': return <CreditCard className="w-4 h-4" />;
          case 'efectivo': return <Banknote className="w-4 h-4" />;
          case 'bizum': return <Smartphone className="w-4 h-4" />;
          default: return <CreditCard className="w-4 h-4" />;
      }
  };

  return (
    <div className="space-y-6">
      
      {/* --- HEADER & FILTERS --- */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex items-center gap-4 w-full md:w-auto">
            <div className="relative flex-1 md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input 
                    placeholder="Buscar por cliente o referencia..." 
                    className="pl-10 bg-white border-slate-200"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
            <Select value={selectedClientFilter} onValueChange={setSelectedClientFilter}>
                <SelectTrigger className="w-[180px] bg-white border-slate-200">
                    <SelectValue placeholder="Filtrar por cliente" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">Todos los clientes</SelectItem>
                    {clients.map(c => (
                        <SelectItem key={c.id} value={c.id.toString()}>{c.nombre}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
        
        <div className="flex items-center gap-3 w-full md:w-auto">
            <UniversalExportButton 
                module="cobros" 
                queryParams={{}}
            />
            <Button 
                onClick={() => setDrawerOpen(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20 px-6"
            >
                <Plus className="w-4 h-4 mr-2" />
                Registrar Cobro
            </Button>
        </div>
      </div>

      {/* --- STATS SUMMARY (Visual Flair) --- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-white border-none shadow-sm overflow-hidden group">
              <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:scale-110 transition-transform">
                  <CreditCard className="w-12 h-12 text-blue-600" />
              </div>
              <CardContent className="p-6">
                  <p className="text-sm font-medium text-slate-500 mb-1">Total Cobrado (Mes)</p>
                  <h3 className="text-2xl font-bold text-slate-900">
                      {formatCurrency(pagos.reduce((acc, p) => {
                          const date = new Date(p.fecha_pago);
                          const now = new Date();
                          if(date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) {
                              return acc + Number(p.importe);
                          }
                          return acc;
                      }, 0))}
                  </h3>
              </CardContent>
          </Card>
          
          <Card className="bg-white border-none shadow-sm overflow-hidden group">
              <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:scale-110 transition-transform">
                  <Clock className="w-12 h-12 text-amber-500" />
              </div>
              <CardContent className="p-6">
                  <p className="text-sm font-medium text-slate-500 mb-1">Cobros Recientes</p>
                  <h3 className="text-2xl font-bold text-slate-900">
                      {pagos.slice(0, 5).length} <span className="text-sm font-normal text-slate-400">esta semana</span>
                  </h3>
              </CardContent>
          </Card>

          <Card className="bg-white border-none shadow-sm overflow-hidden group">
              <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:scale-110 transition-transform">
                  <User className="w-12 h-12 text-indigo-500" />
              </div>
              <CardContent className="p-6">
                  <p className="text-sm font-medium text-slate-500 mb-1">Clientes Activos</p>
                  <h3 className="text-2xl font-bold text-slate-900">
                      {new Set(pagos.map(p => p.cliente_id)).size} <span className="text-sm font-normal text-slate-400">con pagos</span>
                  </h3>
              </CardContent>
          </Card>
      </div>

      {/* --- LISTADO DE PAGOS --- */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="grid grid-cols-12 gap-4 p-4 border-b bg-slate-50/50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <div className="col-span-3">Cliente</div>
            <div className="col-span-2">Fecha</div>
            <div className="col-span-2">Método</div>
            <div className="col-span-3 text-right">Importe</div>
            <div className="col-span-2 text-right">Referencia</div>
        </div>

        {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                <p className="text-sm text-slate-500 animate-pulse">Cargando transacciones...</p>
            </div>
        ) : filteredPagos.length === 0 ? (
            <div className="p-20 text-center flex flex-col items-center justify-center gap-4">
                <div className="p-4 bg-slate-100 rounded-full">
                    <AlertCircle className="w-8 h-8 text-slate-400" />
                </div>
                <div>
                    <p className="text-lg font-semibold text-slate-900">No se encontraron cobros</p>
                    <p className="text-sm text-slate-500">Prueba a cambiar los filtros o registra un nuevo cobro.</p>
                </div>
            </div>
        ) : (
            <div className="divide-y divide-slate-100">
                <AnimatePresence>
                    {filteredPagos.map((pago, index) => (
                        <motion.div 
                            key={pago.id}
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.05 }}
                            className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-slate-50/80 transition-all group"
                        >
                            <div className="col-span-3 flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs">
                                    {pago.cliente_nombre?.charAt(0).toUpperCase()}
                                </div>
                                <div className="flex flex-col overflow-hidden">
                                    <span className="font-semibold text-slate-900 text-sm truncate">{pago.cliente_nombre}</span>
                                    <span className="text-[10px] text-slate-400 uppercase font-bold tracking-tight">ID: {pago.cliente_id}</span>
                                </div>
                            </div>
                            
                            <div className="col-span-2 text-sm text-slate-600">
                                {format(new Date(pago.fecha_pago), "d MMM yyyy", { locale: es })}
                            </div>

                            <div className="col-span-2">
                                <Badge variant="outline" className="capitalize text-[10px] font-medium py-0 px-2 flex items-center gap-1.5 w-fit border-slate-200">
                                    {getMethodIcon(pago.metodo)}
                                    {pago.metodo}
                                </Badge>
                            </div>

                            <div className="col-span-3 text-right">
                                <span className="font-bold text-slate-900 text-base">{formatCurrency(pago.importe)}</span>
                            </div>

                            <div className="col-span-2 text-right text-xs text-slate-400 font-mono truncate">
                                {pago.referencia || "—"}
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        )}
      </div>

      {/* --- REGISTRAR PAGO DRAWER --- */}
      <AnimatePresence>
        {drawerOpen && (
          <motion.div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-50 flex justify-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDrawerOpen(false)}
          >
            <motion.div
              className="bg-white w-full max-w-xl h-full flex flex-col shadow-2xl overflow-hidden relative"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="p-6 border-b flex items-center justify-between bg-slate-50/80">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-600 rounded-lg text-white">
                        <Banknote className="w-5 h-5" />
                    </div>
                    <h2 className="text-xl font-bold text-slate-900">Registrar Nuevo Cobro</h2>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setDrawerOpen(false)} className="rounded-full hover:bg-slate-200">
                  <X size={20} className="text-slate-500" />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                 
                 {/* 1. Selección de Cliente */}
                 <div className="space-y-3">
                    <label className="text-xs font-bold uppercase text-slate-400 tracking-wider">Paso 1: ¿De quién es el dinero?</label>
                    <Select value={newPay.cliente_id} onValueChange={(val) => setNewPay({...newPay, cliente_id: val})}>
                        <SelectTrigger className="w-full h-12 bg-white text-base">
                            <SelectValue placeholder="Selecciona el cliente..." />
                        </SelectTrigger>
                        <SelectContent className="max-h-80">
                            {clients.map(c => (
                                <SelectItem key={c.id} value={c.id.toString()} className="h-10">{c.nombre}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                 </div>

                 {/* 2. Datos del Cobro */}
                 <div className="space-y-3">
                    <label className="text-xs font-bold uppercase text-slate-400 tracking-wider">Paso 2: Detalles del cobro</label>
                    <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-slate-500">Importe (€)</label>
                            <Input 
                                type="number" 
                                className="h-10 font-bold text-lg focus:ring-blue-500 transition-all border-slate-200"
                                placeholder="0.00"
                                value={newPay.importe} 
                                onChange={e => setNewPay({...newPay, importe: e.target.value})}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-slate-500">Fecha Cobro</label>
                            <Input 
                                type="date" 
                                className="h-10 border-slate-200"
                                value={newPay.fecha_pago} 
                                onChange={e => setNewPay({...newPay, fecha_pago: e.target.value})}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-slate-500">Método</label>
                            <Select value={newPay.metodo} onValueChange={(v) => setNewPay({...newPay, metodo: v})}>
                                <SelectTrigger className="h-10 border-slate-200 bg-white">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="transferencia">Transferencia</SelectItem>
                                    <SelectItem value="efectivo">Efectivo</SelectItem>
                                    <SelectItem value="tarjeta">Tarjeta</SelectItem>
                                    <SelectItem value="bizum">Bizum</SelectItem>
                                    <SelectItem value="otro">Otro</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-slate-500">Referencia</label>
                            <Input 
                                placeholder="Ej. Fra. 2024/001"
                                className="h-10 border-slate-200"
                                value={newPay.referencia} 
                                onChange={e => setNewPay({...newPay, referencia: e.target.value})}
                            />
                        </div>
                    </div>
                 </div>

                 {/* 3. Imputación */}
                 <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase text-slate-400 tracking-wider">Paso 3: Imputar a trabajos</label>
                        <Button 
                            variant="link" 
                            size="sm" 
                            onClick={autoDistribute} 
                            disabled={!newPay.importe || pendientes.length === 0}
                            className="text-blue-600 h-auto p-0 text-xs font-bold uppercase"
                        >
                            Auto-distribuir
                        </Button>
                    </div>

                    <div className="bg-slate-50 rounded-xl border border-slate-100 min-h-32 flex flex-col p-2">
                        {loadingItems ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-8 gap-2">
                                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                                <span className="text-xs text-slate-400">Verificando deuda...</span>
                            </div>
                        ) : !newPay.cliente_id ? (
                            <div className="flex-1 flex items-center justify-center p-8 text-slate-400 text-sm italic">
                                Selecciona un cliente primero
                            </div>
                        ) : pendientes.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
                                <CheckCircle2 className="w-8 h-8 mb-2 opacity-20 text-green-500" />
                                <p className="text-sm">No hay trabajos con saldo pendiente</p>
                            </div>
                        ) : (
                            <div className="space-y-2 max-h-80 overflow-y-auto p-2">
                                {pendientes.map(item => {
                                    const debt = Number(item.valor) - Number(item.pagado || 0);
                                    const isSelected = selectedItems[item.id] !== undefined;
                                    
                                    return (
                                        <div 
                                            key={item.id} 
                                            className={`
                                                p-3 rounded-lg border text-sm flex items-center gap-3 transition-all cursor-pointer
                                                ${isSelected ? "bg-white border-blue-500 shadow-sm ring-1 ring-blue-500/10" : "bg-white border-slate-200 opacity-70 hover:opacity-100"}
                                            `}
                                            onClick={() => {
                                                if(isSelected) {
                                                    const copy = {...selectedItems};
                                                    delete copy[item.id];
                                                    setSelectedItems(copy);
                                                } else {
                                                    const totalPay = Number(newPay.importe);
                                                    const alreadyAllocated = Object.values(selectedItems).reduce((a,b) => a+b, 0);
                                                    const remainingCapacity = Math.max(0, totalPay - alreadyAllocated);
                                                    const amountToAssign = Math.min(debt, remainingCapacity);
                                                    setSelectedItems(prev => ({ ...prev, [item.id]: Number(amountToAssign.toFixed(2)) }))
                                                }
                                            }}
                                        >
                                            <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${isSelected ? "bg-blue-600 border-blue-600" : "bg-slate-50 border-slate-300"}`}>
                                                {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                                            </div>
                                            <div className="flex-1">
                                                <div className="font-semibold text-slate-800">{item.descripcion}</div>
                                                <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5">
                                                    <CalendarIcon className="w-3 h-3" />
                                                    {format(new Date(item.fecha), "d MMM yyyy", { locale: es })}
                                                    <span className="text-slate-200">|</span>
                                                    <span className="text-red-500 font-bold uppercase tracking-tight">Deuda: {formatCurrency(debt)}</span>
                                                </div>
                                            </div>
                                            {isSelected && (
                                                <div className="w-24 active:scale-95 transition-transform" onClick={e => e.stopPropagation()}>
                                                    <Input 
                                                        type="number" 
                                                        className="h-8 text-right bg-blue-50/50 border-blue-200 text-xs font-bold text-blue-600"
                                                        value={selectedItems[item.id]}
                                                        onChange={e => {
                                                            const val = Number(e.target.value);
                                                            setSelectedItems(prev => ({...prev, [item.id]: val}));
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
                 </div>

              </div>

              {/* Botonera Float */}
              <div className="p-6 border-t bg-slate-50 flex flex-col gap-4">
                  <div className="flex items-center justify-between text-sm">
                      <div className="flex flex-col">
                          <span className="text-slate-400 text-xs font-bold uppercase">Restante por asignar</span>
                          <span className={`${(Number(newPay.importe) - currentAllocated) < 0 ? 'text-red-600' : 'text-slate-900'} font-bold text-lg`}>
                              {formatCurrency(Math.max(0, Number(newPay.importe) - currentAllocated))}
                          </span>
                      </div>
                      <div className="text-right">
                          <span className="text-slate-400 text-xs font-bold uppercase">Total Cobro</span>
                          <span className="block text-slate-900 font-bold text-lg">{formatCurrency(Number(newPay.importe) || 0)}</span>
                      </div>
                  </div>
                  
                  <Button 
                    onClick={handleCreatePayment} 
                    className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-500/20"
                    disabled={submitting || !newPay.cliente_id || Number(newPay.importe) <= 0}
                  >
                    {submitting ? (
                        <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            PROCESANDO...
                        </>
                    ) : (
                        <>
                            CONFIRMAR Y REGISTRAR COBRO
                            <ArrowRight className="w-4 h-4 ml-2" />
                        </>
                    )}
                  </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
