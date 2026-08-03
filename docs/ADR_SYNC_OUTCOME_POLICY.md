# ADR: Sync Outcome Policy

**Estado:** Vigente

## Decisión

Las operaciones remotas críticas deben exponer outcomes de aplicación homogéneos (`success | partial | degraded | failed`) antes de llegar a la UI.

## Motivo

Existían respuestas heterogéneas (`clean`, `blocked`, `missing`, `null`, excepciones) que obligaban a cada consumidor a reinterpretar estados remotos.

## Consecuencia

- `syncWithFirestoreDetailed` sigue siendo contrato de repositorio.
- La UI consume preferentemente use-cases que traducen esos resultados a `ApplicationOutcome`.
- Los mensajes de degradación y fallback se centralizan mejor y son más testeables.

## Ejecuciones Rayen/Eloísa

Cada intento iniciado por el usuario tiene un `runId` y un único cierre operacional:
`complete`, `partial`, `failed` o `cancelled`. El controlador en memoria impide que callbacks
concurrentes cierren dos veces una misma ejecución y conserva una ejecución ya aplicada mientras
termina su enriquecimiento clínico en segundo plano.

Los fallos técnicos se registran únicamente con códigos y contadores acotados. La observabilidad no
debe incluir RUT, nombres, camas, episodios, mensajes crudos de proveedores ni valores clínicos. El
historial persistido continúa siendo la evidencia visible para soporte; los logs estructurados sirven
para diagnosticar carreras, timeouts y fallos de persistencia sin crear otra fuente de verdad.
