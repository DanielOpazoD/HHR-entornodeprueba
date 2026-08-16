# `src/hooks`

## Propósito

Lógica de aplicación reusable y composición de casos de uso. Es el puente entre UI (`components/features`) y servicios/context.

Cuando una operación necesita coordinar repositorios, clasificar outcomes remotos o reutilizar semántica clínica cross-feature, la implementación preferida ya no es el hook directo sino `src/application/*`, dejando al hook como adaptador de UI.

## Estructura

| Path                         | Rol                                                   |
| ---------------------------- | ----------------------------------------------------- |
| `useDailyRecord.ts`          | Hook orquestador principal de censo diario            |
| `useDailyRecordQuery.ts`     | Query/mutation con React Query para registros diarios |
| `useDailyRecordSyncQuery.ts` | Sincronización, estado sync y compatibilidad de API   |
| `usePatientDischarges.ts`    | Operaciones de altas                                  |
| `usePatientTransfers.ts`     | Operaciones de traslados                              |
| `useBedManagement.ts`        | Operaciones de camas/paciente                         |
| `useHandoff*`                | Familia de hooks de entrega de turno                  |
| `useCensusEmail*`            | Preparación/envío de email de censo                   |
| `useBackup*`                 | Navegación, listing y acciones de respaldos           |
| `controllers/`               | Lógica pura usada por hooks (sin React UI)            |
| `admin/`                     | Hooks auxiliares del módulo admin                     |
| `whatsapp/`                  | Hooks de integración WhatsApp                         |

## Hooks clave (alta prioridad)

| Hook                         | Responsabilidad                                |
| ---------------------------- | ---------------------------------------------- |
| `useDailyRecord.ts`          | API consolidada de acciones/estado del censo   |
| `useDailyRecordQuery.ts`     | Lectura/suscripción/cache y optimistic updates |
| `useMovements.ts`            | Wrapper de compatibilidad para altas/traslados |
| `useHandoffCommunication.ts` | Comunicación y envío de handoff                |

## Patrones usados

- **Orchestrator Hook**: hooks agregadores que exponen API estable.
- **Application-backed hooks**: hooks que delegan casos críticos a `src/application/*` para no mezclar UI y coordinación de infraestructura.
- **Ports-backed use cases**: cuando un use-case requiere acceso remoto, la dependencia preferida es `src/application/ports/*`, no servicios concretos desde el hook.
- **Command Hooks**: ejecutan comandos tipados y notifican errores.
- **Controller-backed hooks**: validación/transformación extraída a `controllers`.
- `useDailyRecordQuery.ts` delega construcción de query/subscription/prefetch a [controllers/dailyRecordQueryController.ts](controllers/dailyRecordQueryController.ts), pero el contrato operativo quedó deliberadamente simple:
  si `remoteSyncStatus === 'ready'` y Firestore está habilitado, la query lee/suscribe remoto; si no, lee local.
- `useDailyRecordSyncQuery.ts` mantiene la API estable del censo, mapea resultados de query/mutations a `syncStatus` y expone `bootstrapPhase` sin introducir una segunda máquina de estados del runtime.
- El vocabulario de bootstrap del registro diario vive en [controllers/dailyRecordBootstrapController.ts](controllers/dailyRecordBootstrapController.ts), pero hoy se usa solo como semántica de UI para loader/empty-state/recovery, no como orquestador adicional del arranque global.
- `useDailyRecord.ts` ahora usa [useDailyRecordDomainModules.ts](useDailyRecordDomainModules.ts) y [useDailyRecordCopyActions.ts](useDailyRecordCopyActions.ts) para bajar carga cognitiva del hook raíz sin cambiar su API.
- `useCensusEmail.ts` usa [useCensusEmailRecipientLists.ts](useCensusEmailRecipientLists.ts) y casos de uso en `src/application/census-email/*` para separar bootstrap/sync/CRUD de listas del estado UI del envío.
- `useAudit.ts` delega escritura/lectura remota a `src/application/audit/*` y mantiene en el hook solo la fachada de UI + debounce.
- `useBedManagement.ts` ahora centraliza validación/auditoría/reducer a [controllers/bedManagementDispatchController.ts](controllers/bedManagementDispatchController.ts), reduciendo lógica inline de dispatch.
- `useExportManager.ts` y el browser de respaldos consumen ahora casos de uso separados por bounded context en `src/application/backup-export/*`, manteniendo el barrel `backupExportUseCases.ts` como API estable del módulo.
- `useExportManager.ts` debe tratar `Descarga local` de handoff como flujo de impresión PDF paginado:
  el hook no imprime HTML en bruto; delega a `backupExportArchiveUseCases.ts`, que genera el PDF
  y abre el cuadro de impresión desde un `iframe` embebido para evitar diferencias entre entornos.
- La telemetría operativa del core puede reenviarse a un endpoint externo configurable por `VITE_OPERATIONAL_TELEMETRY_ENDPOINT`; los hooks emiten eventos estructurados y no conocen vendors concretos.
- Los hooks del core operativo consumen un `errorService` de fachada; la clasificación, retry y fan-out a sinks quedan fuera del hook para evitar mezclar policy con side effects.
- **LatestRef pattern**: evita stale closures en callbacks largos.

## Taxonomía rápida

- `facade`: API pública estable del subdominio.
- `state`: estado local o draft.
- `bootstrap`: carga/selección inicial.
- `delivery`: envío/export/comunicación remota.
- `persistence`: save/patch/delete.
- `query`: lectura reactiva y caché.
- `compat`: bridge temporal o adapter técnico.
- `bootstrapPhase`: semántica canonica del primer ciclo de resolución del `DailyRecord`. La UI no debe inventar flags paralelos para decidir spinner, estado vacío o recovery, ni reconstruir runtime desde timers propios.

Referencia detallada: [docs/hooks-reference.md](../../docs/hooks-reference.md)

## Ejemplo

```ts
const dailyRecord = useDailyRecord(currentDate, isOfflineMode, remoteSyncStatus);

dailyRecord.updatePatient('R1', 'patientName', 'Paciente Demo');
```

## Reglas de mantenimiento

1. Hooks no deben importar implementación de componentes.
2. Lógica de validación compleja va a controllers puros.
3. Si ya existe use-case o port equivalente, el hook no debe importar directo `auditService`, `DailyRecordRepository`, `ClinicalDocumentRepository` ni `censusEmailService`.
4. Los tests de hooks deben mockear use-cases, ports o adapters antes que servicios concretos.
5. Mantener API estable y documentar breaking changes en este README.
6. Evitar `ReturnType<typeof hook>` para contratos semánticos del core cuando ya exista `*Contracts.ts` o `*Types.ts`.
7. Si el hot path de arranque/login cambia, agregar al menos un test directo del hook afectado además del test de integración; no depender solo de Netlify para detectar regresiones.

## Guardrails activos

- `npm run check:application-port-boundary`
- `npm run check:runtime-adapter-boundary`
- `npm run check:hook-hotspots`
