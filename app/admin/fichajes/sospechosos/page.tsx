"use client";
import { useEffect, useState } from "react";
import { api, setAuthToken } from "@/services/api";
import "leaflet/dist/leaflet.css";
import { showSuccess, showError } from "@/lib/toast";
import { UniversalExportButton } from "@/components/shared/UniversalExportButton";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

type FichajeRow = {
  id: string;
  nombre_empleado: string;
  fecha: string;
  tipo: string;
  
  // Legacy
  sospecha_motivo?: string | null;
  direccion?: string | null;
  ciudad?: string | null;
  pais?: string | null;

  // New Geo
  geo_direccion?: any;
  geo_motivos?: string[];
  geo_sospechoso?: boolean;
  distancia_km?: number;
  ip_info?: any;

  // Client Data (for map)
  nombre_cliente?: string;
  cliente_lat?: string | number;
  cliente_lng?: string | number;
  cliente_radio?: number; // meters
};

export default function SospechososPage() {
  const [fichajes, setFichajes] = useState<FichajeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<FichajeRow | null>(null);

  // Bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    setAuthToken(token);
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/fichajes/sospechosos");
      setFichajes(res.data || []);
    } catch (e) {
      console.error("Error cargando sospechosos", e);
      setFichajes([]);
    } finally {
      setLoading(false);
    }
  }

  async function verDetalle(id: string) {
    const found = fichajes.find((f) => f.id === id);
    if (found) {
      setDetalle(found);
      setSelectedId(id);
    }
  }

  async function validar(id: string, accion: "confirmar" | "rechazar") {
    try {
      await api.patch(`/fichajes/sospechosos/${id}`, { accion });
      await load();
      if (selectedId === id) {
        setSelectedId(null);
        setDetalle(null);
      }
    } catch (e) {
      console.error(e);
      showError('Error actualizando fichaje');
    }
  }

  // Bulk actions
  function toggleSelect(id: string) {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  }

  function toggleSelectAll() {
    if (selectedIds.size === fichajes.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(fichajes.map(f => f.id)));
    }
  }

  async function validarMasivo(ids: string[], accion: "confirmar" | "rechazar") {
    const idsArray = Array.from(ids);
    
    if (idsArray.length === 0) {
      showError("No hay fichajes seleccionados");
      return;
    }

    const confirmMsg = accion === "confirmar" 
      ? `¿Validar ${idsArray.length} fichaje(s)?`
      : `¿Rechazar ${idsArray.length} fichaje(s)?`;
    
    if (!confirm(confirmMsg)) return;

    setProcessing(true);
    try {
      await api.post("/fichajes/sospechosos/bulk", {
        ids: idsArray,
        accion,
      });
      
      showSuccess(`${idsArray.length} fichaje(s) procesado(s) correctamente`);
      setSelectedIds(new Set());
      await load();
    } catch (e) {
      console.error(e);
      showError('Error procesando fichajes');
    } finally {
      setProcessing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Mapa
  useEffect(() => {
    if (!detalle || !selectedId) return;

    // Coordenadas Empleado
    let empLat = detalle.geo_direccion?.lat ?? detalle.ip_info?.actual?.lat;
    let empLng = detalle.geo_direccion?.lng ?? detalle.ip_info?.actual?.lng;

    // Coordenadas Cliente
    let cliLat = Number(detalle.cliente_lat);
    let cliLng = Number(detalle.cliente_lng);
    let cliRadio = Number(detalle.cliente_radio) || 20;

    const hasEmp = empLat && empLng;
    const hasCli = cliLat && cliLng;

    // if (!hasEmp && !hasCli) return; // FIX: Siempre renderizar mapa

    let map: any = null;

    (async () => {
      const L = await import("leaflet");
      //@ts-ignore
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl:
          "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
        iconUrl:
          "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
        shadowUrl:
          "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
      });

      const mapContainer = document.getElementById("map");
      if (mapContainer) {
        mapContainer.innerHTML = "<div style='height:100%;width:100%;' id='map_inner'></div>"; 
        // Leaflet needs explicit height or refreshing
      }
      
      // Render inside inner div to avoid cleaning issues? 
      // Actually standard pattern is removing map instance.
      if(mapContainer) mapContainer.innerHTML = "";

      // Center map
      let centerLat = hasCli ? cliLat : (hasEmp ? empLat : 40.4167); // Default Madrid
      let centerLng = hasCli ? cliLng : (hasEmp ? empLng : -3.7037);

      map = L.map("map").setView([centerLat, centerLng], hasEmp || hasCli ? 15 : 6);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(map);

      // Si no tenemos nada, intentar ubicar al admin
      if (!hasEmp && !hasCli) {
         map.locate({ setView: true, maxZoom: 16 });
         map.on("locationfound", (e: any) => {
             L.marker(e.latlng).addTo(map).bindPopup("Tu ubicación actua (Admin)").openPopup();
         });
      }

      // Marker Empleado (Azul default)
      if (hasEmp) {
        L.marker([empLat, empLng])
          .addTo(map)
          .bindPopup(`<b>Empleado</b><br/>${renderDireccion(detalle)}`)
          .openPopup();
      }

      // Marker Cliente (Verde o Rojo) + Circulo
      if (hasCli) {
        const greenIcon = new L.Icon({
          iconUrl:
            "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png",
          shadowUrl:
            "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34],
          shadowSize: [41, 41],
        });

        L.marker([cliLat, cliLng], { icon: greenIcon })
          .addTo(map)
          .bindPopup(`<b>Cliente:</b> ${detalle.nombre_cliente}`);

        L.circle([cliLat, cliLng], {
          color: "green",
          fillColor: "#2f8",
          fillOpacity: 0.2,
          radius: cliRadio,
        }).addTo(map);
        
        // Fit bounds if both exist
        if (hasEmp) {
            const bounds = L.latLngBounds([
                [empLat, empLng],
                [cliLat, cliLng]
            ]);
            map.fitBounds(bounds, { padding: [50, 50] });
        }
      }
    })();

    return () => {
      try {
        if (map) map.remove();
      } catch {}
    };
  }, [detalle]);

  const renderDireccion = (x: FichajeRow) => {
    // Preferir geo_direccion si existe
    if (x.geo_direccion?.direccion) return x.geo_direccion.direccion;
    
    // Si no, construir de partes
    const d = x.direccion || x.geo_direccion?.direccion || null;
    const c = x.ciudad || x.geo_direccion?.ciudad || null;
    const p = x.pais || x.geo_direccion?.pais || null;

    const line = [d, c, p].filter(Boolean).join(", ");
    if (line) return line;

    // Fallback coords
    if (x.geo_direccion?.lat) {
        return `${x.geo_direccion.lat.toFixed(5)}, ${x.geo_direccion.lng.toFixed(5)}`;
    }
    
    return "Ubicación desconocida";
  };

  const renderMotivos = (f: FichajeRow) => {
    // Combine legacy and new motives
    let motives = new Set<string>();
    
    if (f.sospecha_motivo) motives.add(f.sospecha_motivo);
    if (f.geo_motivos && Array.isArray(f.geo_motivos)) {
        f.geo_motivos.forEach(m => motives.add(m));
    }
    
    // Convert known codes to labels
    const labels:React.ReactNode[] = [];
    
    motives.forEach(m => {
        if (m.includes("Fuera del área") || m.includes("rango")) {
            labels.push(
                <span key={m} className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded border border-yellow-200 font-medium">
                   📍 Fuera de Rango
                </span>
            );
        } else if (m.includes("vpn") || m.includes("IP")) {
             labels.push(
                <span key={m} className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded border border-blue-200 font-medium">
                   🌐 IP / VPN
                </span>
            );
        } else {
             labels.push(
                <span key={m} className="px-2 py-1 bg-gray-100 text-gray-800 text-xs rounded border border-gray-200">
                   {m}
                </span>
            );
        }
    });

    return <div className="flex flex-wrap gap-1">{labels}</div>;
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-red-600">Fichajes sospechosos</h1>
          <UniversalExportButton module="sospechosos" queryParams={{}} label="Exportar" />
      </div>

      {loading ? (
        <LoadingSpinner fullPage />
      ) : fichajes.length === 0 ? (
        <p className="text-gray-500 italic">No hay fichajes sospechosos pendientes de revisión.</p>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Total pendientes: {fichajes.length}
              {selectedIds.size > 0 && (
                <span className="ml-2 text-blue-600 font-semibold">
                  • {selectedIds.size} seleccionado(s)
                </span>
              )}
            </p>

            {selectedIds.size > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={() => validarMasivo(Array.from(selectedIds), "confirmar")}
                  disabled={processing}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                >
                  ✓ Validar Seleccionados ({selectedIds.size})
                </button>
                <button
                  onClick={() => validarMasivo(Array.from(selectedIds), "rechazar")}
                  disabled={processing}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                >
                  ✗ Rechazar Seleccionados ({selectedIds.size})
                </button>
              </div>
            )}
          </div>

          <div className="mb-3 flex gap-2">
            <button
              onClick={() => validarMasivo(fichajes.map(f => f.id), "confirmar")}
              disabled={processing}
              className="px-4 py-2 bg-green-100 text-green-800 border border-green-300 rounded-lg hover:bg-green-200 transition disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              ✓ Validar Todos
            </button>
            <button
              onClick={() => validarMasivo(fichajes.map(f => f.id), "rechazar")}
              disabled={processing}
              className="px-4 py-2 bg-red-100 text-red-800 border border-red-300 rounded-lg hover:bg-red-200 transition disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              ✗ Rechazar Todos
            </button>
          </div>

          <div className="overflow-x-auto shadow rounded-lg border">
            <table className="w-full bg-white">
                <thead className="bg-gray-50 text-gray-700 text-sm uppercase">
                <tr>
                    <th className="p-3 text-center w-12">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === fichajes.length && fichajes.length > 0}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 cursor-pointer"
                      />
                    </th>
                    <th className="p-3 text-left">Empleado</th>
                    <th className="p-3 text-left">Fecha / Tipo</th>
                    <th className="p-3 text-left">Ubicación Detectada</th>
                    <th className="p-3 text-left">Motivos de Sospecha</th>
                    <th className="p-3 text-center">Distancia</th>
                    <th className="p-3 text-right">Acciones</th>
                </tr>
                </thead>

                <tbody className="divide-y divide-gray-200">
                {fichajes.map((f) => (
                    <tr key={f.id} className="hover:bg-gray-50 transition">
                    <td className="p-3 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(f.id)}
                        onChange={() => toggleSelect(f.id)}
                        className="w-4 h-4 cursor-pointer"
                      />
                    </td>
                    <td className="p-3 font-medium text-gray-900">{f.nombre_empleado}</td>
                    <td className="p-3 text-sm">
                        <div className="font-semibold">{new Date(f.fecha).toLocaleDateString("es-ES")}</div>
                        <div className="text-gray-500">{new Date(f.fecha).toLocaleTimeString("es-ES")} • {f.tipo}</div>
                    </td>

                    <td className="p-3 text-sm text-gray-600 max-w-[200px] truncate" title={renderDireccion(f)}>
                        {renderDireccion(f)}
                    </td>

                    <td className="p-3">
                        {renderMotivos(f)}
                    </td>

                    <td className="p-3 text-center text-sm font-mono">
                         {f.distancia_km ? (
                            <span className={f.distancia_km > 0.05 ? 'text-red-600 font-bold' : 'text-gray-600'}>
                                { (f.distancia_km * 1000).toFixed(0) } m
                            </span>
                         ) : "-"}
                    </td>

                    <td className="p-3 text-right">
                         <button
                            onClick={() => verDetalle(f.id)}
                            className="text-blue-600 hover:text-blue-900 font-medium text-sm"
                        >
                            Revisar
                        </button>
                    </td>
                    </tr>
                ))}
                </tbody>
            </table>
          </div>
        </>
      )}

      {selectedId && detalle ? (
        <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            
            {/* Header */}
            <div className="p-5 border-b flex justify-between items-center bg-gray-50">
                <div>
                     <h2 className="text-xl font-bold text-gray-800">
                        Revisión de Fichaje
                    </h2>
                     <p className="text-sm text-gray-500">ID: {detalle.id}</p>
                </div>
                <div className="flex gap-2">
                     <button
                        onClick={() => validar(detalle.id, "rechazar")}
                        className="px-4 py-2 bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50 font-medium transition"
                    >
                        Rechazar (Fraude)
                    </button>
                     <button
                        onClick={() => validar(detalle.id, "confirmar")}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium shadow-sm transition"
                    >
                        Validar (Aceptar)
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="p-0 flex-1 overflow-y-auto bg-gray-50">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6">
                    
                    {/* Info Column */}
                    <div className="md:col-span-1 space-y-6">
                        
                        <div className="bg-white p-4 rounded-lg shadow-sm border">
                            <h3 className="text-sm font-bold text-gray-400 uppercase mb-3">Datos del Fichaje</h3>
                            <div className="space-y-2 text-sm">
                                <p><span className="text-gray-500">Empleado:</span> <br/><span className="font-medium text-lg">{detalle.nombre_empleado}</span></p>
                                <p><span className="text-gray-500">Fecha:</span> <br/><span className="font-medium">{new Date(detalle.fecha).toLocaleString()}</span></p>
                                <p><span className="text-gray-500">Tipo:</span> <br/><span className="capitalize badge bg-gray-100 px-2 rounded border">{detalle.tipo}</span></p>
                            </div>
                        </div>

                        <div className="bg-white p-4 rounded-lg shadow-sm border">
                             <h3 className="text-sm font-bold text-gray-400 uppercase mb-3">Análisis Geo</h3>
                             
                             {detalle.distancia_km != null ? (
                                 <div className="mb-4 text-center p-3 bg-yellow-50 rounded-lg border border-yellow-100">
                                     <div className="text-xs text-yellow-700 uppercase font-bold">Desviación</div>
                                     <div className="text-3xl font-bold text-yellow-600">{(detalle.distancia_km * 1000).toFixed(0)} m</div>
                                     <div className="text-xs text-gray-500 mt-1">Permitido: {detalle.cliente_radio || 20} m</div>
                                 </div>
                             ) : null}

                             <div className="space-y-3 text-sm">
                                <div>
                                    <span className="text-gray-500 block text-xs">Ubicación Empleado:</span>
                                    <span className="font-medium bg-blue-50 text-blue-800 px-1 rounded">{renderDireccion(detalle)}</span>
                                </div>
                                {detalle.nombre_cliente && (
                                    <div>
                                        <span className="text-gray-500 block text-xs">Cliente Asignado:</span>
                                        <span className="font-medium bg-green-50 text-green-800 px-1 rounded">{detalle.nombre_cliente}</span>
                                    </div>
                                )}
                                
                                <div>
                                    <span className="text-gray-500 block text-xs mt-2">Motivos:</span>
                                    {renderMotivos(detalle)}
                                </div>
                             </div>
                        </div>

                    </div>

                    {/* Map Column */}
                    <div className="md:col-span-2 h-[400px] md:h-auto min-h-[400px] bg-white rounded-lg shadow-sm border overflow-hidden relative">
                         <div id="map" className="w-full h-full bg-gray-100"></div>
                         {!detalle.geo_direccion?.lat && !detalle.ip_info?.actual?.lat && (
                             <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                                 Sin coordenadas disponibles
                             </div>
                         )}
                    </div>

                </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t bg-white flex justify-end">
                 <button
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium"
                    onClick={() => {
                        setSelectedId(null);
                        setDetalle(null);
                    }}
                >
                    Cerrar Detalle
                </button>
            </div>

          </div>
        </div>
      ) : null}
    </div>
  );
}
