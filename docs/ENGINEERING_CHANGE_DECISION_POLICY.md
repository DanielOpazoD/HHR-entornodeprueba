# Engineering Change Decision Policy

## Objetivo

Mantener la evolución técnica de la aplicación enfocada en valor real para la operación clínica, evitando refactors cosméticos, capas innecesarias o “arquitectura por estética”.

Esta política aplica a mejoras, deuda técnica, refactors, endurecimiento de tests, cambios de runtime y propuestas de arquitectura.

## Regla principal

Un cambio de ingeniería debe hacerse solo si cumple al menos una de estas condiciones:

1. Reduce riesgo real de bug, regresión o indisponibilidad.
2. Mejora testabilidad de una parte crítica o históricamente frágil.
3. Baja acoplamiento en una frontera que cambia seguido o que ya generó errores reales.

Si un cambio no cumple ninguna de las tres, la decisión por defecto es no hacerlo.

## Orden de prioridad

1. Flujos clínicos, operativos o administrativos donde ya hubo errores visibles.
2. Runtime crítico: bootstrap, auth, sync, storage, recovery y permisos.
3. Tests de integración o cobertura en flujos sensibles.
4. Boundaries y adapters solo cuando eliminan una dependencia problemática concreta.
5. Limpieza estructural secundaria solo si no distrae de los puntos anteriores.

## Filtro de decisión antes de tocar código

Antes de implementar una mejora, responder explícitamente:

- ¿Qué riesgo concreto baja?
- ¿Qué test, bug, warning, coupling o guardrail lo justifica?
- ¿Qué alternativa más simple existe?
- ¿Cuál es la superficie afectada?
- ¿Qué señal objetiva confirmará que el cambio valió la pena?

Si esas respuestas no son claras, el cambio no debe avanzar.

## Qué sí cuenta como mejora de calidad

- Eliminar dependencia de orden implícito, estados frágiles o wiring opaco.
- Agregar tests de integración donde ya hubo regresiones reales.
- Concentrar runtime crítico en adapters/factories cuando mejora testabilidad y reduce acoplamiento.
- Endurecer thresholds o guardrails con métricas reales del repo.
- Sustituir comportamiento ambiguo por fallos explícitos y seguros.

## Qué suele ser sobreingeniería

- Crear facades, wrappers o contracts nuevos sin una frontera real que proteger.
- Reemplazar imports o mover tipos “por pureza” sin beneficio operativo o de testabilidad.
- Multiplicar capas en módulos estables que no presentan fricción real.
- Hacer refactors amplios cuando un cambio localizado resuelve el problema.
- Elevar thresholds, reglas o abstracciones sin medición real del estado actual.

## Reglas prácticas para futuras sesiones

- Preferir cambios pequeños, verificables y con rollback simple.
- No expandir una refactorización más allá del flujo o boundary que motivó el trabajo.
- Cada mejora estructural debe dejar al menos una señal objetiva:
  - test nuevo o corregido
  - warning eliminado
  - dependency edge eliminado
  - guardrail que pasa
  - threshold endurecido con margen real
- Si el beneficio es solo “ordenar”, posponer.
- Si el beneficio es tangible pero la superficie es grande, dividir en iteraciones pequeñas.

## Política para deuda técnica

- La deuda no se ataca por volumen sino por impacto.
- La deuda con impacto en runtime, datos, permisos, sync o flujos clínicos tiene prioridad.
- La deuda puramente cosmética o de estilo no debe competir con estabilidad.
- Un hotspot de tipos o arquitectura se toca cuando:
  - introduce bugs de acoplamiento,
  - complica tests,
  - bloquea cambios frecuentes,
  - o rompe un boundary que el proyecto ya decidió proteger.

## Política para agentes y sesiones futuras

- No continuar una línea de “mejora” solo porque ya empezó.
- Revalidar en cada sesión si el siguiente paso sigue teniendo valor tangible.
- Si la mejora siguiente parece cosmética, detenerse y elegir otro bloque.
- Cuando haya duda entre pureza arquitectónica y simplicidad operativa, gana simplicidad operativa.

## Señales de que conviene parar

- El cambio requiere explicar demasiado para justificar su valor.
- La principal ganancia es “queda más limpio”.
- Se necesitan varias capas nuevas para resolver un problema local.
- No hay test, guardrail o bug concreto que justifique la intervención.
- La superficie afectada crece más rápido que el beneficio esperado.

## Ejemplos válidos en este proyecto

- Desacoplar `firebaseConfig` del runtime de bootstrap para centralizar dependencias testeables.
- Agregar integración del modal de laboratorio tras una regresión visible de duplicación.
- Endurecer cobertura unitaria después de medir cobertura real.
- Reemplazar dependencia por orden de array en un formulario clínico.

## Ejemplos a evitar

- Reemplazar masivamente imports root de tipos sin un boundary o riesgo concreto.
- Introducir una nueva capa solo para renombrar tipos existentes.
- Refactorizar módulos estables solo para “alinearlos” con una arquitectura ideal.

## Política de adopción de versiones mayores de dependencias

Este repositorio lo mantiene una sola persona y usa versiones nuevas de librerías
centrales (React 19.x, Vite 6.x, Vitest 4.x, Tailwind 4.x, Firebase 12.x).
Cuando Dependabot abre un PR con un bump **mayor** (`X.0.0 → X+1.0.0`):

- **No se mergea en los primeros 60 días** desde la publicación, aunque CI esté verde.
  Dejar que otros proyectos encuentren los bugs primero. La ventana de 60 días se
  cuenta contra la fecha de release en el registry, no contra la fecha del PR.
- **No se mergea en viernes, vísperas de turnos clínicos largos, ni al inicio de
  vacaciones del mantenedor.** El bump mayor debe poder revertirse cómodamente
  dentro de las 48 h siguientes si algo falla en producción.
- **No se mergea antes de leer el CHANGELOG completo** del release mayor y
  buscar issues abiertos con la etiqueta `regression` o `breaking`.
- Si el bump mayor toca **React**, **Firebase** o **Vite**, correr
  `npm run ci:release-gate` local y abrir una ventana de soak de 1 semana en
  preview antes de promover a producción.

Minors y patches siguen el flujo estándar de Dependabot: revisión rápida del
changelog, merge cuando CI es verde.

Excepción explícita: **parches de seguridad críticos** (CVE high/critical en
deps directas, marcadas como tales por `npm audit` o GitHub Security) pueden
acortar la ventana a 7 días si no hay workaround disponible.

## Cómo usar esta política junto con otras guías

- Esta política decide si una mejora merece hacerse.
- [docs/CI_GATES_AND_FAILURE_RUNBOOKS.md](./CI_GATES_AND_FAILURE_RUNBOOKS.md) define los límites estructurales, los gates vigentes y la definición de terminado cuando un cambio sí se implementa.
- [docs/TECHNICAL_DEBT_REGISTER.md](./TECHNICAL_DEBT_REGISTER.md) define qué deuda priorizada sigue abierta.
