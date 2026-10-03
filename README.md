# HHR (Hospital Handoff Record)

Aplicación web médica para censo hospitalario, entrega de turno y gestión operativa clínica.

Modelo de acceso:

- [Auth Access Model](docs/AUTH_ACCESS_MODEL.md)
- [Runbook Auth Access Incidents](docs/RUNBOOK_AUTH_ACCESS_INCIDENTS.md)

## Quick Start

Seguir [Preparar el entorno](CONTRIBUTING.md#preparar-el-entorno) para instalar con
el lockfile vigente y configurar el entorno local autorizado. No copiar datos
clínicos ni credenciales a ejemplos, commits o evidencia de PR.

Las versiones de runtime se declaran en [package.json](package.json) y
[functions/package.json](functions/package.json); Functions conserva su propio
manifest y lockfile. Los comandos de desarrollo, validación y cierre se eligen en
[Developer Commands](docs/DEVELOPER_COMMANDS.md). La configuración de Vite está en
[vite.config.ts](vite.config.ts).

## Tech Stack

| Capa                  | Tecnología                          | Uso                                          |
| --------------------- | ----------------------------------- | -------------------------------------------- |
| Frontend              | React 19 + TypeScript               | UI tipada y composición por hooks            |
| Bundler               | Vite 6                              | Dev server, build, alias `@`                 |
| Estilos               | Tailwind CSS 4 + CSS variables      | Design system clínico y temas                |
| Estado servidor/cache | TanStack Query                      | Cache, invalidación, sincronización reactiva |
| Estado app            | Context API + hooks especializados  | Estado global, auth, UI y censo              |
| Persistencia local    | IndexedDB (Dexie) + localStorage    | Offline-first + fallback                     |
| Persistencia remota   | Firebase Firestore + Auth + Storage | Datos clínicos, autenticación, backup        |
| Validación            | Zod + validaciones de dominio       | Integridad de entrada y contratos            |
| Testing               | Vitest + RTL + Playwright           | Unit, integración y e2e                      |

## Perfil Especialista

El rol `doctor_specialist` entra por el login habitual de Google y usa una policy transversal, sin modos de acceso alternativos.

Alcance actual:

- módulos visibles: `CENSUS` y `MEDICAL_HANDOFF`
- censo: vista abreviada, sin edición de datos censales
- documentos clínicos: lectura y edición de borradores
- entrega médica: edición clínica restringida por día actual

Restricciones clave:

- no firma entrega médica
- no envía por WhatsApp
- no usa funciones administrativas
- no edita entregas médicas de días previos

Los accesos directos al handoff médico ya no usan un “modo especialista” separado; son deep-links normales al módulo `MEDICAL_HANDOFF`.

## Privacidad local del puesto

El PIN local es un bloqueo rápido de privacidad visual en el navegador/dispositivo actual.

- Se guarda solo localmente.
- Puede bloquear al abrir la app o por inactividad.
- No reemplaza login, logout, permisos clínicos ni controles server-side.

## Comandos Principales

El [catálogo de comandos](docs/DEVELOPER_COMMANDS.md) es la referencia operativa:
explica qué ejecutar durante la edición, antes del merge y antes de un release.
`package.json` conserva las definiciones ejecutables; no encadenar gates que ya
incluyen los mismos controles.

## Estructura del Proyecto

### Raíz

| Path               | Propósito                                      |
| ------------------ | ---------------------------------------------- |
| `src/`             | Código fuente principal                        |
| `docs/`            | Documentación técnica y operativa              |
| `scripts/`         | Scripts de calidad/arquitectura y utilidades   |
| `e2e/`             | Tests end-to-end y visuales                    |
| `public/`          | Assets estáticos públicos                      |
| `functions/`       | Firebase Functions                             |
| `firestore.rules`  | Reglas de seguridad de Firestore               |
| `vite.config.ts`   | Configuración Vite y plugins                   |
| `vitest.config.ts` | Configuración de pruebas unitarias/integración |

### Capas en `src/`

| Capa/Directorio    | Rol                                                                               |
| ------------------ | --------------------------------------------------------------------------------- |
| `src/features/`    | Módulos de negocio por feature (census, handoff, transfers, etc.)                 |
| `src/application/` | Casos de uso compartidos, outcomes y puertos                                      |
| `src/components/`  | Componentes UI reutilizables y layout global                                      |
| `src/hooks/`       | Hooks de orquestación y lógica de aplicación                                      |
| `src/context/`     | Context providers y contratos de estado global                                    |
| `src/services/`    | Acceso a datos, repositorios, integración externa y utilidades de infraestructura |
| `src/domain/`      | Lógica de dominio transversal                                                     |
| `src/shared/`      | Runtime adapters y tipos transversales de UI                                      |
| `src/types/`       | Contratos TypeScript de entidades y DTOs                                          |
| `src/schemas/`     | Esquemas de validación                                                            |
| `src/utils/`       | Helpers puros transversales                                                       |
| `src/tests/`       | Pruebas por capa y por feature                                                    |

Taxonomía canónica y reglas de ownership: [docs/CODEBASE_CANON.md](docs/CODEBASE_CANON.md)

## Path Aliases

Definidos en `tsconfig.json` y `vite.config.ts`:

| Alias | Resuelve a |
| ----- | ---------- |
| `@/`  | `src/`     |

Ejemplo:

```ts
import { useDailyRecord } from '@/hooks/useDailyRecord';
```

## Índice de Documentación

### Documentos troncales

- [Índice operativo de runbooks](docs/RUNBOOK_INDEX.md)
- [Mapa global de documentación](docs/DOCUMENTATION_MAP.md)
- [Auditoría técnica de la aplicación](docs/TECHNICAL_APPLICATION_AUDIT.md)
- [Taxonomía canónica del código](docs/CODEBASE_CANON.md)
- [Modelo de acceso y login](docs/AUTH_ACCESS_MODEL.md)
- [Runbook de incidentes de acceso](docs/RUNBOOK_AUTH_ACCESS_INCIDENTS.md)
- [Arquitectura global](docs/architecture.md)
- [Comandos de desarrollo](docs/DEVELOPER_COMMANDS.md)
- [Runbook de sync y resiliencia](docs/RUNBOOK_SYNC_RESILIENCE.md)
- [Checklist diario admin (1 pagina)](docs/RUNBOOK_DAILY_ADMIN_CHECKLIST.md)
- [Runbook técnico de soporte](docs/RUNBOOK_SUPPORT_OPERATIONS.md)
- [Runbook de rotación de secretos](docs/RUNBOOK_SECRET_ROTATION.md)
- [Guardrails de calidad](docs/QUALITY_GUARDRAILS.md)
- [Gates de CI y runbooks de falla](docs/CI_GATES_AND_FAILURE_RUNBOOKS.md)
- [Scorecard de release readiness](reports/release-readiness-scorecard.md)
- [Gobernanza de guardrails](reports/guardrail-governance.md)
- [Política de cambio sostenible](scripts/config/sustainable-change-policy.json) (reporte: `npm run report:sustainable-change-policy`)
- [Baseline de ejecución técnica](scripts/config/technical-execution-baseline.json) (reporte: `npm run report:technical-execution-baseline`)
- [Checklist de cambio seguro](docs/SAFE_CHANGE_CHECKLIST.md)
- [Política de decisión para cambios de ingeniería](docs/ENGINEERING_CHANGE_DECISION_POLICY.md)
- [Definition of Done técnico](docs/ENGINEERING_DEFINITION_OF_DONE.md)
- [Registro de deuda técnica](docs/TECHNICAL_DEBT_REGISTER.md)
- [ADR Repository Provider obligatorio](docs/ADR_REPOSITORY_PROVIDER_REQUIRED.md)
- [ADR fachada de access policy](docs/ADR_ACCESS_POLICY_FACADE.md)
- [ADR boundary de application](docs/ADR_APPLICATION_BOUNDARY_ENFORCEMENT.md)
- [ADR daily-record runtime path](docs/ADR_DAILY_RECORD_RUNTIME_PATH.md)
- [ADR auth runtime recovery](docs/ADR_AUTH_RUNTIME_RECOVERY.md)
- [ADR clinical-documents workspace contract](docs/ADR_CLINICAL_DOCUMENT_WORKSPACE_CONTRACT.md)
- [ADR handoff runtime surfaces](docs/ADR_HANDOFF_RUNTIME_SURFACES.md)
- [Mapa de código fuente](src/README.md)
- [Historial de cimientos](docs/FOUNDATION_TRACKER.md)

### Documentación existente relevante

- [docs/architecture.md](docs/architecture.md)
- [docs/data-flow.md](docs/data-flow.md)
- [docs/system-behaviors.md](docs/system-behaviors.md)
- [docs/testing/README.md](docs/testing/README.md)

### READMEs por directorio principal de `src/`

- [src/adapters/README.md](src/adapters/README.md)
- [src/assets/README.md](src/assets/README.md)
- [src/components/README.md](src/components/README.md)
- [src/config/README.md](src/config/README.md)
- [src/constants/README.md](src/constants/README.md)
- [src/context/README.md](src/context/README.md)
- [src/core/README.md](src/core/README.md)
- [src/docs/README.md](src/docs/README.md)
- [src/domain/README.md](src/domain/README.md)
- [src/features/README.md](src/features/README.md)
- [src/hooks/README.md](src/hooks/README.md)
- [src/infrastructure/README.md](src/infrastructure/README.md)
- [src/schemas/README.md](src/schemas/README.md)
- [src/services/README.md](src/services/README.md)
- [src/shared/README.md](src/shared/README.md)
- [src/styles/README.md](src/styles/README.md)
- [src/tests/README.md](src/tests/README.md)
- [src/types/README.md](src/types/README.md)
- [src/utils/README.md](src/utils/README.md)
- [src/views/README.md](src/views/README.md)

### READMEs de profundización (módulos críticos)

- [src/features/census/README.md](src/features/census/README.md)
- [src/hooks/controllers/README.md](src/hooks/controllers/README.md)
- [src/components/modals/README.md](src/components/modals/README.md)
- [src/services/repositories/README.md](src/services/repositories/README.md)
- [src/services/storage/README.md](src/services/storage/README.md)

## Testing y cierre de cambios

- [Contribuir](CONTRIBUTING.md): ciclo completo desde la instalación hasta el PR.
- [Tests](src/tests/README.md): estructura y convenciones de las pruebas.
- [Developer Commands](docs/DEVELOPER_COMMANDS.md): selección de comandos por escenario.
- [Safe Change Checklist](docs/SAFE_CHANGE_CHECKLIST.md): controles exigidos por alcance.
- [CI y recuperación](docs/CI_GATES_AND_FAILURE_RUNBOOKS.md): diagnóstico de fallos.

Las pruebas focalizadas ayudan a iterar; no sustituyen los controles del SHA final.

## Baseline de Calidad

`reports/` está en `.gitignore`, pero eso no elimina archivos que ya fueron versionados.
Una copia incluida en Git puede ser un snapshot histórico: su presencia o un score verde
no demuestran el estado actual. Revisar su fecha, `generatedFor`/`gitSha` y las entradas
que declara antes de usarla como evidencia. La regla del repo es regenerar los reportes
desde el código en cada validación:

- En CI, `critical-coverage-report` genera `reports/critical-coverage.*` como artifact explícito. Luego `quality-static-governance-snapshots` lo descarga, corre `npm run report:governance-snapshots`, valida `npm run check:report-freshness:strict` y publica `reports/ci-governance-snapshot-profile.*`.
- Tras un merge a `main`, el job `postmerge-evidence` corre `npm run postmerge:evidence` y publica `reports/postmerge-evidence.*` como artifact formal del merge commit. Esta evidencia no reemplaza los gates del PR: deja trazabilidad del estado ya integrado en `main`.
- En local hay que regenerarlos antes de tratarlos como evidencia.

Para evaluar un PR o un merge, usar los artefactos de la ejecución de CI que corresponde
al SHA evaluado. `critical-coverage` contiene la cobertura medida; `confidence-and-readiness`
incorpora la evidencia final del preview; `ci-runtime-observed-profile` conserva tiempos
observados. El manifiesto `release-evidence-runtime` vincula la evidencia al build.
Una ejecución pendiente o fallida no es una validación aprobada, y CI aprobado por sí
solo no confirma el despliegue ni una sincronización real con Eloísa. El procedimiento
canónico está en el [runbook de evidencia](docs/RUNBOOK_RELEASE_EVIDENCE_CONTRACT.md).

Ejemplos de snapshots versionados (excepción al `.gitignore`; verificar vigencia antes de citarlos):

- [reports/architectural-hotspots.md](reports/architectural-hotspots.md)
- [reports/legacy-bridge-governance.md](reports/legacy-bridge-governance.md)
- [reports/runtime-contracts.md](reports/runtime-contracts.md)

Para regenerar evidencia, seguir el
[runbook de release](docs/RUNBOOK_RELEASE_EVIDENCE_CONTRACT.md). Para una evaluación
periódica y elegir el siguiente cambio, seguir la
[cadencia de mantenimiento](docs/FOUNDATION_MAINTENANCE_CADENCE.md).
No trasladar cifras de un snapshot histórico a una afirmación sobre el estado actual.

## Convenciones de Calidad (resumen)

- Controladores (`controllers`) y hooks no deben importar implementaciones de componentes.
- Se controla deuda arquitectónica con `scripts/check-architecture.mjs`.
- Se controla tamaño máximo por módulo con `scripts/check-module-size.mjs`.
- Se controlan boundaries runtime para evitar acoplamiento directo a `window/alert/confirm` en zonas críticas.

> ⚠️ IMPORTANT: When modifying any layer, update the corresponding README.md in that directory.
