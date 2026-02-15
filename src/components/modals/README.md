# `src/components/modals`

## Propósito

Modales transversales de la aplicación (acciones clínicas, configuración, mantenimiento y detalle).

## Mapa

| Archivo/Path                                     | Propósito                                                  |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `ActionModals.tsx`                               | Ensamble de modales clínicos principales                   |
| `BedManagerModal.tsx`                            | Gestión de camas                                           |
| `DemographicsModal.tsx`                          | Edición demográfica                                        |
| `ExamRequestModal.tsx`                           | Solicitud de examen                                        |
| `NurseManagerModal.tsx` / `TensManagerModal.tsx` | Gestión de staff                                           |
| `PatientHistoryModal.tsx`                        | Historial paciente                                         |
| `SettingsModal.tsx` / `SecuritySettings.tsx`     | Configuración global y seguridad                           |
| `actions/`                                       | Submódulo de modales de acciones (alta/traslado/move-copy) |

## Patrón

- UI liviana + lógica en hooks/controllers de `src/features/census` cuando aplica.
- Uso de `BaseModal` para consistencia visual y conductual.
