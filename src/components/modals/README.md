# `src/components/modals`

## Propósito

Modales transversales de la aplicación (acciones clínicas, configuración, mantenimiento y detalle).

## Mapa

| Archivo/Path                                     | Propósito                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `ActionModals.tsx`                               | Ensamble de modales clínicos principales                           |
| `BedManagerModal.tsx`                            | Gestión de camas                                                   |
| `BlockedBedsGrid.tsx` / `ExtraBedsGrid.tsx`      | Grillas presentacionales reutilizables para camas normales/extras  |
| `BedReasonDialog.tsx`                            | Submodal reutilizable para edición/validación de motivo de bloqueo |
| `DemographicsModal.tsx`                          | Edición demográfica                                                |
| `ExamRequestModal.tsx`                           | Solicitud de examen                                                |
| `StaffCatalogManagerModal.tsx`                   | Modal reutilizable para gestión de catálogos de staff              |
| `NurseManagerModal.tsx` / `TensManagerModal.tsx` | Wrappers por tipo de staff (hooks de persistencia)                 |
| `PatientHistoryModal.tsx`                        | Historial paciente                                                 |
| `SettingsModal.tsx` / `SecuritySettings.tsx`     | Configuración global y seguridad                                   |
| `actions/`                                       | Submódulo de modales de acciones (alta/traslado/move-copy)         |

## Patrón

- UI liviana + lógica en hooks/controllers de `src/features/census` cuando aplica.
- Uso de `BaseModal` para consistencia visual y conductual.
- `BedManagerModal` delega estado/transiciones en `useBedManagerModalModel` + `bedManagerModalController`.
