# HHR Repo Principles

Guía corta para tomar decisiones de diseño en el repo sin caer en sobreingeniería.

No es un checklist dogmático. Es una brújula práctica para mantener el sistema estable, legible y coherente a medida que crece.

## 1. La UI muestra y dispara; no decide reglas clínicas

- Componentes y hooks de pantalla deben priorizar render, interacción y formateo.
- La lógica clínica u operativa sensible debe vivir en controllers, application o domain.
- Si una regla cambia el significado de un turno, una categoría o una exportación, no debería quedar enterrada en JSX.

Aplicar especialmente en:

- `src/features/census`
- `src/features/handoff`
- `src/features/cudyr`
- `src/features/laboratory`
- `src/components/modals`

## 2. Cada regla sensible debe tener un hogar único

- Una regla temporal u operativa no debe existir en dos capas distintas con variantes implícitas.
- Si una regla se usa en más de una superficie, se centraliza y se reutiliza.
- Cuando una regla no cabe en un helper simple, merece un controller o use case propio.

Ejemplos de reglas sensibles:

- ingreso nocturno y `firstSeenDate`
- elegibilidad CUDYR
- navegación `Ir a censo`
- fallback microbiológico desde PDF
- copiado estructurado de MMRAD

## 3. Los boundaries entre features pasan por superficies públicas

- Entre features se importan contracts, controllers públicos o `public.ts`.
- Evitar imports a internals de otra feature aunque “funcionen”.
- Si dos features comparten un contrato de verdad, ese contrato sube a `application/shared`, `shared/*` o contracts dedicados.

Objetivo:

- bajar acoplamiento accidental
- mejorar onboarding
- sostener guardrails reales, no solo nominales

## 4. Read y write paths deben ser explícitos

- Leer, escribir, sincronizar, recuperar y reparar no son la misma cosa.
- Los servicios principales deben orquestar; las decisiones puras y builders repetidos se extraen.
- Los side effects deben verse claramente en el flujo.

Esto importa mucho en:

- `dailyRecord`
- sync con Firestore
- sync hacia `PatientMaster`
- recovery de conflictos y reintentos

## 5. Validación y normalización no se duplican

- La UI puede orientar o asistir, pero no debe convertirse en la única validación real.
- Los bordes correctos validan y normalizan una vez.
- Evitar la misma regla repetida en modal, hook, serverless y repositorio.

Señales de alerta:

- regex o normalización repetida en varias capas
- defaults que esconden pipelines rotos
- validaciones “casi iguales” entre cliente y backend

## 6. Los adapters deben ser delgados

- Browser, Netlify, Firestore, PDF, clipboard, popup y runtimes externos deben quedarse en el borde.
- Un adapter conecta; no absorbe negocio clínico.
- Si una function serverless empieza a “pensar” demasiado, probablemente está invadiendo otra capa.

Objetivo:

- mejor testabilidad
- menos drift entre cliente y runtime
- menor fragilidad ante cambios externos

## 7. Toda regla sensible debe tener test de contrato

- No basta con cobertura global.
- Las reglas que más duelen al romperse necesitan tests directos y legibles.
- Un contrato importante debe fallar antes en test que en producción o en QA manual.

Prioridades típicas:

- reglas temporales y de turno
- exportes clínicos
- CUDYR
- laboratorio y microbiología
- MMRAD
- write recovery de `dailyRecord`

## Heurística de cambio

Una mejora vale especialmente la pena si cumple al menos una de estas:

- saca lógica sensible fuera de UI
- centraliza una regla duplicada
- reduce acoplamiento entre features
- aclara un read/write/sync path
- elimina validación duplicada
- mejora el test de una regla real

Si una propuesta solo agrega capas, nombres o archivos sin bajar branching, acoplamiento o riesgo, probablemente no conviene.

## Qué evitar

- refactors masivos “por limpieza”
- mover carpetas por estética
- wrappers o adapters que solo reenvían sin valor
- documentación extensa que no cambia decisiones
- nuevos guardrails si el problema real es complejidad no resuelta

## Relación con otras guías del repo

- Para reglas operativas concretas: `docs/OPERATIVE_RULES_REFERENCE.md`
- Para trazabilidad de iteraciones: `docs/MAINTENANCE_ITERATION_LOG.md`
- Para deuda viva y watchlist: el informe que genera `npm run report:maintenance-debt-scorecard` (no está versionado: se genera en `reports/`)

Este documento responde una pregunta simple:

> “¿Dónde debería vivir esta lógica y cómo la dejamos más fácil de mantener sin complicar el sistema?”
