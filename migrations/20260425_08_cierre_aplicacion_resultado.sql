-- Sprint 3A: añadir flag de aplicación del resultado al cierre de ejercicio.
-- 129 → 1130 (reservas voluntarias) / 1140 (reserva legal) si beneficio, o
-- 1210 (resultados negativos ejercicios anteriores) si pérdida.

ALTER TABLE cierre_ejercicio_180
    ADD COLUMN IF NOT EXISTS asiento_aplicacion_resultado boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS aplicacion_resultado_destino text;
