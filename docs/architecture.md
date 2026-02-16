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
| `controllers`             | domain, types, utils, contratos            | componentes React                                                    |
| `domain`                  | types, utils puros                         | React, context, UI                                                   |
| `services/repositories`   | services/storage, integrations, types      | componentes/hook de UI                                               |
| `features/\*/(controllers | hooks                                      | domain                                                               | types)` | su propia feature + shared/domain común | cross-feature acoplado (reglas restringidas) |

### Reglas verificadas automáticamente

- `scripts/check-architecture.mjs`
- `scripts/check-module-size.mjs`
- `scripts/check-census-runtime-boundary.mjs`
- `scripts/check-runtime-adapter-boundary.mjs`

Reglas específicas adicionales:

- En `src/features/census/**` no se permite `useDailyRecordActions`; deben usarse hooks acotados (`useDailyRecordBedActions`, `useDailyRecordMovementActions`, `useDailyRecordDayActions`, etc.).

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

| Nivel          | Implementación                                               | Rol                                              |
| -------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| Repositorio    | `src/services/repositories/DailyRecordRepository.ts`         | API unificada para lectura/escritura/suscripción |
| Local primario | IndexedDB (`src/services/storage/indexedDBService.ts`)       | Offline-first                                    |
| Local fallback | localStorage (`src/services/storage/localStorageService.ts`) | Degradación controlada                           |
| Remoto         | Firestore services                                           | Sincronización multi-dispositivo                 |

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
- **Repository pattern**: acceso a datos desacoplado de la UI.
- **Runtime adapter pattern**: encapsulación de efectos de browser (`alert`, `confirm`, `reload`, `open`).
- **Form flow unificado**: `useModalFormFlow` en modales críticos.

## 9) Riesgos técnicos actuales (no seguridad)

| Riesgo                                  | Impacto                | Mitigación sugerida                                  |
| --------------------------------------- | ---------------------- | ---------------------------------------------------- |
| Tamaño del módulo en feature `census`   | Complejidad alta       | Seguir extrayendo controllers por bounded context    |
| Coexistencia de capas legacy y nuevas   | Curva de mantenimiento | Consolidar readmes + reglas de arquitectura por capa |
| Acoplamiento histórico en algunos hooks | Riesgo de regresión    | Aumentar tests de borde + contracts tests            |

## 10) Guía rápida para cambios nuevos

1. Definir contrato de entrada/salida en `types` o `domain/contracts`.
2. Implementar lógica en `controllers` (sin React ni efectos runtime directos).
3. Conectar con hook de feature.
4. Integrar en componente presentacional.
5. Agregar test unitario del controller + test de integración mínimo.
6. Ejecutar `typecheck`, `check:quality`, `test`.
