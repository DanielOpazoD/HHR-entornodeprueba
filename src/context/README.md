# `src/context`

## Propósito

Providers de estado global y contratos para features transversales.

## Archivos y responsabilidad

| Archivo                             | Responsabilidad principal                                                |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `AuthContext.tsx`                   | Sesión, usuario, rol, conectividad                                       |
| `DailyRecordContext.tsx`            | Contexto fragmentado de censo diario (data/actions/beds/staff/sync)      |
| `dailyRecordContextContracts.ts`    | Contrato canónico del contexto diario y su API tipada                    |
| `UIContext.tsx`                     | Toasts, confirm dialogs y UX runtime global                              |
| `UISettingsContext.tsx`             | Preferencias visuales persistibles                                       |
| `VersionContext.tsx`                | Estado/versionado de despliegue                                          |
| `SecurityContext.tsx`               | Configuración de bloqueo/PIN y reglas UX de seguridad                    |
| `StaffContext.tsx`                  | Estado de staff transversal                                              |
| `HospitalContext.tsx`               | Contexto de hospital activo/configuración                                |
| `CensusContext.tsx`                 | Agrega `dailyRecord + dateNav + fileOps + email` para la vista principal |
| `TableConfigContext.tsx`            | Configuración de columnas y tabla                                        |
| `AuditContext.tsx`                  | Contexto para trazabilidad/auditoría                                     |
| `useDailyRecordFragmentedValues.ts` | Selector/memoización para fragmentar `DailyRecordContext`                |
| `uiContracts.ts`                    | Tipos/contratos para UI runtime y notificaciones                         |
| `index.ts`                          | Exports centralizados                                                    |

## Patrones clave

- Context fragmentation para disminuir re-renders.
- Hooks de acceso especializados (`useDailyRecordData`, `useDailyRecordBedActions`, `useDailyRecordMovementActions`, etc.).
  Los hooks de **acciones** deben importarse desde `useDailyRecordScopedActions` para evitar ciclos de chunking.
- Contratos tipados para evitar props drilling masivo.
- Los tipos del contexto diario viven en `dailyRecordContextContracts.ts`; `hooks/useDailyRecordTypes.ts` queda solo como shim de compatibilidad.
- Los contratos base del registro diario ya se separan por slice en `src/application/shared/`:
  - `dailyRecordCoreContracts.ts`
  - `dailyRecordBedContracts.ts`
  - `dailyRecordStaffContracts.ts`
  - `dailyRecordMedicalContracts.ts`
- `AuthContext` debe seguir dependiendo solo de `useAuthState`; la orquestación interna de auth/bootstrap/conectividad vive fuera del contexto para mantenerlo como fachada estable.

## Ejemplo

```ts
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useDailyRecordBedActions } from '@/context/useDailyRecordScopedActions';

const { record } = useDailyRecordData();
const { updatePatient } = useDailyRecordBedActions();
```
