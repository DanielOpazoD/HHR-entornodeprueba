# `src/hooks`

## Propósito

Lógica de aplicación reusable y composición de casos de uso. Es el puente entre UI (`components/features`) y servicios/context.

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
| `controllers/`               | Lógica pura usada por hooks (sin React UI)            |
| `admin/`                     | Hooks auxiliares del módulo admin                     |
| `whatsapp/`                  | Hooks de integración WhatsApp                         |

## Hooks clave (alta prioridad)

| Hook                         | Responsabilidad                                    |
| ---------------------------- | -------------------------------------------------- |
| `useDailyRecord.ts`          | API consolidada de acciones/estado del censo       |
| `useDailyRecordQuery.ts`     | Lectura/suscripción/cache y optimistic updates     |
| `useMovements.ts`            | Wrapper de compatibilidad para altas/traslados     |
| `useTransferViewStates.ts`   | Estado de UX del flujo de traslados en vista censo |
| `useHandoffCommunication.ts` | Comunicación y envío de handoff                    |

## Patrones usados

- **Orchestrator Hook**: hooks agregadores que exponen API estable.
- **Command Hooks**: ejecutan comandos tipados y notifican errores.
- **Controller-backed hooks**: validación/transformación extraída a `controllers`.
- **LatestRef pattern**: evita stale closures en callbacks largos.

## Ejemplo

```ts
const dailyRecord = useDailyRecord(currentDate, isOfflineMode, isFirebaseConnected);

dailyRecord.updatePatient('R1', 'patientName', 'Paciente Demo');
```

## Reglas de mantenimiento

1. Hooks no deben importar implementación de componentes.
2. Lógica de validación compleja va a controllers puros.
3. Mantener API estable y documentar breaking changes en este README.
