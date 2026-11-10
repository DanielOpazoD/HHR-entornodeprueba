# `src/services/observability`

## Proposito

- Centralizar sinks, tipos y helpers de telemetria operacional sin obligar a todos los dominios a depender del servicio generico como API semantica.

## Regla principal

- Los contextos de negocio deben preferir wrappers por dominio creados con `domainObservability.ts`.
- `loggerService.ts` y `operationalTelemetryRecorder.ts` quedan como infraestructura base y sinks compartidos.

## Invariantes

- No emitir eventos operativos relevantes desde UI con strings ad hoc.
- Si un contexto necesita telemetria propia, debe crear un adapter de dominio pequeno antes de importar el servicio generico.
- Los nombres de `category` y `operation` deben ser estables para no romper reportes ni runbooks.
