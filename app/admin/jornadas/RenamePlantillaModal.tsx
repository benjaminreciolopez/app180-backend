"use client";

import { useState, useEffect } from "react";
import Modal from "./Modal";

export default function RenamePlantillaModal({
  open,
  onClose,
  currentName,
  onConfirm,
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  currentName: string;
  onConfirm: (newName: string) => void;
  loading?: boolean;
}) {
  const [value, setValue] = useState(currentName);

  // Reset cuando se abre
  useEffect(() => {
    if (open) {
      setValue(currentName);
    }
  }, [open, currentName]);

  return (
    <Modal open={open} onClose={onClose} title="Renombrar plantilla">
      <div className="space-y-3">
        <input
          className="border p-2 rounded w-full"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          disabled={loading}
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
            disabled={loading || !value.trim()}
            className="
              px-3 py-2 rounded
              bg-blue-600 text-white
              disabled:opacity-50
              disabled:cursor-not-allowed
            "
            onClick={() => {
              if (loading) return;
              if (!value.trim()) return;

              onConfirm(value.trim());
            }}
          >
            {loading ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
