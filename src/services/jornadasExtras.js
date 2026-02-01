// backend/src/services/jornadasExtras.js

export function calcularExtras({ minutos_trabajados, horas_objetivo_dia }) {
  const objetivoMin = (horas_objetivo_dia || 8) * 60;

  return Math.max(0, minutos_trabajados - objetivoMin);
}
