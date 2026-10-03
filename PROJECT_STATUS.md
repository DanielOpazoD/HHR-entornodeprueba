# Estado verificable del proyecto

Esta página explica dónde consultar el estado; no conserva una copia manual de
métricas ni certifica aptitud clínica. Un ciclo histórico cerrado no demuestra
que el commit actual esté validado o libre de deuda.

## Consultar el estado actual

1. Identificar el commit y el árbol de trabajo (`git rev-parse HEAD`, `git status`).
2. Consultar la ejecución de [CI](.github/workflows/ci-cd.yml) correspondiente a ese
   commit. Comprobar los resultados y los artefactos, no solo el título del PR.
3. Leer `quality-metrics`, `maintenance-debt-scorecard` y
   `release-readiness-scorecard` de esa ejecución. Revisar commit, procedencia,
   entradas y controles pendientes. Una fecha de generación reciente no basta.
4. Para una medición local, seguir los comandos de
   [evidencia y mantenimiento](docs/FOUNDATION_MAINTENANCE_CADENCE.md). Un resultado
   local no acredita por sí solo el despliegue ni la operación clínica real.

Los archivos versionados en `reports/` y los informes generados en `docs/` son
snapshots. No atribuir sus cifras al código actual sin verificar su procedencia.

## Deuda y decisiones

- [Registro de deuda](docs/TECHNICAL_DEBT_REGISTER.md): contexto y fuentes para
  consultar deuda activa; los elementos cerrados conservan su alcance histórico.
- [Política de cambios](docs/ENGINEERING_CHANGE_DECISION_POLICY.md): priorizar por
  riesgo, testabilidad y acoplamiento; no por número de archivos o PR.
- [Arquitectura vigente](docs/architecture.md) y
  [contribución](CONTRIBUTING.md): límites y controles aplicables.
- [Mapa documental](docs/DOCUMENTATION_MAP.md): distinguir guías, historia y
  evidencia generada.

## Historia

Los cierres [B01–B26](docs/FOUNDATION_TRACKER.md) y
[R00–R06](docs/FOUNDATION_CONTINUATION_TRACKER.md) describen sus propias etapas.
Sus porcentajes, resultados y próximos pasos no son el estado de la versión actual.
