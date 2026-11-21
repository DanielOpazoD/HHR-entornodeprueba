# Foundation Improvement Plan

Plan iterativo de mejoras de cimientos basado en [REPO_PRINCIPLES.md](../REPO_PRINCIPLES.md).

La idea no es abrir una re-arquitectura. La idea es bajar complejidad real por bloques pequeños, con checks objetivos y valor operativo visible.

## Bloque 1. Runtime de listas globales del censo

- Principios:
  - La UI muestra y dispara; no decide reglas sensibles.
  - Cada regla sensible debe tener un hogar único.
  - Los adapters deben ser delgados.
- Objetivo:
  - dejar `useCensusEmailRecipientLists.ts` más cerca de wiring y menos cargado de política de runtime.
- Alcance:
  - éxito de `create`, `rename` y `delete`
  - aplicación/persistencia del runtime activo
  - errores y sync diferido ya resueltos por controllers/casos de uso
- Checkpoint:
  - tests focalizados del hook y sus controllers verdes
  - `npm run typecheck` verde

## Bloque 2. Read/write path de `dailyRecord`

- Principios:
  - Read y write paths deben ser explícitos.
  - Cada regla sensible debe tener un hogar único.
- Objetivo:
  - seguir sacando del servicio principal decisiones puras de recovery, sync y composición de resultados.
- Alcance:
  - planes de append/sync
  - auto-merge de conflicto
  - recovery remoto
- Checkpoint:
  - tests focalizados de repositorio verdes
  - menor branching visible en el servicio principal

## Bloque 3. Boundaries entre features

- Principios:
  - Los boundaries entre features pasan por superficies públicas.
  - Validación y normalización no se duplican.
- Objetivo:
  - evitar imports a internals de otras features y subir contratos compartidos cuando corresponda.
- Alcance:
  - `census`
  - `clinical-documents`
  - `handoff`
  - `cudyr`
- Checkpoint:
  - guardrails de arquitectura verdes
  - sin regresiones de wiring

## Bloque 4. Reglas temporales y clínicas con tests de contrato

- Principios:
  - Toda regla sensible debe tener test de contrato.
  - Cada regla sensible debe tener un hogar único.
- Objetivo:
  - blindar primero las reglas que más duelen al romperse.
- Prioridades:
  - ingreso nocturno y `firstSeenDate`
  - CUDYR por elegibilidad/fecha/rol
  - `Ir a censo`
  - fallback PDF de microbiología
  - copiar informe en MMRAD
- Checkpoint:
  - tests de contrato directos y legibles
  - baseline funcional verde

## Bloque 5. Runtime adapters y borde

- Principios:
  - Los adapters deben ser delgados.
  - La UI muestra y dispara; no decide reglas clínicas.
- Objetivo:
  - mantener `window.open`, `navigator.clipboard`, Netlify y runtimes externos en adapters pequeños.
- Checkpoint:
  - mejor testabilidad
  - sin lógica clínica filtrándose al borde

## Bloque 6. Watchlist cualitativa

- Principios:
  - La complejidad real importa más que las métricas aisladas.
- Objetivo:
  - vigilar `firestore.rules`, `useCensusEmailRecipientLists.ts`, `dailyRecord*` y otras piezas densas sin abrir guardrails nuevos innecesarios.
- Checkpoint:
  - `reports/maintenance-debt-scorecard.md` actualizado
  - `docs/MAINTENANCE_ITERATION_LOG.md` con cierre verificable

## Regla de ejecución

- un bloque por vez
- checks verdes antes de pasar al siguiente
- sin tocar el frente de `UPC` mientras siga en trabajo paralelo
- sin commits automáticos: cada checkpoint se revisa antes de consolidarlo
