# `src/constants`

## Propósito

Fuente única de constantes de dominio/UI/config para evitar hardcodes.

## Mapa de archivos

| Archivo                    | Propósito                              |
| -------------------------- | -------------------------------------- |
| `beds.ts`                  | Definición base de camas               |
| `defaultPrintTemplates.ts` | Plantillas por defecto para impresión  |
| `email.ts`                 | Configuración y textos de email        |
| `examCategories.ts`        | Categorías de exámenes                 |
| `export.ts`                | Constantes de exportación              |
| `firestorePaths.ts`        | Paths/caminos de colecciones Firestore |
| `identities.ts`            | Tipos/constantes de identidad          |
| `navigationConfig.ts`      | Config de navegación por módulo        |
| `patient.ts`               | Constantes de paciente                 |
| `security.ts`              | Constantes de seguridad                |
| `version.ts`               | Metadatos de versión                   |
| `index.ts`                 | Barrel export                          |

## Patrones

- Centralización de catálogos para trazabilidad.
- Reutilización en validadores, formularios y reportes.

## Regla

Si agregas una constante transversal, priorizar este directorio antes de crear literales en UI/hook.
