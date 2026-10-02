# Arquitectura Técnica HHR

Documento de referencia para entender cómo se organiza el sistema, cómo fluyen los datos y cómo se validan cambios.

## 1) Diagrama de Capas (ASCII)

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Presentation Layer                                                         │
│ - src/views                                                                │
│ - src/components                                                           │
│ - src/features/*/components                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Application Layer                                                          │
│ - src/application                                                          │
│ - src/hooks                                                                │
│ - src/context                                                              │
│ - src/features/*/hooks                                                     │
│ - src/features/*/controllers                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Domain Layer                                                               │
│ - src/domain                                                               │
│ - src/features/*/domain                                                    │
│ - src/types                                                                │
│ - src/schemas                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Infrastructure/Data Layer                                                  │
│ - src/services/repositories                                                │
│ - src/services/storage                                                     │
│ - src/infrastructure                                                       │
│ - Firebase (Firestore/Auth/Storage)                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2) Reglas de Dependencia entre Capas

| Desde                     | Puede depender de                          | No debe depender de                                                  |
| ------------------------- | ------------------------------------------ | -------------------------------------------------------------------- | ------- | --------------------------------------- | -------------------------------------------- |
| `components` / `views`    | hooks, context, feature controllers, types | services de bajo nivel directo (salvo casos legacy), infraestructura |
| `hooks`                   | controllers, services, types, utils        | implementación de componentes (`.tsx`)                               |
| `application`             | repositories, domain, types, utils         | componentes React, JSX, runtime UI directo                           |
| `controllers`             | domain, types, utils, contratos            | componentes React                                                    |
| `domain`                  | types, utils puros                         | React, context, UI                                                   |
| `services/repositories`   | services/storage, integrations, types      | componentes/hook de UI                                               |
| `features/\*/(controllers | hooks                                      | domain                                                               | types)` | su propia feature + shared/domain común | cross-feature acoplado (reglas restringidas) |

### Reglas verificadas automáticamente

- `scripts/check-architecture.mjs`
- `scripts/check-module-size.mjs`
- `scripts/check-census-runtime-boundary.mjs`
- `scripts/check-runtime-adapter-boundary.mjs`
- `scripts/check-auth-feature-boundary.mjs`
- `scripts/check-clinical-documents-feature-boundary.mjs`
- `scripts/check-lazy-views-feature-entrypoints.mjs`

Reglas específicas adicionales:

- En código productivo (`src/**` fuera de tests y `DailyRecordContext`) no se permite `useDailyRecordActions`; deben usarse hooks acotados (`useDailyRecordBedActions`, `useDailyRecordMovementActions`, `useDailyRecordDayActions`, etc.).
- En código productivo, si ya existe un use-case o port equivalente, `hooks`, `components` y `features` no deben importar directo `auditService`, `DailyRecordRepository`, `ClinicalDocumentRepository` ni `censusEmailService`.
- El consumo externo a una feature debe entrar por `index.ts` o `public.ts`; dentro de la feature,
  preferir imports relativos para distinguir implementación interna de API pública. El primer
  guardrail específico de esta familia empezó por `auth` y `clinical-documents`
  (`npm run check:auth-feature-boundary`, `npm run check:clinical-documents-feature-boundary`).
- Las superficies acotadas de Rayen están declaradas por consumidor en el guardrail de API pública:
  `census-status` para ayudantes de las filas y `clinical-panel` para lectura y navegación del
  paciente. El panel usa los mismos bridges y parsers sin depender del barril de reconciliación,
  importación o confirmación del censo; `index.ts` mantiene su API compatible para esos flujos.
- El router/lazy loading también debe consumir features por entrypoint público; `LazyViews.ts`
  no debe volver a importar `components/...` directos cuando la feature ya expone `index.ts`
  o `public.ts`.
- `src/application/ports/*` es el boundary permitido para adapters por defecto a servicios concretos.
- El guardrail automático correspondiente es `npm run check:application-port-boundary`.

### ADRs de cambio seguro por subsistema

- `daily-record/sync`: [ADR_DAILY_RECORD_RUNTIME_PATH.md](ADR_DAILY_RECORD_RUNTIME_PATH.md)
- `auth`: [ADR_AUTH_RUNTIME_RECOVERY.md](ADR_AUTH_RUNTIME_RECOVERY.md)
- `clinical-documents`: [ADR_CLINICAL_DOCUMENT_WORKSPACE_CONTRACT.md](ADR_CLINICAL_DOCUMENT_WORKSPACE_CONTRACT.md)
- `handoff`: [ADR_HANDOFF_RUNTIME_SURFACES.md](ADR_HANDOFF_RUNTIME_SURFACES.md)

## 3) Flujo de Datos (Write)

### Write path principal (censo)

```text
UI (Modal/Row Action)
  -> feature hook (useCensus*Command / use*ModalForm)
  -> controller (resolve*Command / validation)
  -> runtime command executor
  -> dailyRecord actions (useDailyRecord)
  -> usePatientDischarges / usePatientTransfers / useBedManagement
  -> Repository (DailyRecordRepository.save/updatePartial)
  -> IndexedDB + Firestore sync
  -> Query cache invalidation/subscription
  -> UI refresh reactivo
```

### Write path parcial (optimista)

```text
patchRecord(partial)
  -> usePatchDailyRecordMutation.onMutate (optimistic update)
  -> repository.updatePartial
  -> Firestore subscription confirma estado final
```

## 4) Flujo de Datos (Read)

```text
Date navigation / module load
  -> useDailyRecordSyncQuery
  -> useDailyRecordQuery(date)
  -> dailyRecord.getForDate(date)
  -> Repository read service
  -> IndexedDB/Firestore según disponibilidad
  -> query cache
  -> contexts/hooks derivados
  -> components/views
```

## 5) State Management

| Tipo de estado                   | Ubicación                                           | Estrategia                                |
| -------------------------------- | --------------------------------------------------- | ----------------------------------------- |
| Estado remoto/cache              | TanStack Query (`src/hooks/useDailyRecordQuery.ts`) | Query/mutation con invalidación y refetch |
| Estado global de sesión/UI       | Contexts (`src/context/*.tsx`)                      | Providers con hooks de acceso             |
| Estado de negocio por feature    | `src/features/*/hooks` + `controllers`              | Modelo de estado local + comandos tipados |
| Estado transitorio de formulario | `useModalFormFlow` + controllers                    | `init -> validate -> submit`              |

### Contextos relevantes

- `AuthContext`
- `DailyRecordContext` (fragmentado para reducir re-renders)
- `UIContext`
- `CensusActionsContext` (estado y comandos desacoplados en hooks/controllers)

## 6) Estrategia de Persistencia

### Fuentes de datos

| Nivel          | Implementación                                               | Rol                                             |
| -------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| Repositorio    | `src/services/repositories/dailyRecordRepository*Service.ts` | Split canónico de lectura/escritura/suscripción |
| Local primario | IndexedDB (`src/services/storage/indexedDBService.ts`)       | Offline-first                                   |
| Local fallback | localStorage (`src/services/storage/localStorageService.ts`) | Degradación controlada                          |
| Remoto         | Firestore services                                           | Sincronización multi-dispositivo                |

### Características

- Optimistic updates para latencia baja.
- Suscripción en tiempo real para convergencia de estado.
- Sync status expuesto a UI.
- Demo mode y rutas de migración para datos legacy.

## 7) Estrategia de Testing

| Nivel            | Ubicación                                    | Herramienta       | Objetivo                                   |
| ---------------- | -------------------------------------------- | ----------------- | ------------------------------------------ |
| Unit             | `src/tests/**`                               | Vitest            | Lógica de controllers/hooks/utils/services |
| Integración      | `src/tests/integration/**`                   | Vitest + RTL      | Flujos entre hooks, repositorios y UI      |
| Seguridad reglas | `src/tests/security/firestore-rules.test.ts` | Vitest + emulator | Validar reglas Firestore                   |
| E2E              | `e2e/**`                                     | Playwright        | Flujo de usuario extremo a extremo         |

### Comandos recomendados por pipeline

```bash
npm run typecheck
npm run check:quality
npm run test
```

## 8) Patrones de Arquitectura en uso

- **Feature-first híbrido**: módulos por feature + capas transversales (`services`, `shared`, `types`).
- **Controller pattern**: lógica de validación, transformación y comandos fuera de componentes.
- **Application use cases**: coordinación explícita de operaciones críticas sobre repositorios y outcomes homogéneos.
- **Operational telemetry**: el core reporta eventos estructurados (`auth`, `daily_record`, `sync`, `indexeddb`, `export`, `backup`, `clinical_document`, `reminders`, `transfers`, `create_day`, `handoff`) a una telemetría local persistida y puede reenviarlos a un adapter externo opt-in vía `VITE_OPERATIONAL_TELEMETRY_ENDPOINT`.
- **Domain observability adapters**: los contextos críticos deben emitir eventos a través de wrappers por dominio (`authOperationalTelemetry`, `dailyRecordObservability`, `reminderObservability`, `clinicalDocumentObservability`, `storage`/`sync` adapters) y no depender directamente del servicio genérico salvo en sinks/base infra.
- **Error service facade**: `src/services/utils/errorService.ts` expone la API pública estable; `errorServiceController.ts` clasifica/reintenta y `errorServiceSinks.ts` decide persistencia IndexedDB, auditoría, consola de desarrollo y reenvío externo.
- **Sync queue orchestration**: `syncQueueEngine.ts` orquesta; `syncQueueFailurePolicy.ts` decide transiciones y retry budget; `syncQueueTelemetryController.ts` concentra snapshots y reporting operativo.
- **Configuración de observabilidad externa**:
  - `VITE_OPERATIONAL_TELEMETRY_ENDPOINT`: endpoint HTTP `POST` vendor-agnostic para reenviar eventos del core.
  - `VITE_OPERATIONAL_TELEMETRY_SAMPLE_RATE`: fracción `0..1` usada por el adapter para muestrear eventos.
  - Política de emisión:
    - `failed`: siempre.
    - `partial` / `degraded`: siempre que afecten operación clínica, sync o respaldo.
    - `success`: solo para operaciones críticas seleccionadas.
  - El payload reenviado mantiene `category`, `status`, `operation`, `date`, `issues`, `context` y `source=hhr_operational_telemetry`.
- **Ports/adapters**: los use-cases hablan con contratos (`AuditPort`, `DailyRecordReadPort`, `DailyRecordWritePort`, `CensusEmailDeliveryPort`, `ClinicalDocumentPort`) y los adapters por defecto viven en `src/application/ports/*`.
- Casos ya migrados en primera ola:
  - inicialización/sync de `dailyRecord`
  - episodio clínico compartido
  - envío médico de handoff
  - análisis/migración de pacientes
- Casos ya migrados en segunda ola:
  - escritura/lectura de auditoría
  - bootstrap/sync/CRUD de listas de destinatarios de censo
  - persistencia/firma/desfirma/exportación de documentos clínicos
- Casos ya modularizados por bounded context:
  - `backup-export/backupExportStorageUseCases`
  - `backup-export/backupExportArchiveUseCases`
  - `backup-export/backupExportMaintenanceUseCases`
- **Repository pattern**: acceso a datos desacoplado de la UI.
- **Runtime adapter pattern**: encapsulación de efectos de browser (`alert`, `confirm`, `reload`, `open`).
- **Form flow unificado**: `useModalFormFlow` en modales críticos.

### Boundary operativo actual

```text
components/features
  -> hooks facade
  -> controllers puros
  -> application use cases
  -> application ports
  -> services / repositories / storage
```

Regla práctica:

```text
Si una operación remota ya tiene use-case o port,
la UI no importa el servicio concreto.
```

## 9) Riesgos técnicos actuales (no seguridad)

| Riesgo                                  | Impacto                | Mitigación sugerida                                                                                                   |
| --------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Tamaño del módulo en feature `census`   | Complejidad alta       | Seguir extrayendo controllers por bounded context                                                                     |
| Coexistencia de capas legacy y nuevas   | Curva de mantenimiento | Consolidar readmes + reglas de arquitectura por capa                                                                  |
| Acoplamiento histórico en algunos hooks | Riesgo de regresión    | Aumentar tests de borde + contracts tests                                                                             |
| Outcomes remotos heterogéneos           | UX inconsistente       | Traducir sync/export a `ApplicationOutcome`                                                                           |
| Hotspots legacy de coordinación         | Mantenimiento costoso  | Seguir migrando `useAudit`, `useCensusEmail`, `ClinicalDocumentsWorkspace` y `useBedManagement` a fachada + use-cases |

## 10) Guía rápida para cambios nuevos

1. Definir contrato de entrada/salida en `types` o `domain/contracts`.
2. Implementar lógica en `controllers` (sin React ni efectos runtime directos).
3. Conectar con hook de feature.
4. Integrar en componente presentacional.
5. Agregar test unitario del controller + test de integración mínimo.
6. Ejecutar `typecheck`, `check:quality`, `test`.

## Dependencias de CI reutilizadas sin cambiar el grafo

Los jobs compatibles Node 22 de la raíz usan la acción existente
`.github/actions/setup-ci-dependencies`. La clave exacta incluye imagen del runner,
OS, arquitectura, versión efectiva de Node, manifiesto, lockfile, `.npmrc` y la
acción. No hay restauración por prefijo. Un miss o fallo de caché ejecuta `npm ci`;
un fallo de instalación sigue bloqueando el job.

Solo `quality-static-base` publica la instalación prístina, antes de los checks.
Los demás jobs leen la caché sin esperar un productor nuevo: las dependencias,
condiciones y matrices del workflow se conservan. Functions mantiene sus dos
lockfiles e instalaciones; la documentación API mantiene Node 20. No se comparten
emuladores ni builds de escenarios diferentes.
