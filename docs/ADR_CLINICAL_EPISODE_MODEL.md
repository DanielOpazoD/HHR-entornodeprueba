# ADR: Clinical Episode Model

**Estado:** Vigente

## Decisión

El identificador y contexto de episodio clínico pasan a resolverse desde un modelo compartido en `src/application/patient-flow/clinicalEpisode.ts`.

Desde el bloque PR3, el modelo acepta `clinicalEpisodeId` como identificador canónico opcional. Mientras el dato se adopta gradualmente, el resolver usa esta prioridad:

1. `clinicalEpisodeId` persistido.
2. Tupla legacy `rut + firstSeenDate|admissionDate + admissionTime`.

## Motivo

El `episodeKey` y la semántica de ingreso nuevo estaban duplicados entre censo, documentos clínicos y otras vistas derivadas.

La tupla legacy separa reingresos del mismo día cuando existe hora, pero sigue siendo heurística. Un ID persistido permite que censo, movimientos, outbox y reportería MINSAL hablen del mismo episodio sin recalcularlo localmente.

## Consecuencia

- Censo y documentos clínicos usan la misma fuente de verdad para episodio.
- Los indicadores clínicos y movimientos del día comparten semántica.
- Nuevos módulos deben reutilizar este modelo en vez de reconstruir `episodeKey` localmente.
- Durante la transición, módulos compartidos con Functions/MINSAL deben preferir `clinicalEpisodeId` y caer a la tupla legacy solo cuando el ID no exista.
