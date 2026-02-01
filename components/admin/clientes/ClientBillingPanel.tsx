"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowUpRight, ArrowDownLeft, DollarSign, Wallet } from "lucide-react";

/* 
  Quick formatter if lib/utils doesn't have it or checking is too expensive. 
  But user probably wants me to use existing patterns. 
  I'll define a local one to be safe.
*/
function fmt(num: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(num);
}

export default function ClientBillingPanel({ clienteId }: { clienteId: string }) {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<any>(null);

  // Filtro de fechas (por defecto este año)
  const [year, setYear] = useState(new Date().getFullYear());

  async function loadStats() {
    setLoading(true);
    try {
        const token = localStorage.getItem("token");
        const from = `${year}-01-01`;
        const to = `${year}-12-31`;
        
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/billing/status?cliente_id=${clienteId}&desde=${from}&hasta=${to}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if(res.ok) {
            const data = await res.json();
            setStats(data);
        }
    } finally {
        setLoading(false);
    }
  }

  useEffect(() => {
    loadStats();
  }, [clienteId, year]);

  if (loading && !stats) return <div className="p-4 text-gray-400">Calculando finanzas...</div>;

  if (!stats) return null;

  const deuda = stats.saldo_pendiente_teorico;
  const isPositive = deuda > 0; // deuda positiva = cliente debe dinero

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Resumen Económico {year}</h3>
        <select 
            value={year} 
            onChange={e => setYear(Number(e.target.value))}
            className="border rounded p-1 text-sm bg-white"
        >
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Valor Generado */}
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Trabajo Realizado (Est.)</CardTitle>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{fmt(stats.total_valor_estimado)}</div>
                <p className="text-xs text-muted-foreground">Valor monetario de fichajes/logs</p>
            </CardContent>
        </Card>

        {/* Card 2: Pagos Recibidos */}
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pagos Recibidos</CardTitle>
                <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold text-green-600">{fmt(stats.total_pagado)}</div>
                <p className="text-xs text-muted-foreground">Ingresado en cuenta</p>
            </CardContent>
        </Card>

        {/* Card 3: Saldo (Deuda) */}
        <Card className={isPositive ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                    {isPositive ? "Saldo Pendiente (Deuda)" : "Saldo a favor"}
                </CardTitle>
                <DollarSign className={`h-4 w-4 ${isPositive ? 'text-red-500' : 'text-green-500'}`} />
            </CardHeader>
            <CardContent>
                <div className={`text-2xl font-bold ${isPositive ? 'text-red-600' : 'text-green-700'}`}>
                    {fmt(Math.abs(deuda))}
                </div>
                <p className="text-xs text-muted-foreground">
                    {isPositive ? "El cliente debe pagar esto" : "El cliente ha pagado de más"}
                </p>
            </CardContent>
        </Card>
      </div>

       <div className="bg-blue-50 p-3 rounded text-xs text-blue-700">
         Nota: El saldo pendiente se calcula como (Valor Trabajo [Horas * Tarifa Activa] - Pagos Recibidos).
       </div>
    </div>
  );
}
