# Rúbrica de Evaluación Técnica HHR

Esta rúbrica busca que la nota técnica del repositorio sea repetible entre evaluaciones y no dependa de memoria conversacional ni de impresiones generales.

La evaluación usa evidencia observable del repo:

- `npm run typecheck`
- `npm run lint -- --max-warnings 0`
- `npm run check:quality`
- `reports/release-readiness-scorecard.md`
- `reports/system-confidence.md`
- `reports/critical-coverage.md`
- `reports/quality-metrics.md`
- `reports/operational-health.md`
- `reports/security/dependency-audit.md`

## 1. Escala base

Usar esta escala antes de aplicar pesos y techos:

| Nota      | Criterio                                                            |
| --------- | ------------------------------------------------------------------- |
| 7.0       | Excelente, consistente, sin señales rojas relevantes.               |
| 6.5 - 6.9 | Muy bueno, con deuda acotada y no bloqueante.                       |
| 6.0 - 6.4 | Bueno, pero con brechas relevantes todavía visibles.                |
| 5.5 - 5.9 | Aceptable, con debilidades que frenan confianza operativa.          |
| 5.0 - 5.4 | Insuficiente para un sistema crítico sin correcciones prioritarias. |
| 4.0 - 4.9 | Débil, con riesgos claros de mantenimiento u operación.             |
| 1.0 - 3.9 | Deficiente o inestable.                                             |

## 2. Pesos

La nota global es un promedio ponderado:

| Parámetro                          | Peso |
| ---------------------------------- | ---: |
| Estructura                         |   12 |
| Organización                       |   10 |
| Buenas prácticas de programación   |   14 |
| Adecuada limitación de componentes |   10 |
| Estabilidad                        |   16 |
| Escalabilidad                      |   12 |
| Uso de tests                       |   12 |
| Seguridad                          |    8 |
| Documentación                      |    6 |

## 3. Regla clave: techos automáticos

Antes de cerrar la nota global, aplicar estos techos. Esto evita que documentación o testing inflen artificialmente una nota cuando hay bloqueadores reales.

| Condición observable                                   | Techo global |
| ------------------------------------------------------ | -----------: |
| `typecheck` falla                                      |          5.8 |
| `lint` falla                                           |          6.0 |
| `check:quality` falla                                  |          5.9 |
| `reports/system-confidence.md` en `degraded`           |          6.1 |
| `reports/release-readiness-scorecard.md` en `degraded` |          6.1 |
| `reports/critical-coverage.md` en `failing`            |          6.2 |
| 2 o más de las condiciones anteriores al mismo tiempo  |          6.0 |

Notas:

- Si `typecheck`, `lint` y `check:quality` están verdes, desaparecen sus techos.
- Si release y confianza pasan de `degraded` a `ok`, el repo puede entrar a 6.3+.
- Si además desaparece la falla de coverage crítica, el repo puede entrar a 6.5+.

## 4. Cómo puntuar cada parámetro

### Estructura

Medir con:

- separación por capas y features
- boundaries automatizados
- deuda de dependencias por carpeta
- contratos y ownership explícitos

Guía:

- 6.5-7.0: capas claras, boundaries automatizados, sin drift relevante
- 6.0-6.4: buena estructura con algunos hotspots o seams tensos
- 5.5-5.9: estructura razonable pero con mezclas frecuentes de responsabilidades
- <5.5: estructura confusa o sin enforcement

Señales HHR:

- `reports/quality-metrics.md` con `folderDebt=0`
- `check:architecture`, ESLint (`hhr/feature-boundaries`)

### Organización

Medir con:

- navegabilidad del repo
- consistencia de nombres
- README por módulo
- facilidad para ubicar ownership y comandos

Guía:

- 6.5-7.0: navegación fácil, documentación local consistente, mapa del repo útil
- 6.0-6.4: organización fuerte con algunas zonas densas
- 5.5-5.9: organización aceptable pero con fricción al entrar a módulos complejos
- <5.5: difícil de navegar o inconsistente

### Buenas prácticas de programación

Medir con:

- `typecheck`
- `lint`
- `sourceAny`
- uso de hooks y memoización correctos
- sinks estructurados de logging

Reglas:

- si `lint` falla, esta dimensión no puede superar 5.5
- si `typecheck` falla, esta dimensión no puede superar 5.2

Guía:

- 6.5-7.0: tipado, lint, hooks y hygiene todos verdes
- 6.0-6.4: buenas prácticas mayormente sólidas con hallazgos menores
- 5.5-5.9: buenas prácticas presentes, pero con fallas reales en CI local
- <5.5: señales repetidas de deuda básica

### Adecuada limitación de componentes

Medir con:

- budgets de tamaño
- hotspots
- megatests
- tamaño de módulos y hooks críticos

Guía:

- 6.5-7.0: límites efectivos, sin oversized, hotspots controlados
- 6.0-6.4: límites buenos, con watchlist acotada
- 5.5-5.9: límites declarados pero con algunos módulos críticos sobrecargados
- <5.5: módulos grandes y sin control

Señales HHR:

- `reports/quality-metrics.md` y el informe que genera `npm run report:maintenance-debt-scorecard` (no está versionado: se genera en `reports/`)

### Estabilidad

Medir con:

- `system-confidence`
- `release-readiness`
- known failures abiertas
- flake risk
- coverage crítica
- budgets operativos

Reglas:

- si `system-confidence` está `degraded`, esta dimensión no puede superar 5.8
- si `release-readiness` está `degraded`, esta dimensión no puede superar 5.8
- si `critical-coverage` está `failing`, esta dimensión no puede superar 5.8

Guía:

- 6.5-7.0: confianza operativa verde, sin señales degradadas
- 6.0-6.4: estable con deuda operativa acotada
- 5.5-5.9: base estable pero con degradaciones activas
- <5.5: varias señales rojas

### Escalabilidad

Medir con:

- tamaño y división del shell
- chunk budgets
- fan-in de contratos
- hotspots arquitectónicos
- seams runtime y desacoplamiento

Reglas:

- si hay error de startup chunk budget, esta dimensión no puede superar 5.9

Guía:

- 6.5-7.0: crecimiento modular sano y budgets controlados
- 6.0-6.4: arquitectura escalable con algunos cuellos localizados
- 5.5-5.9: escala razonablemente, pero arrastra hotspots que frenan evolución
- <5.5: monolitos o fan-in excesivo sin control

### Uso de tests

Medir con:

- cobertura multi-capa
- suites críticas
- E2E
- emulador y rules
- governance de flakes/skips
- coverage crítica por zona

Reglas:

- si `critical-coverage` está `failing`, esta dimensión no puede superar 6.4
- si hay `skip`, `only` o cuarentenas abiertas, bajar al menos 0.3

Guía:

- 6.5-7.0: estrategia amplia y además coverage crítica verde
- 6.0-6.4: testing fuerte, con una o pocas brechas críticas
- 5.5-5.9: buena cantidad, pero cobertura desalineada con riesgo real
- <5.5: cobertura insuficiente o poco confiable

### Seguridad

Medir con:

- Firestore rules
- tests de rules
- CSP y hardening
- serverless sensitive coverage
- secret leak checks
- dependency audit

Reglas:

- si hay vulnerabilidades `high` o `critical` en prod, esta dimensión no puede superar 5.5
- si hay secretos hardcodeados o bypasses permanentes, bajar al menos 0.5

Guía:

- 6.5-7.0: hardening consistente, rules testeadas, dependencias limpias
- 6.0-6.4: seguridad buena con alguna deuda estructural contenida
- 5.5-5.9: seguridad cuidada, pero con complejidad o excepciones delicadas
- <5.5: controles débiles o poco auditables

### Documentación

Medir con:

- ADRs
- runbooks
- mapa del repo
- README por módulo
- docs drift

Guía:

- 6.5-7.0: documentación viva, operativa y útil
- 6.0-6.4: documentación buena con huecos menores
- 5.5-5.9: suficiente para operar, no para escalar sin fricción
- <5.5: desactualizada o escasa

## 5. Tramos de ascenso global

Usar esta tabla para no “volver atrás” arbitrariamente entre evaluaciones.

### Tramo A: 5.8 - 6.0

Se mantiene aquí si aparece cualquiera de estas condiciones:

- `lint` rojo
- `system-confidence` en `degraded`
- `release-readiness` en `degraded`
- `critical-coverage` en `failing`

### Tramo B: 6.1 - 6.3

Para entrar aquí deben cumplirse todas:

- `typecheck` verde
- `lint` verde
- `check:quality` verde
- sin errores reales de hooks o tests en la superficie principal

Puede seguir habiendo una degradación no crítica en reportes, pero no más de una.

### Tramo C: 6.4 - 6.6

Para entrar aquí deben cumplirse todas:

- todo lo del tramo B
- `system-confidence` en `ok`
- `release-readiness` en `ok`
- `critical-coverage` en `ok`
- sin errores de budget en startup chunks

### Tramo D: 6.7 - 7.0

Para entrar aquí deben cumplirse todas:

- todo lo del tramo C
- `flakeRisk=0`
- 0 señales operativas degradadas
- seguridad prod limpia sin excepciones delicadas abiertas
- hotspots principales bajo control sostenido

## 6. Estado actual de referencia

Al momento de esta versión de la rúbrica, el repo cae en el tramo A por estas señales:

- `lint` falla
- `reports/system-confidence.md`: `Overall status: degraded`
- `reports/release-readiness-scorecard.md`: `Overall: degraded`
- `reports/critical-coverage.md`: `Status: failing`

Por eso una nota global cercana a `5.9 - 6.0` es consistente incluso si estructura, tests y documentación están bastante por encima.

## 7. Regla de cierre para futuras evaluaciones

Cada nueva evaluación debe:

1. puntuar cada parámetro con esta rúbrica,
2. calcular el promedio ponderado,
3. aplicar los techos automáticos,
4. informar explícitamente qué techo quedó activo,
5. indicar qué condición concreta liberaría el siguiente tramo.

Ejemplo de cierre esperado:

- `Nota base ponderada`: 6.42
- `Techo activo`: 6.0 por `lint` rojo + `system-confidence` degradado
- `Nota final`: 6.0
- `Para pasar a 6.3`: dejar `lint` verde y eliminar degradación principal
