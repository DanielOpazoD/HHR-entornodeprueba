# HHR (Hospital Handoff Record)

Aplicación web médica para censo hospitalario, entrega de turno y gestión operativa clínica.

Modelo de acceso:

- [Auth Access Model](docs/AUTH_ACCESS_MODEL.md)
- [Runbook Auth Access Incidents](docs/RUNBOOK_AUTH_ACCESS_INCIDENTS.md)

## Quick Start

### Requisitos

- Node.js 22.x
- npm 10+
- Firebase project (variables de entorno en `.env`)

### Política de versiones de Node

- El workspace principal (`package.json`) usa Node.js `22.x` para desarrollo local, tests, lint, typecheck y build.
- `functions/package.json` mantiene runtime Node.js `20` porque ese sigue siendo el target actual de Firebase Functions para este proyecto.
- Si se cambia alguno de esos targets, esta sección debe actualizarse junto con ambos `package.json`.

### Instalación

```bash
npm install
```

### Desarrollo

```bash
npm run dev
```

Por defecto Vite inicia en `http://localhost:3000`.

Si necesitas `3005`:

```bash
npm run dev -- --port 3005
```

### Variables de entorno

- `VITE_FIREBASE_*`: configuración cliente de Firebase para desarrollo local.
- `VITE_FIREBASE_API_KEY_B64`: alternativa opcional a la API key plana.
- `VITE_LEGACY_FIREBASE_*`: configuración opcional de solo lectura para imports/control de compatibilidad desde el proyecto legacy.
- `VITE_FUNCTIONS_EMULATOR_HOST`, `VITE_AUTH_EMULATOR_HOST`, `VITE_FIRESTORE_EMULATOR_HOST`: solo para emuladores locales.
- `VITE_LOCAL_GEMINI_API_KEY`: solo fallback local de CIE-10 en `localhost`.
- `GEMINI_API_KEY`, `API_KEY`, `GMAIL_*`: uso server-side en Netlify Functions, nunca como `VITE_*`.
- `VITE_ALLOW_DEV_EMAIL_SEND`: habilita pruebas reales de email solo en desarrollo local.

### Build y preview

```bash
npm run build
npm run preview
```

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

| Comando                   | Objetivo                                               |
| ------------------------- | ------------------------------------------------------ |
| `npm run dev`             | Levantar app en modo desarrollo                        |
| `npm run typecheck`       | Verificación TypeScript                                |
| `npm run lint`            | Lint global con tolerancia cero a warnings             |
| `npm run test:ci:unit`    | Suite unitaria/integración base sin reglas ni emulador |
| `npm run check:quality`   | Guardrails estructurales y de gobernanza               |
| `npm run ci:inner-loop`   | Ruta rápida para trabajo local                         |
| `npm run ci:pre-merge`    | Gate compacto obligatorio antes de merge               |
| `npm run ci:merge-gate`   | Gate blocking ampliado para cambios sensibles          |
| `npm run ci:release-gate` | Validación final con Firestore/emuladores/E2E críticos |

El resto de `check:*`, `report:*` y `test:*` especializados siguen soportados, pero se consideran herramientas focalizadas. Catálogo curado: [docs/DEVELOPER_COMMANDS.md](docs/DEVELOPER_COMMANDS.md)

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
- [Política de cambio sostenible](reports/sustainable-change-policy.md)
- [Baseline de ejecución técnica](reports/technical-execution-baseline.md)
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
- [Tracker de cimientos](docs/FOUNDATION_TRACKER.md)

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

## Testing

### Validación rápida recomendada

```bash
npm run typecheck
npm run check:quality
npm run test:risk:admin-health
npm run test:sync-load
```

### Suite completa

```bash
npm run test
```

### Cobertura

```bash
npm run test:coverage
```

### End-to-end

```bash
npm run test:e2e
npm run test:e2e:critical
E2E_CRITICAL_BROWSERS=chromium,firefox npm run test:e2e:critical
```

## Gates de CI (actual)

Mapa operativo resumido:

- `npm run ci:inner-loop`
- `npm run ci:pre-merge`
- `npm run ci:merge-gate`
- `npm run ci:release-gate`

Runbook detallado:

- [docs/CI_GATES_AND_FAILURE_RUNBOOKS.md](docs/CI_GATES_AND_FAILURE_RUNBOOKS.md)

Artifacts operativos publicados por CI:

- `quality-metrics`
- `operational-health`
- `runtime-contracts`
- `critical-coverage`
- `governance-snapshot-profile`
- `postmerge-release-evidence` (solo `push` a `main`)
- `flow-performance-budget`

## Baseline de Calidad

`reports/` está en `.gitignore`. La regla del repo es regenerar los reportes desde el código en cada validación:

- En CI, `critical-coverage-report` genera `reports/critical-coverage.*` como artifact explícito. Luego `quality-static-governance-snapshots` lo descarga, corre `npm run report:governance-snapshots`, valida `npm run check:report-freshness:strict` y publica `reports/ci-governance-snapshot-profile.*`.
- Tras un merge a `main`, el job `postmerge-evidence` corre `npm run postmerge:evidence` y publica `reports/postmerge-evidence.*` como artifact formal del merge commit. Esta evidencia no reemplaza los gates del PR: deja trazabilidad del estado ya integrado en `main`.
- En local hay que regenerarlos antes de tratarlos como evidencia.

Snapshots versionados explícitamente (excepción documentada al `.gitignore`, mantenidos a mano):

- [reports/architectural-hotspots.md](reports/architectural-hotspots.md)
- [reports/legacy-bridge-governance.md](reports/legacy-bridge-governance.md)
- [reports/runtime-contracts.md](reports/runtime-contracts.md)

Flujo local recomendado antes de citar cualquier otro `reports/*.md` como evidencia:

```bash
git status --short
npm run report:critical-coverage
npm run report:governance-snapshots
npm run check:report-freshness
```

Flujo local rapido cuando `reports/critical-coverage.*` ya fue generado para el mismo `gitSha` y el mismo estado clean/dirty:

```bash
git status --short
npm run report:governance-snapshots
npm run check:report-freshness:strict
```

`check:report-freshness:strict` acepta evidencia generada para `HEAD`. Si un reporte fue generado para un padre directo de un merge commit, solo se acepta como evidencia transitoria cuando declara `generatedFor.dependencyFingerprint` y ese fingerprint coincide con las dependencias transitivas actuales del reporte. Si falla por `stale by commit ancestry`, hay que regenerar el reporte para el commit actual. Si falla por `stale by real dependency fingerprint`, cambió una entrada real del grafo y corresponde correr el comando sugerido por el guardrail o `npm run postmerge:evidence` en `main`.

`report:release-readiness-scorecard` reutiliza `reports/critical-coverage.*` solo si:

- `reports/critical-coverage.json` declara el `gitSha` actual.
- El estado `gitDirty` coincide con el worktree actual.
- `reports/critical-coverage.json` y `.md` existen.
- Las dependencias de cobertura critica (`scripts/config/critical-coverage-thresholds.json`, runner, soporte y config Vitest) no son mas nuevas que el artifact.

Si cualquiera de esas condiciones falla, el runner recalcula `npm run report:critical-coverage`. Esta politica evita cache opaco: el artifact es descargable desde CI y la razon de reuso o recalculo queda visible en consola y en `reports/ci-governance-snapshot-profile.*`.

Si `check:report-freshness` falla o el árbol está sucio, los reportes dejan de ser fuente confiable para describir el estado actual.

Riesgos residuales:

- Si cambia la matriz clinica de tests sin tocar los archivos gobernados de cobertura critica, hay que forzar `npm run report:critical-coverage` antes de publicar evidencia.
- `critical-coverage-report` corre en paralelo con lint/typecheck para bajar tiempo de pared, pero sigue siendo un gate completo; no elimina cobertura ni relaja `check:report-freshness:strict`.

## Notas Operativas Recientes

- **Auth por entorno:** el acceso alternativo de Google se valida contra la configuración real de Firebase antes de intentarse. En `localhost` queda desactivado por defecto para evitar bucles y la app muestra advertencias tempranas si faltan variables críticas de Firebase.
- **Fallback local:** si IndexedDB falla tras borrar datos del sitio o por un problema del navegador, la app intenta una recuperación automática antes de mostrar avisos al usuario.
- `0` archivos marcados con flake-risk

Validación usada para esta línea base:

```bash
npm run typecheck
npm run lint -- --max-warnings 0
npm run check:quality
npm run test:ci:unit
npm run report:quality-metrics
```

### Próximo hotspot recomendado

Hotspots secundarios:

- `src/services/integrations/whatsapp/whatsappService.ts`
- `src/hooks/useAuthState.ts`
- `src/features/auth/components/LoginPage.tsx`
- `src/services/cudyr/cudyrWorkbookBuilder.ts`
- `src/features/handoff/components/HandoffCudyrPrint.tsx`

## Convenciones de Calidad (resumen)

- Controladores (`controllers`) y hooks no deben importar implementaciones de componentes.
- Se controla deuda arquitectónica con `scripts/check-architecture.mjs`.
- Se controla tamaño máximo por módulo con `scripts/check-module-size.mjs`.
- Se controlan boundaries runtime para evitar acoplamiento directo a `window/alert/confirm` en zonas críticas.

> ⚠️ IMPORTANT: When modifying any layer, update the corresponding README.md in that directory.
