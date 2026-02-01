"use client"

import { useState, useEffect } from "react"
import { api } from "@/services/api"
import { formatCurrency } from "@/lib/utils"
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription 
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table"
import { toast } from "sonner"
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts'
import { FileText, Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function InformesPage() {
  const [activeTab, setActiveTab] = useState("iva")
  const [loading, setLoading] = useState(false)
  
  // Data States
  const [ivaData, setIvaData] = useState<any>(null)
  const [anualData, setAnualData] = useState<any>(null)
  const [clientesData, setClientesData] = useState<any[]>([])

  useEffect(() => {
    loadData(activeTab)
  }, [activeTab])

  const currentYear = new Date().getFullYear()

  async function loadData(tab: string) {
    setLoading(true)
    try {
      if (tab === "iva" && !ivaData) {
        // Ahora devuelve un objeto { "1T": {...}, ... }
        const res = await api.get(`/admin/facturacion/informes/iva-trimestral?year=${currentYear}`)
        setIvaData(res.data.data)
      } else if (tab === "anual" && !anualData) {
        const res = await api.get(`/admin/facturacion/informes/anual?year=${currentYear}`)
        setAnualData(res.data.data)
      } else if (tab === "clientes" && clientesData.length === 0) {
        const res = await api.get(`/admin/facturacion/informes/ranking-clientes?year=${currentYear}`)
        setClientesData(res.data.data)
      }
    } catch (error) {
      console.error("Error loading report:", error)
      toast.error("Error al cargar los datos del informe")
    } finally {
      setLoading(false)
    }
  }

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
           <h1 className="text-2xl font-bold tracking-tight">Informes</h1>
           <p className="text-slate-500">Análisis fiscal y rendimiento comercial.</p>
        </div>
        {/* Futuro: Botón exportar informe actual */}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="iva">IVA Trimestral</TabsTrigger>
          <TabsTrigger value="anual">Facturación Anual</TabsTrigger>
          <TabsTrigger value="clientes">Top Clientes</TabsTrigger>
        </TabsList>

        {/* --- TAB 1: IVA TRIMESTRAL --- */}
        <TabsContent value="iva" className="space-y-4">
          {loading && !ivaData ? (
             <LoadingState />
          ) : (
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {['1T', '2T', '3T', '4T'].map((t) => {
                    const datosT = ivaData?.[t] || { base: 0, iva: 0, total: 0 }
                    return (
                        <Card key={t}>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-slate-500">Trimestre {t}</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{formatCurrency(datosT.iva)}</div>
                                <p className="text-xs text-slate-500">IVA Repercutido</p>
                                <div className="mt-3 text-xs border-t pt-2 space-y-1">
                                    <div className="flex justify-between">
                                        <span>Base:</span>
                                        <span className="font-mono">{formatCurrency(datosT.base)}</span>
                                    </div>
                                    <div className="flex justify-between font-semibold text-slate-700">
                                        <span>Total:</span>
                                        <span className="font-mono">{formatCurrency(datosT.total)}</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )
                })}
             </div>
          )}
        </TabsContent>

        {/* --- TAB 2: ANUAL --- */}
        <TabsContent value="anual">
          <Card>
            <CardHeader>
                <CardTitle>Evolución Anual</CardTitle>
                <CardDescription>Comparativa mensual de base imponible.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="w-full h-[400px] min-h-[400px]">
                {loading && !anualData ? <LoadingState /> : (
                    <ResponsiveContainer width="100%" height="100%" minHeight={400}>
                        <BarChart data={
                            (Array.isArray(anualData) ? anualData : []).map((item: any) => ({
                                name: new Date(0, item.mes - 1).toLocaleString('es-ES', { month: 'short' }),
                                total: parseFloat(item.base || 0)
                            }))
                        }>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                            <YAxis 
                                fontSize={12} 
                                tickLine={false} 
                                axisLine={false}
                                tickFormatter={(val) => `${val/1000}k`} 
                            />
                            <Tooltip 
                                cursor={{fill: '#f1f5f9'}}
                                contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                                formatter={(val: any) => [formatCurrency(val), 'Base Imponible']}
                            />
                            <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                )}
                </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- TAB 3: CLIENTES --- */}
        <TabsContent value="clientes" className="space-y-4">
             <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Tabla */}
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle>Ranking de Clientes</CardTitle>
                        <CardDescription>Clientes con mayor volumen de facturación este año.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {loading && !clientesData.length ? <LoadingState /> : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Cliente</TableHead>
                                        <TableHead>NIF</TableHead>
                                        <TableHead className="text-right">Nº Facturas</TableHead>
                                        <TableHead className="text-right">Total Facturado</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {clientesData.map((c: any) => (
                                        <TableRow key={c.id}>
                                            <TableCell className="font-medium">{c.nombre}</TableCell>
                                            <TableCell className="text-slate-500 text-xs">{(c.nif || c.nif_cif) || '—'}</TableCell>
                                            <TableCell className="text-right">{c.num_facturas}</TableCell>
                                            <TableCell className="text-right font-bold text-slate-700">
                                                {formatCurrency(Number(c.total_facturado))}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {!clientesData.length && (
                                        <TableRow>
                                            <TableCell colSpan={4} className="text-center py-8 text-slate-500">
                                                No hay datos disponibles
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>

                {/* Grafico Circular */}
                <Card>
                    <CardHeader>
                        <CardTitle>Distribución</CardTitle>
                    </CardHeader>
                    <CardContent>
                         <div className="w-full h-[300px] min-h-[300px]">
                         {loading && !clientesData.length ? <LoadingState /> : (
                            <ResponsiveContainer width="100%" height="100%" minHeight={300}>
                                <PieChart>
                                    <Pie
                                        data={clientesData.slice(0, 5)}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={5}
                                        dataKey="total_facturado"
                                    >
                                        {clientesData.slice(0, 5).map((entry: any, index: number) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip formatter={(val:any) => formatCurrency(val)} />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                         )}
                         </div>
                    </CardContent>
                </Card>
             </div>
        </TabsContent>
        
      </Tabs>
    </div>
  )
}

function LoadingState() {
    return (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin mb-2" />
            <p>Cargando datos...</p>
        </div>
    )
}
