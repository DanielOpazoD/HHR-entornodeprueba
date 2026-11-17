# Pruebas visuales

El spec de regresión visual con baselines (`e2e/visual-regression.spec.ts`, `npm run test:vrt`) se
borró el 17 de noviembre de 2026: ningún workflow lo corría, sus baselines solo valían en macOS y tres
de sus casos eran `test.fixme` vacíos. Lo visual del censo lo cubre el nocturno
`census-13-inch-visual.spec.ts`.

## Smoke Visual De Release

El release ejecuta un smoke visual sin snapshots:

| Comando                                    | Qué cubre                                                                                                                                                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:e2e:clinical-visual-release` | Censo autenticado, creación de documento clínico, CUDYR con acceso a Excel mensual y creación de entrega médica con datos determinísticos. Adjunta capturas Playwright y falla ante overflow horizontal. |

Este smoke vive en [clinical-release-visual-smoke.spec.ts](../../e2e/clinical-release-visual-smoke.spec.ts). Aporta evidencia visual operativa rápida para release sin exigir regenerar PNGs de referencia. El flujo no solo abre superficies: deja evidencia de que el usuario puede iniciar un documento clínico editable, abrir CUDYR con su entrada de Excel mensual y crear una entrega médica mínima. Está conectado al perfil `full` de `test:release-confidence` como paso `extended`, no al perfil `blocking`.
