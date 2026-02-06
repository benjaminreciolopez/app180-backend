"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CreditCard, FileText, Settings } from "lucide-react";
import ClientFiscalForm from "@/components/admin/clientes/ClientFiscalForm";

/* =====================================================
   Types
===================================================== */

type Cliente = {
  id: string;
  nombre: string;
  codigo?: string | null;
  tipo: string;
  activo: boolean;

  direccion?: string | null;
  telefono?: string | null;

  contacto_nombre?: string | null;
  contacto_email?: string | null;

  modo_defecto?: string | null;
  requiere_geo: boolean;
  geo_policy?: string | null;

  razon_social?: string | null;
  nif_cif?: string | null;
  iva_defecto?: string | null;
  iban?: string | null;

  notas?: string | null;
};

/* =====================================================
   API helper
===================================================== */

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

/* =====================================================
   Page
===================================================== */

export default function ClienteDetailPage() {
  const params = useParams();
  const router = useRouter();

  const id = params?.id as string;

  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'fiscal'>('general');

  /* =========================
     Load
  ========================= */

  async function load() {
    try {
      setLoading(true);
      const data = await api(`/admin/clientes/${id}`);
      setCliente(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (id) load();
  }, [id]);

  /* ===================================================== */

  if (loading) {
    return <div className="p-6">Cargando cliente…</div>;
  }

  if (error) {
    return <div className="p-6 text-red-600">{error}</div>;
  }

  if (!cliente) {
    return <div className="p-6">Cliente no encontrado</div>;
  }

  /* ===================================================== */

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => router.push("/admin/clientes")}>
          <ArrowLeft size={18} />
        </Button>

        <div className="flex-1">
          <h1 className="text-2xl font-semibold flex items-center gap-3">
            {cliente.nombre}

            {!cliente.activo && (
              <span className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded">
                Inactivo
              </span>
            )}
          </h1>

          {cliente.codigo && (
            <p className="text-sm text-slate-500">Código: {cliente.codigo}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => router.push(`/admin/clientes/${id}/tarifas`)}
            className="gap-2"
          >
            <FileText size={16} /> Tarifas
          </Button>

          <Button
            variant="outline"
            onClick={() => router.push(`/admin/clientes/${id}/pagos`)}
            className="gap-2"
          >
            <CreditCard size={16} /> Pagos
          </Button>

          <Button
            variant="outline"
            onClick={() => router.push(`/admin/clientes/${id}/edit`)}
            className="gap-2"
          >
            <Settings size={16} /> Editar
          </Button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="border-b flex gap-6 text-sm font-medium text-gray-500">
        <button 
            className={`pb-3 border-b-2 transition-colors ${activeTab === 'general' ? 'border-black text-black' : 'border-transparent hover:text-gray-700'}`}
            onClick={() => setActiveTab('general')}
        >
            General
        </button>
        <button 
            className={`pb-3 border-b-2 transition-colors ${activeTab === 'fiscal' ? 'border-black text-black' : 'border-transparent hover:text-gray-700'}`}
            onClick={() => setActiveTab('fiscal')}
        >
            Datos Fiscales
        </button>
      </div>

      {/* Content */}
      <div className="min-h-[400px]">
        {activeTab === 'general' && (
            <div className="space-y-6 fade-in">
                 <Card className="rounded-2xl">
                    <CardContent className="p-5 grid md:grid-cols-2 gap-4 text-sm">
                    <Info label="Tipo" value={cliente.tipo} />
                    <Info label="Modo defecto" value={cliente.modo_defecto} />

                    <Info label="Dirección" value={cliente.direccion} />
                    <Info label="Teléfono" value={cliente.telefono} />

                    <Info label="Contacto" value={cliente.contacto_nombre} />
                    <Info label="Email contacto" value={cliente.contacto_email} />

                    <Info
                        label="Requiere geo"
                        value={cliente.requiere_geo ? "Sí" : "No"}
                    />
                    <Info label="Geo policy" value={cliente.geo_policy} />
                    </CardContent>
                </Card>

                {cliente.notas && (
                    <Card className="rounded-2xl">
                    <CardContent className="p-5">
                        <h3 className="font-semibold mb-2">Notas</h3>
                        <p className="text-sm text-slate-700 whitespace-pre-wrap">
                        {cliente.notas}
                        </p>
                    </CardContent>
                    </Card>
                )}
            </div>
        )}

        {activeTab === 'fiscal' && (
             <div className="fade-in">
                <ClientFiscalForm 
                    data={cliente} 
                    onSave={async (newData) => {
                        await api(`/admin/clientes/${id}`, {
                            method: "PATCH",
                            body: JSON.stringify(newData)
                        });
                        load(); // Reload to confirm
                    }} 
                />
             </div>
        )}
      </div>

    </div>
  );
}

/* =====================================================
   Helper component
===================================================== */

function Info({ label, value }: { label: string; value?: any }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="font-medium">
        {value !== null && value !== undefined && value !== "" ? value : "—"}
      </p>
    </div>
  );
}
