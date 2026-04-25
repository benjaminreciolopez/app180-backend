-- Verifactu retry queue: backoff exponencial + límite de intentos.
--
-- Hasta ahora un fallo de envío a AEAT marcaba estado_envio='ERROR' y se quedaba
-- ahí: el cron `verifactuEnvioJob` sólo recogía registros 'PENDIENTE', así que
-- los errores transitorios (timeout AEAT, 5xx) requerían intervención manual.
--
-- Con estas columnas el cron puede reintentar automáticamente con backoff:
--   * `intentos` cuenta envíos fallidos
--   * `proximo_reintento_at` = cuándo es elegible para reintento
--   * `ultimo_error` = último mensaje de AEAT (debug)
--
-- Cuando `intentos` supera el máximo (8) el código aplicación pasará a
-- 'ERROR_FATAL' — fuera del backoff automático, requiere revisión.

ALTER TABLE registroverifactu_180
    ADD COLUMN IF NOT EXISTS intentos INT NOT NULL DEFAULT 0;

ALTER TABLE registroverifactu_180
    ADD COLUMN IF NOT EXISTS proximo_reintento_at TIMESTAMPTZ;

ALTER TABLE registroverifactu_180
    ADD COLUMN IF NOT EXISTS ultimo_error TEXT;

-- Índice para que el cron filtre eficientemente:
-- WHERE estado_envio IN ('PENDIENTE', 'ERROR') AND (proximo_reintento_at IS NULL OR proximo_reintento_at <= NOW())
CREATE INDEX IF NOT EXISTS idx_verifactu_retry_eligible
    ON registroverifactu_180 (estado_envio, proximo_reintento_at)
    WHERE estado_envio IN ('PENDIENTE', 'ERROR');
