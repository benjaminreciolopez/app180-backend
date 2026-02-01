"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Lock, Save, Edit2, X } from "lucide-react";
import { toast } from "sonner"; // Assuming sonner or simple alert

export default function ClientFiscalForm({ 
    data, 
    onSave 
}: { 
    data: any, 
    onSave: (newData: any) => Promise<void> 
}) {
  const [formData, setFormData] = useState<any>({});
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
        setFormData({ 
            razon_social: "",
            nif_cif: "",
            tipo_fiscal: "company",
            pais: "España",
            provincia: "",
            municipio: "",
            codigo_postal: "",
            direccion_fiscal: "",
            email_factura: "",
            telefono_factura: "",
            persona_contacto: "",
            iva_defecto: "21",
            exento_iva: false,
            forma_pago: "",
            iban: "",
            ...data // Overwrite defaults
        });
    }
  }, [data]);

  const handleChange = (field: string, value: any) => {
    setFormData((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    try {
        setSaving(true);
        await onSave(formData);
        setIsEditing(false);
        toast.success("Datos guardados");
    } catch(e) {
        toast.error("Error al guardar");
    } finally {
        setSaving(false);
    }
  };

  const handleCancel = () => {
    // Reset to original data
    setFormData({ ...data });
    setIsEditing(false);
  };

  return (
    <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
      <div className="flex justify-between items-center bg-gray-50 border-b px-4 py-3">
        <h3 className="font-semibold text-gray-700 flex items-center gap-2">
            {!isEditing && <Lock size={14} className="text-gray-400"/>}
            Datos Fiscales
        </h3>
        <div>
            {!isEditing ? (
                 <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                    <Edit2 size={14} className="mr-2"/> Modificar
                 </Button>
            ) : (
                <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={handleCancel} disabled={saving}>
                        <X size={14} /> 
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={saving}>
                        {saving ? "Guardando..." : <><Save size={14} className="mr-2"/> Guardar</>}
                    </Button>
                </div>
            )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
        { /* Common styling for inputs to handle disabled state nicely */ }
        <style jsx>{`
            input:disabled, select:disabled {
                background-color: #f9fafb;
                border-color: #e5e7eb;
                color: #374151;
            }
        `}</style>

      <div>
        <label className="block text-xs font-medium text-gray-500">Razón Social</label>
        <input 
          disabled={!isEditing}
          className="w-full border p-2 rounded" 
          value={formData.razon_social || ''} 
          onChange={e => handleChange('razon_social', e.target.value)} 
          placeholder={isEditing ? "Nombre legal completo" : "—"}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500">NIF / CIF</label>
        <input 
          disabled={!isEditing}
          className="w-full border p-2 rounded" 
          value={formData.nif_cif || ''} 
          onChange={e => handleChange('nif_cif', e.target.value)} 
          placeholder={isEditing ? "B12345678" : "—"}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500">Tipo</label>
        <select 
            disabled={!isEditing}
            className="w-full border p-2 rounded"
            value={formData.tipo_fiscal || 'company'}
            onChange={e => handleChange('tipo_fiscal', e.target.value)}
        >
            <option value="company">Empresa</option>
            <option value="personal">Autónomo / Particular</option>
        </select>
      </div>

      <div className="md:col-span-2 mt-2 pt-2 border-t">
        <h4 className="text-xs font-bold text-gray-400 uppercase">Dirección Fiscal</h4>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500">Dirección</label>
        <input 
            disabled={!isEditing}
          className="w-full border p-2 rounded" 
          value={formData.direccion_fiscal || ''} 
          onChange={e => handleChange('direccion_fiscal', e.target.value)} 
        />
      </div>
      
      <div>
        <label className="block text-xs font-medium text-gray-500">Código Postal</label>
        <input 
            disabled={!isEditing}
          className="w-full border p-2 rounded" 
          value={formData.codigo_postal || ''} 
          onChange={e => handleChange('codigo_postal', e.target.value)} 
        />
      </div>

       <div>
        <label className="block text-xs font-medium text-gray-500">Municipio</label>
        <input 
            disabled={!isEditing}
          className="w-full border p-2 rounded" 
          value={formData.municipio || ''} 
          onChange={e => handleChange('municipio', e.target.value)} 
        />
      </div>

       <div>
        <label className="block text-xs font-medium text-gray-500">Provincia</label>
        <input 
            disabled={!isEditing}
          className="w-full border p-2 rounded" 
          value={formData.provincia || ''} 
          onChange={e => handleChange('provincia', e.target.value)} 
        />
      </div>

      <div className="md:col-span-2 mt-2 pt-2 border-t">
        <h4 className="text-xs font-bold text-gray-400 uppercase">Facturación y Pagos</h4>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500">Email Facturación</label>
        <input 
            disabled={!isEditing}
          className="w-full border p-2 rounded" 
          value={formData.email_factura || ''} 
          onChange={e => handleChange('email_factura', e.target.value)} 
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500">IBAN</label>
        <input 
            disabled={!isEditing}
          className="w-full border p-2 rounded" 
          value={formData.iban || ''} 
          onChange={e => handleChange('iban', e.target.value)} 
          placeholder={isEditing ? "ES00..." : "—"}
        />
      </div>
    
      <div>
        <label className="block text-xs font-medium text-gray-500">IVA por defecto (%)</label>
        <input 
            disabled={!isEditing}
          type="number"
          className="w-full border p-2 rounded" 
          value={formData.iva_defecto || ''} 
          onChange={e => handleChange('iva_defecto', e.target.value)} 
        />
      </div>

       <div className="flex items-center gap-2 mt-6">
        <input 
            disabled={!isEditing}
          type="checkbox"
          id="exento"
          checked={formData.exento_iva === true} 
          onChange={e => handleChange('exento_iva', e.target.checked)} 
        />
        <label htmlFor="exento" className="text-sm">Exento de IVA</label>
      </div>

    </div>
    </div>
  );
}
