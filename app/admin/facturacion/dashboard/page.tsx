"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  CheckCircle2, 
  FileText,
  AlertOctagon,
  ArrowRight
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/services/api"
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts'
import { toast } from "sonner"
import { formatCurrency } from "@/lib/utils"
import { Loader2 } from "lucide-react"

export default function FacturacionDashboard() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    fetchDashboard()
  }, [])

  const fetchDashboard = async () => {
    try {
        // Asumiendo que tenemos este endpoint ya montado
      const res = await api.get("/admin/facturacion/dashboard")
      setData(res.data.data)
    } catch (err) {
      console.error(err)
      setError("Error cargando datos del dashboard")
      toast.error("Error al cargar el dashboard")
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
    </div>
  )
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>

  const { kpis, grafico, alertas } = data

  // Preparar datos para Recharts
  const chartData = (grafico?.meses || []).map((mes: number, i: number) => ({
    name: new Date(0, mes - 1).toLocaleString('es-ES', { month: 'short' }),
    total: grafico?.totales ? grafico.totales[i] : 0
  }))

  const safeKpis = kpis || { total_anual: 0, num_facturas: 0, total_anterior: 0, variacion_percent: 0 }

  return (
    <div className="space-y-6">
      
      {/* 1. KPIs Principales */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard 
          title="Facturación Anual"
          value={formatCurrency(safeKpis.total_anual)}
          icon={FileText}
          trend={safeKpis.variacion_percent}
          trendLabel="vs año anterior"
        />
        <KpiCard 
          title="Facturas Emitidas"
          value={safeKpis.num_facturas}
          icon={CheckCircle2}
          subtext="En el año actual"
        />
        {/* KPI Placeholder o saldo pendiente si tuviéramos */}
        <KpiCard 
          title="Facturación Mes Anterior"
          value={formatCurrency(safeKpis.total_anterior / 12)} // Dato aproximado si no viene del back
          icon={TrendingUp}
          subtext="Promedio mensual anterior"
        />
      </div>

      {/* 2. Sección Central: Gráfico + Alertas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Gráfico de Evolución */}
        <Card className="lg:col-span-2 shadow-sm border-slate-200">
          <CardHeader>
            <CardTitle>Evolución Mensual</CardTitle>
            <CardDescription>Facturación validada en el año en curso</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
             <div className="w-full h-full min-h-[300px]">
             {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis 
                        dataKey="name" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{fill: '#64748B', fontSize: 12}}
                        dy={10}
                    />
                    <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{fill: '#64748B', fontSize: 12}}
                        tickFormatter={(val) => `${val/1000}k`}
                    />
                    <Tooltip 
                        contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                        formatter={(value: any) => [formatCurrency(Number(value) || 0), 'Facturado']}
                    />
                    <Area 
                        type="monotone" 
                        dataKey="total" 
                        stroke="#2563eb" 
                        strokeWidth={3}
                        fillOpacity={1} 
                        fill="url(#colorTotal)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full w-full flex items-center justify-center text-slate-400 text-sm">
                   Sin datos de evolución disponibles
                </div>
              )}
             </div>
          </CardContent>
        </Card>

        {/* Panel de Alertas/Acciones */}
        <Card className="shadow-sm border-slate-200 bg-slate-50/50">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                    Avisos y Alertas
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {alertas && alertas.length > 0 ? (
                    alertas.map((alerta: any, i: number) => (
                        <div key={i} className={`p-4 rounded-lg text-sm border flex flex-col gap-2
                            ${alerta.tipo === 'error' ? 'bg-red-50 border-red-100 text-red-800' : ''}
                            ${alerta.tipo === 'warning' ? 'bg-amber-50 border-amber-100 text-amber-800' : ''}
                            ${alerta.tipo === 'info' ? 'bg-blue-50 border-blue-100 text-blue-800' : ''}
                        `}>
                            <div className="flex items-start gap-3">
                                {alerta.tipo === 'error' && <AlertOctagon className="w-5 h-5 shrink-0" />}
                                {alerta.tipo === 'warning' && <AlertTriangle className="w-5 h-5 shrink-0" />}
                                {alerta.tipo === 'info' && <FileText className="w-5 h-5 shrink-0" />}
                                <p className="font-medium">{alerta.mensaje}</p>
                            </div>
                            
                            {alerta.accion && (
                                <Button size="sm" variant="outline" className="self-end bg-white/50 border-0 hover:bg-white" asChild>
                                    <a href={alerta.accion.url}>
                                        {alerta.accion.texto} <ArrowRight className="w-3 h-3 ml-2" />
                                    </a>
                                </Button>
                            )}
                        </div>
                    ))
                ) : (
                    <div className="text-center py-10 text-slate-400">
                        <CheckCircle2 className="w-10 h-10 mx-auto mb-2 opacity-20" />
                        <p>Todo en orden. No hay alertas.</p>
                    </div>
                )}
            </CardContent>
        </Card>
      </div>

    </div>
  )
}

function KpiCard({ title, value, icon: Icon, trend, trendLabel, subtext }: any) {
    const isPositive = trend > 0
    
    return (
        <Card className="shadow-sm border-slate-200">
            <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                    <p className="text-sm font-medium text-slate-500">{title}</p>
                    <div className="p-2 bg-slate-100 rounded-full text-slate-600">
                        <Icon className="w-4 h-4" />
                    </div>
                </div>
                <div className="flex items-end justify-between">
                    <div>
                        <h3 className="text-2xl font-bold text-slate-900">{value}</h3>
                        {subtext && <p className="text-xs text-slate-400 mt-1">{subtext}</p>}
                    </div>
                    {trend !== undefined && trend !== null && (
                        <div className={`flex items-center text-xs font-semibold px-2 py-1 rounded-full
                            ${isPositive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}
                        `}>
                            {isPositive ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                            {Math.abs(trend).toFixed(1)}% {trendLabel}
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}

function DashboardSkeleton() {
    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Skeleton className="h-[350px] lg:col-span-2" />
                <Skeleton className="h-[350px]" />
            </div>
        </div>
    )
}
