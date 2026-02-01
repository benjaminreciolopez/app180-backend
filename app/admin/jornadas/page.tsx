"use client";

import { useState } from "react";
import PlantillasPanel from "./PlantillasPanel";
import PlantillasAsignacionPanel from "./PlantillasAsignacionPanel";
import ClientesAsignacionPanel from "./ClientesAsignacionPanel";
import PreviewPanel from "./PreviewPanel";

type Tab = "plantillas" | "asignar_horarios" | "asignar_clientes" | "preview";

export default function JornadasPage() {
  const [tab, setTab] = useState<Tab>("plantillas");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Jornadas y Asignaciones</h1>

        <div className="flex gap-2 flex-wrap">
          <button
            className={`px-3 py-2 rounded text-sm font-medium ${
              tab === "plantillas" ? "bg-blue-600 text-white" : "bg-gray-100 hover:bg-gray-200"
            }`}
            onClick={() => setTab("plantillas")}
          >
            Edición Plantillas
          </button>
          
          <button
            className={`px-3 py-2 rounded text-sm font-medium ${
              tab === "asignar_horarios" ? "bg-indigo-600 text-white" : "bg-gray-100 hover:bg-gray-200"
            }`}
            onClick={() => setTab("asignar_horarios")}
          >
             Asignar Horarios
          </button>

          <button
            className={`px-3 py-2 rounded text-sm font-medium ${
              tab === "asignar_clientes" ? "bg-emerald-600 text-white" : "bg-gray-100 hover:bg-gray-200"
            }`}
            onClick={() => setTab("asignar_clientes")}
          >
             Asignar Clientes
          </button>

          <button
            className={`px-3 py-2 rounded text-sm font-medium ${
              tab === "preview" ? "bg-purple-600 text-white" : "bg-gray-100 hover:bg-gray-200"
            }`}
            onClick={() => setTab("preview")}
          >
            Vista Previa
          </button>
        </div>
      </div>

      <div className="min-h-[400px]">
        {tab === "plantillas" && <PlantillasPanel />}
        {tab === "asignar_horarios" && <PlantillasAsignacionPanel />}
        {tab === "asignar_clientes" && <ClientesAsignacionPanel />}
        {tab === "preview" && <PreviewPanel />}
      </div>
    </div>
  );
}
