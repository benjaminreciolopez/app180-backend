"use client";

import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  useMapEvents,
  useMap,
} from "react-leaflet";
import { useEffect, useState } from "react";
import L from "leaflet";

/* =====================================================
   Types
===================================================== */

type Props = {
  lat: number | null;
  lng: number | null;
  radio: number | null;

  onChange: (v: { lat: number; lng: number; radio: number }) => void;

  onClose: () => void;
};

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
};

/* =====================================================
   Marker icon
===================================================== */

const icon = new L.Icon({
  iconUrl: "/marker-icon.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

/* =====================================================
   Helpers
===================================================== */

function MapClickHandler({
  onSelect,
}: {
  onSelect: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onSelect(e.latlng.lat, e.latlng.lng);
    },
  });

  return null;
}

function MapRecenter({ pos }: { pos: [number, number] }) {
  const map = useMap();

  useEffect(() => {
    map.setView(pos, map.getZoom(), {
      animate: true,
    });
  }, [pos, map]);

  return null;
}

/* =====================================================
   Component
===================================================== */

export default function GeoPicker({
  lat,
  lng,
  radio,
  onChange,
  onClose,
}: Props) {
  const [pos, setPos] = useState<[number, number]>(
    () => (lat != null && lng != null ? [lat, lng] : [40.4168, -3.7038]), // Madrid
  );

  const [radius, setRadius] = useState<number>(radio || 100);

  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* =========================
     Sync props → state
  ========================= */

  useEffect(() => {
    if (lat != null && lng != null) {
      setPos([lat, lng]);
    }

    if (radio != null) {
      setRadius(radio);
    }
  }, [lat, lng, radio]);

  /* =========================
     Search
  ========================= */

  async function buscar() {
    if (!search.trim()) return;

    try {
      setSearching(true);
      setError(null);

      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
          search,
        )}`,
        {
          headers: {
            "User-Agent": "APP180/1.0 (admin@app180.local)",
          },
        },
      );

      if (!res.ok) {
        throw new Error("Error en búsqueda");
      }

      const data: NominatimResult[] = await res.json();

      if (!data.length) {
        setError("No se encontraron resultados");
        return;
      }

      const r = data[0];

      const newPos: [number, number] = [Number(r.lat), Number(r.lon)];

      setPos(newPos);
      setAddress(r.display_name);
    } catch (e: any) {
      console.error(e);
      setError("No se pudo buscar la dirección");
    } finally {
      setSearching(false);
    }
  }

  /* =========================
     Save
  ========================= */

  function guardar() {
    onChange({
      lat: pos[0],
      lng: pos[1],
      radio: radius,
    });

    onClose();
  }

  /* ========================= */

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-3xl rounded-xl p-4 space-y-4 shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">Seleccionar ubicación</h3>

          <button
            onClick={onClose}
            className="px-3 py-1 rounded text-sm text-slate-600 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="flex gap-2">
          <input
            className="border px-3 py-2 rounded w-full text-sm"
            placeholder="Buscar dirección…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") buscar();
            }}
          />

          <button
            onClick={buscar}
            disabled={searching}
            className="px-4 py-2 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {searching ? "Buscando…" : "Buscar"}
          </button>
        </div>

        {address && (
          <div className="text-xs text-slate-600 truncate">📍 {address}</div>
        )}

        {error && <div className="text-sm text-red-600">{error}</div>}

        {/* Map */}
        <div className="h-[420px] rounded overflow-hidden border">
          <MapContainer center={pos} zoom={15} className="h-full w-full">
            <TileLayer
              attribution="© OpenStreetMap"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <MapRecenter pos={pos} />

            <MapClickHandler onSelect={(lat, lng) => setPos([lat, lng])} />

            <Marker
              position={pos}
              icon={icon}
              draggable
              eventHandlers={{
                dragend(e) {
                  const p = e.target.getLatLng();
                  setPos([p.lat, p.lng]);
                },
              }}
            />

            <Circle
              center={pos}
              radius={radius}
              pathOptions={{ color: "#2563eb" }}
            />
          </MapContainer>
        </div>

        {/* Radius */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Radio</span>

          <input
            type="range"
            min={20}
            max={500}
            step={10}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="flex-1"
          />

          <span className="text-sm w-16 text-right font-mono">{radius} m</span>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm border hover:bg-slate-50"
          >
            Cancelar
          </button>

          <button
            onClick={guardar}
            className="px-4 py-2 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
          >
            Guardar ubicación
          </button>
        </div>
      </div>
    </div>
  );
}
