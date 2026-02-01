"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import { showSuccess, showError } from "@/lib/toast";
import { Edit2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import EmailConfigPanel from "@/components/admin/EmailConfigPanel";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

type ProfileData = {
  nombre_fiscal: string;
  cif: string;
  direccion: string;
  poblacion: string;
  provincia: string;
  cp: string;
  pais: string;
  telefono: string;
  email: string;
  web: string;
};

export default function AdminPerfilPage() {
  const [data, setData] = useState<ProfileData>({
    nombre_fiscal: "",
    cif: "",
    direccion: "",
    poblacion: "",
    provincia: "",
    cp: "",
    pais: "España",
    telefono: "",
    email: "",
    web: "",
  });
  const [originalData, setOriginalData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const res = await api.get("/perfil");
      if (res.data) {
        const d = res.data;
        const profileData = {
          nombre_fiscal: d.nombre_fiscal || "",
          cif: d.cif || "",
          direccion: d.direccion || "",
          poblacion: d.poblacion || "",
          provincia: d.provincia || "",
          cp: d.cp || "",
          pais: d.pais || "España",
          telefono: d.telefono || "",
          email: d.email || "",
          web: d.web || "",
        };
        setData(profileData);
        setOriginalData(profileData);
      }
    } catch (err) {
      console.error(err);
      showError("Error al cargar el perfil");
    } finally {
      setLoading(false);
    }
  }

  function handleEdit() {
    setIsEditing(true);
  }

  function handleCancel() {
    if (originalData) {
      setData(originalData);
    }
    setIsEditing(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return; // Prevent double-click
    setSaving(true);
    
    try {
      await api.post("/perfil", data);
      setOriginalData(data); // Update original data
      setIsEditing(false);
      showSuccess("Perfil actualizado correctamente");
    } catch (err) {
      console.error(err);
      showError("Error al guardar el perfil");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="app-main max-w-4xl pb-20">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Perfil de Facturación</h1>
          <p className="text-gray-500">
            Estos datos aparecerán como emisor en las facturas y documentos.
          </p>
        </div>
        
        {!isEditing && (
          <Button
            onClick={handleEdit}
            className="flex items-center gap-2"
          >
            <Edit2 className="w-4 h-4" />
            Editar Perfil
          </Button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="card grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Identificación */}
        <div className="md:col-span-2">
          <h3 className="text-sm font-semibold text-gray-900 border-b pb-2 mb-3 mt-1">Identificación Fiscal</h3>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Razón Social / Nombre</label>
          <input
            type="text"
            className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-600 disabled:cursor-not-allowed"
            value={data.nombre_fiscal}
            onChange={(e) => setData({ ...data, nombre_fiscal: e.target.value })}
            placeholder="Ej: Mi Empresa S.L."
            disabled={!isEditing}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">CIF / NIF</label>
          <input
            type="text"
            className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-600 disabled:cursor-not-allowed"
            value={data.cif}
            onChange={(e) => setData({ ...data, cif: e.target.value })}
            placeholder="Ej: B12345678"
            disabled={!isEditing}
          />
        </div>

        {/* Contacto */}
        <div className="md:col-span-2">
          <h3 className="text-sm font-semibold text-gray-900 border-b pb-2 mb-3 mt-4">Contacto</h3>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Email Facturación</label>
          <input
            type="email"
            className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-600 disabled:cursor-not-allowed"
            value={data.email}
            onChange={(e) => setData({ ...data, email: e.target.value })}
            disabled={!isEditing}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Teléfono</label>
          <input
            type="tel"
            className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-600 disabled:cursor-not-allowed"
            value={data.telefono}
            onChange={(e) => setData({ ...data, telefono: e.target.value })}
            disabled={!isEditing}
          />
        </div>

        <div className="space-y-1 md:col-span-2">
          <label className="text-xs font-medium text-gray-500">Web</label>
          <input
            type="url"
            className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-600 disabled:cursor-not-allowed"
            value={data.web}
            onChange={(e) => setData({ ...data, web: e.target.value })}
            placeholder="https://..."
            disabled={!isEditing}
          />
        </div>

        {/* Dirección */}
        <div className="md:col-span-2">
          <h3 className="text-sm font-semibold text-gray-900 border-b pb-2 mb-3 mt-4">Dirección Fiscal</h3>
        </div>

        <div className="space-y-1 md:col-span-2">
          <label className="text-xs font-medium text-gray-500">Dirección</label>
          <input
            type="text"
            className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-600 disabled:cursor-not-allowed"
            value={data.direccion}
            onChange={(e) => setData({ ...data, direccion: e.target.value })}
            placeholder="Calle, número, piso..."
            disabled={!isEditing}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Código Postal</label>
          <input
            type="text"
            className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-600 disabled:cursor-not-allowed"
            value={data.cp}
            onChange={(e) => setData({ ...data, cp: e.target.value })}
            disabled={!isEditing}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Población</label>
          <input
            type="text"
            className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-600 disabled:cursor-not-allowed"
            value={data.poblacion}
            onChange={(e) => setData({ ...data, poblacion: e.target.value })}
            disabled={!isEditing}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Provincia</label>
          <input
            type="text"
            className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-600 disabled:cursor-not-allowed"
            value={data.provincia}
            onChange={(e) => setData({ ...data, provincia: e.target.value })}
            disabled={!isEditing}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">País</label>
          <input
            type="text"
            className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-600 disabled:cursor-not-allowed"
            value={data.pais}
            onChange={(e) => setData({ ...data, pais: e.target.value })}
            disabled={!isEditing}
          />
        </div>

        {/* Configuración de Email */}
        <div className="md:col-span-2">
          <h3 className="text-sm font-semibold text-gray-900 border-b pb-2 mb-3 mt-4">Configuración de Email</h3>
        </div>

        <div className="md:col-span-2">
          <EmailConfigPanel />
        </div>

        {/* Botones */}
        {isEditing && (
          <div className="md:col-span-2 pt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleCancel}
              disabled={saving}
              className="flex items-center gap-2"
            >
              <X className="w-4 h-4" />
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {saving ? "Guardando..." : "Guardar Cambios"}
            </Button>
          </div>
        )}

      </form>
    </div>
  );
}
