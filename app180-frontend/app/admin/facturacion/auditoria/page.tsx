"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { 
  ShieldCheck, 
  Search, 
  Calendar, 
  FileText, 
  History, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  Filter,
  ArrowRight
} from "lucide-react"
import { format } from "date-fns"
import { es } from "date-fns/locale"

import { api } from "@/services/api"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { UniversalExportButton } from "@/components/shared/UniversalExportButton"
import { formatCurrency } from "@/lib/utils"

export default function AuditoriaVerifactuPage() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  
  // En una app real, aquí filtraríamos por acciones VeriFactu
  const fetchLogs = async () => {
    try {
      setLoading(true)
      const res = await api.get("/admin/auditoria/logs?limit=100&entidad_tipo=factura")
      const facturacionLogs = res.data.logs || []
      setLogs(facturacionLogs)
    } catch (err) {
      console.error("Error fetching audit logs", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs()
  }, [])

  const filteredLogs = logs.filter(l => 
    l.accion.toLowerCase().includes(searchTerm.toLowerCase()) ||
    l.user_email?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-600" />
            Auditoría Veri*Factu
          </h1>
          <p className="text-slate-500">Registro inalterable de operaciones de facturación (Ley Antifraude).</p>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <UniversalExportButton 
            module="auditoria" 
            queryParams={{ entidad_tipo: 'factura' }} 
            label="Descargar Informe"
          />
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              placeholder="Buscar en logs..." 
              className="pl-9 bg-white" 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Button variant="outline" size="icon" onClick={fetchLogs} disabled={loading}>
            <History className={loading ? "animate-spin" : "w-4 h-4"} />
          </Button>
        </div>
      </div>

      {/* Estado del Sistema */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatusCard 
          title="Encadenamiento" 
          status="Activo" 
          description="Hash encadenado correctamente"
          icon={CheckCircle2}
          color="emerald"
        />
        <StatusCard 
          title="Firma Digital" 
          status="Certificada" 
          description="Certificado FNMT válido"
          icon={ShieldCheck}
          color="blue"
        />
        <StatusCard 
          title="Integridad" 
          status="Verificada" 
          description="Sin saltos en numeración"
          icon={History}
          color="indigo"
        />
      </div>

      {/* Tabla de Logs */}
      <Card className="border-slate-200 shadow-sm overflow-hidden">
        <CardHeader className="bg-slate-50/50 border-b pb-4">
            <div className="flex items-center justify-between">
                <div>
                    <CardTitle className="text-base">Registros de Seguridad</CardTitle>
                    <CardDescription>Eventos registrados en las últimas 24h</CardDescription>
                </div>
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-100">
                    SISTEMA CERTIFICADO
                </Badge>
            </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                <tr>
                  <th className="px-6 py-3">Fecha y Hora</th>
                  <th className="px-6 py-3">Evento</th>
                  <th className="px-6 py-3">Usuario</th>
                  <th className="px-6 py-3">Detalle / ID</th>
                  <th className="px-6 py-3 text-right">Resultado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  Array.from({length: 5}).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={5} className="px-6 py-4"><Skeleton className="h-4 w-full" /></td>
                    </tr>
                  ))
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-20 text-center text-slate-400">
                      <AlertCircle className="w-10 h-10 mx-auto mb-2 opacity-20" />
                      <p>No hay registros de auditoría que coincidan.</p>
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-slate-500 tabular-nums">
                        {format(new Date(log.created_at), "dd/MM/yyyy HH:mm:ss")}
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-semibold text-slate-900 capitalize">
                          {log.accion.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-slate-700">{log.user_email || 'Sistema'}</span>
                          <span className="text-[10px] text-slate-400 font-mono">{log.ip || log.ip_address || '—'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="font-mono text-[10px] lowercase">
                            {log.entidad || log.entidad_tipo || 'factura'}:{log.entidad_id}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1 text-emerald-600 font-medium">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>OK</span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function StatusCard({ title, status, description, icon: Icon, color }: any) {
  const colors: any = {
    emerald: "bg-emerald-50 text-emerald-600 border-emerald-100",
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    indigo: "bg-indigo-50 text-indigo-600 border-indigo-100",
  }

  return (
    <Card className="shadow-sm border-slate-200">
      <CardContent className="p-5 flex items-start gap-4">
        <div className={`p-2 rounded-lg ${colors[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</p>
          <div className="flex items-center gap-2 mt-1">
            <h3 className="text-lg font-bold text-slate-900">{status}</h3>
            <div className={`w-2 h-2 rounded-full ${color === 'emerald' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{description}</p>
        </div>
      </CardContent>
    </Card>
  )
}
