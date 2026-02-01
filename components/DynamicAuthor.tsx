"use client";

import { useEffect } from "react";
import { getUser } from "@/services/auth";

export default function DynamicAuthor() {
  useEffect(() => {
    try {
      const user = getUser();
      if (user && user.nombre) {
        // Buscar la etiqueta meta author
        let meta = document.querySelector('meta[name="author"]');
        
        // Si no existe, crearla (aunque layout.tsx ya la pone)
        if (!meta) {
          meta = document.createElement('meta');
          meta.setAttribute('name', 'author');
          document.head.appendChild(meta);
        }

        // Actualizar contenido con el nombre del empleado/usuario
        meta.setAttribute('content', user.nombre);
        console.log("DynamicAuthor: Updated author to", user.nombre);
      }
    } catch (err) {
      console.warn("DynamicAuthor: Failed to update author", err);
    }
  }, []);

  return null;
}
