# Roadmap de Cimientos - Tablero Operativo (4 semanas)

Fecha de inicio: 2026-04-20  
Objetivo: elevar sostenibilidad y estabilidad sin sobreingenieria ni cambios radicales.

## Columnas

### Todo

- T03 API publica por feature (barrels consistentes)
- T05 Outcomes estables en capa aplicacion
- T06 DTOs y validacion en borde
- T07 Contrato unico de exportaciones (Excel/PDF)
- T08 Tests de contrato por capa
- T09 Indice de busqueda paciente (normalizado + tokens persistidos)
- T10 Backfill de indice + ajustes Firestore
- T11 Framework de migraciones locales versionadas
- T12 Suite critica de regresion por riesgo
- T13 Logging estructurado y taxonomia de errores
- T14 Gate final de release + checklist operativo

### Doing

- T06 DTOs y validacion en borde (avance: census search + backup export archive + auth session + handoff export/backup)

### Review

- (vacio)

### Done

- T01 Fronteras por dominio (ADR base)
- T02 Guardrails ESLint de boundaries (enforcement incremental)
- T03 API publica por feature (barrels consistentes)
- T04 Desacople UI -> repo en busqueda de censo
- T05 Outcomes estables en capa aplicacion

## Dependencias

- T03 depende de T01/T02.
- T04 depende de T03.
- T05 depende de T04.
- T06/T07 dependen de T05.
- T08 depende de T06/T07.
- T09 depende de T08.
- T10 depende de T09.
- T11 depende de T08.
- T12 depende de T10/T11.
- T13 depende de T12.
- T14 depende de T13.

## Alcance de esta iteracion (hoy)

- Completar T01: definir matriz de dependencias permitidas por dominio y publicarla como referencia canonica.
- Completar T02: activar restricciones ESLint en dominios ya limpios (`cudyr`, `handoff`, `layout`) para bloquear nuevas violaciones.

## Riesgos conocidos

- Existen zonas legacy con acoplamiento directo a repositorios (`src/hooks/**` y `src/features/census/components/global-search/**`).
- No se aplica bloqueo global hoy para no romper CI; se ejecuta estrategia incremental con backlog explicito (T03/T04).
