# `src/services/admin`

Reglas administrativas y de mantenimiento de datos.

- `src/features/admin/services/admissionDateBackfillService.ts` usa la misma regla de episodio compartida que censo y estadísticas.
- El backfill corrige el snapshot histórico hacia la primera fecha observada del episodio, pero no fusiona episodios distintos del mismo RUT.
- Alta o traslado cierran episodio; si el mismo paciente reaparece, el backfill trata ese reingreso como otro episodio.
- Los resultados del backfill deben quedar auditados y no deben depender de snapshots congelados de `originalData`.
