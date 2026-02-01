"use client";

import { useState, useEffect } from "react";
import Modal from "./Modal";

export default function DeletePlantillaModal({
  open,
  onClose,
  name,
  onConfirm,
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  onConfirm: () => void;
  loading?: boolean;
}) {
  const [typed, setTyped] = useState("");

  // Reset cuando se abre
  useEffect(() => {
    if (open) {
      setTyped("");
    }
  }, [open]);

  const ok = typed.trim() === name;

  return (
    <Modal
      open={open}
      onClose={loading ? () => {} : onClose}
      title="Eliminar plantilla"
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-700">
          Esta acción <b>no se puede deshacer</b>. Se borrarán:
        </p>

        <ul className="list-disc ml-5 text-sm text-gray-600">
          <li>Días</li>
          <li>Bloques</li>
          <li>Excepciones</li>
          <li>Asignaciones a empleados</li>
        </ul>

        <p className="text-sm mt-2">
          Escribe <b>{name}</b> para confirmar:
        </p>

        <input
          className="border p-2 rounded w-full disabled:opacity-50"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={loading}
          autoFocus
        />

        <div className="flex justify-end gap-2">
          <button
            className="px-3 py-2 rounded bg-gray-200 disabled:opacity-50"
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </button>

          <button
            disabled={!ok || loading}
            className="
              px-3 py-2 rounded text-white
              bg-red-600
              disabled:bg-red-300
              disabled:cursor-not-allowed
              disabled:opacity-60
            "
            onClick={() => {
              if (loading || !ok) return;
              onConfirm();
            }}
          >
            {loading ? "Eliminando..." : "Eliminar definitivamente"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
