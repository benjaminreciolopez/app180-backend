#!/bin/bash
# Script para aplicar migración 006 - Agregar iva_percent a lineafactura_180

echo "📦 Aplicando migración 006..."

# Verificar que existe el archivo de migración
if [ ! -f "migrations/006_add_iva_percent_to_lineafactura.sql" ]; then
  echo "❌ Error: No se encuentra el archivo de migración"
  exit 1
fi

# Verificar que existe DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
  echo "❌ Error: DATABASE_URL no está configurado en .env"
  exit 1
fi

# Aplicar migración
psql "$DATABASE_URL" -f migrations/006_add_iva_percent_to_lineafactura.sql

if [ $? -eq 0 ]; then
  echo "✅ Migración 006 aplicada correctamente"
else
  echo "❌ Error aplicando migración"
  exit 1
fi
