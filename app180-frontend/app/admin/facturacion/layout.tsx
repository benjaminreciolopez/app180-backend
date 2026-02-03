"use client"

import { usePathname, useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { 
  CreditCard, 
  BarChart3, 
  FileText, 
  Settings, 
  PlusCircle, 
  PieChart,
  Tag,
  BookOpen,
  HardDrive,
  ShieldCheck
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export default function FacturacionLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()

  const tabs = [
    {
      label: "Dashboard",
      icon: BarChart3,
      href: "/admin/facturacion/dashboard",
      active: pathname.includes("/dashboard"),
    },
    {
      label: "Facturas",
      icon: FileText,
      href: "/admin/facturacion/listado",
      active: pathname.includes("/listado") || pathname === "/admin/facturacion",
    },
    {
      label: "Conceptos",
      icon: BookOpen,
      href: "/admin/facturacion/conceptos",
      active: pathname.includes("/conceptos"),
    },
    {
      label: "Informes",
      icon: PieChart,
      href: "/admin/facturacion/informes",
      active: pathname.includes("/informes"),
    },
    {
      label: "Auditoría Veri*Factu",
      icon: ShieldCheck,
      href: "/admin/facturacion/auditoria",
      active: pathname.includes("/auditoria"),
    },
    {
      label: "Configuración",
      icon: Settings,
      href: "/admin/facturacion/configuracion",
      active: pathname.includes("/configuracion"),
    },
    {
      label: "Almacenamiento",
      icon: HardDrive,
      href: "/admin/facturacion/almacenamiento",
      active: pathname.includes("/almacenamiento"),
    },
  ]

  return (
    <div className="flex flex-col h-full bg-slate-50/50">
      {/* Header específico del módulo */}
      <header className="border-b bg-white px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <div className="p-2 bg-blue-600 rounded-lg text-white shadow-lg shadow-blue-500/20">
            <CreditCard className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Facturación</h1>
            <p className="text-xs text-slate-500 font-medium">Gestión integral y verifactu</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
            <Button 
              onClick={() => router.push("/admin/facturacion/crear")}
              className="bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 transition-all hover:scale-105 active:scale-95"
            >
              <PlusCircle className="w-4 h-4 mr-2" />
              Nueva Factura
            </Button>
        </div>
      </header>

      {/* Sub-navegación estilo pestañas */}
      <div className="px-6 pt-4 border-b bg-white">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {tabs.map((tab) => (
            <button
              key={tab.href}
              onClick={() => router.push(tab.href)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                tab.active
                  ? "border-blue-600 text-blue-600 bg-blue-50/50"
                  : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              )}
            >
              <tab.icon className={cn("w-4 h-4", tab.active ? "text-blue-600" : "text-slate-400")} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Área de contenido */}
      <main className="flex-1 p-6 overflow-y-auto">
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
        >
            {children}
        </motion.div>
      </main>
    </div>
  )
}
