# `src/context`

## Propósito

Providers de estado global y contratos para features transversales.

## Archivos y responsabilidad

| Archivo                             | Responsabilidad principal                                                |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `AuthContext.tsx`                   | Sesión, usuario, rol, conectividad                                       |
| `DailyRecordContext.tsx`            | Contexto fragmentado de censo diario (data/actions/beds/staff/sync)      |
| `UIContext.tsx`                     | Toasts, confirm dialogs y UX runtime global                              |
| `UISettingsContext.tsx`             | Preferencias visuales persistibles                                       |
| `ConfirmDialogContext.tsx`          | Canal de confirmación desacoplado                                        |
| `NotificationContext.tsx`           | Notificaciones de alto nivel                                             |
| `VersionContext.tsx`                | Estado/versionado de despliegue                                          |
| `SecurityContext.tsx`               | Configuración de bloqueo/PIN y reglas UX de seguridad                    |
| `StaffContext.tsx`                  | Estado de staff transversal                                              |
| `HospitalContext.tsx`               | Contexto de hospital activo/configuración                                |
| `CensusContext.tsx`                 | Agrega `dailyRecord + dateNav + fileOps + email` para la vista principal |
| `TableConfigContext.tsx`            | Configuración de columnas y tabla                                        |
| `DemoModeContext.tsx`               | Estado de demo mode                                                      |
| `AuditContext.tsx`                  | Contexto para trazabilidad/auditoría                                     |
| `useDailyRecordFragmentedValues.ts` | Selector/memoización para fragmentar `DailyRecordContext`                |
| `uiContracts.ts`                    | Tipos/contratos para UI runtime y notificaciones                         |
| `index.ts`                          | Exports centralizados                                                    |

## Patrones clave

- Context fragmentation para disminuir re-renders.
- Hooks de acceso especializados (`useDailyRecordData`, `useDailyRecordBedActions`, `useDailyRecordMovementActions`, etc.).
- Contratos tipados para evitar props drilling masivo.

## Ejemplo

```ts
const { record } = useDailyRecordData();
const { updatePatient } = useDailyRecordBedActions();
```
