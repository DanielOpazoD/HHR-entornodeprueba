# `src/constants`

## Propósito

Fuente única de constantes de dominio/UI/config para evitar hardcodes.

## Mapa de archivos

| Archivo                     | Propósito                                         |
| --------------------------- | ------------------------------------------------- |
| `beds.ts`                   | Definición base de camas                          |
| `censusAuthorizedEmails.ts` | Catálogo de correos autorizados para acceso censo |
| `clinical.ts`               | Constantes clínicas (altas, turnos, etc.)         |
| `defaultPrintTemplates.ts`  | Plantillas por defecto para impresión             |
| `demo.ts`                   | Datos/flags de modo demo                          |
| `email.ts`                  | Configuración y textos de email                   |
| `examCategories.ts`         | Categorías de exámenes                            |
| `export.ts`                 | Constantes de exportación                         |
| `firebaseEnvironments.ts`   | Matriz de entornos Firebase                       |
| `firestorePaths.ts`         | Paths/caminos de colecciones Firestore            |
| `hospitalConfigs.ts`        | Configuración hospitalaria                        |
| `identities.ts`             | Tipos/constantes de identidad                     |
| `navigationConfig.ts`       | Config de navegación por módulo                   |
| `patient.ts`                | Constantes de paciente                            |
| `security.ts`               | Constantes de seguridad                           |
| `transferConstants.ts`      | Catálogos de traslado                             |
| `version.ts`                | Metadatos de versión                              |
| `index.ts`                  | Barrel export                                     |

## Patrones

- Centralización de catálogos para trazabilidad.
- Reutilización en validadores, formularios y reportes.

## Regla

Si agregas una constante transversal, priorizar este directorio antes de crear literales en UI/hook.
