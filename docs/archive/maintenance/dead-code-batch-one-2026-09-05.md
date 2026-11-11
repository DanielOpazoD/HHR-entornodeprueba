# Código sin uso: primer lote de bajo riesgo

Base auditada: `6b05b76b83acd57e92e76110d54cc8ed6813aeea` (`main`, merge #330).
Fecha: 5-09-2026. Alcance: presentación interna; sin cambios funcionales previstos.

## Retirado

| Archivo                                                          | Líneas | Evidencia y flujo que permanece                                                                                                   |
| ---------------------------------------------------------------- | -----: | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/ui/base/MedicalCard.tsx`                         |     29 | Render puro React/clsx. Ningún consumidor, exportación intermedia ni registro.                                                    |
| `src/features/census/components/CensusEmptyBedsDividerRow.tsx`   |     21 | Separador no renderizado. `CensusTableBody` utiliza `EmptyBedRow`; no se modifica la tabla activa.                                |
| `src/features/backup/components/internal/BackupPreviewModal.tsx` |    121 | Visor JSON no montado, sin lecturas/escrituras propias. `BackupFilesView` usa `BackupFilesPreview` y sus visores Excel/PDF.       |
| `src/features/admin/components/internal/audit/DiffHighlight.tsx` |     49 | Resaltador no montado. Se conservan `AuditPackageChangeSummary`, el antes/después de `AuditLogRow` y `diffUtils` con sus pruebas. |

Total: cuatro módulos, 220 líneas de fuente. No se elimina ningún test,
dependencia, dato, contrato ni condición de CI. Git conserva los archivos para
recuperarlos mediante una reversión del commit.

## Método y límites de la evidencia

1. Búsqueda en archivos versionados de nombres y rutas, incluyendo código,
   pruebas, scripts, configuración, documentación y Storybook: sólo aparecieron
   las declaraciones dentro de los cuatro archivos retirados.
2. Inspección AST con TypeScript ya instalado: resolución de imports, re-exports,
   `import()` y `require()` literales. Los cuatro módulos no tenían entradas.
3. Revisión manual de carga no literal, namespaces, registros y efectos al cargar.
   No se encontró carga por `import.meta.glob` o `require.context` que los alcance.
   Storybook descubre historias/MDX, no estos módulos. La carga variable de ExcelJS
   no alcanza componentes de presentación.
4. Revisión de los flujos activos indicados arriba, compilación y pruebas de esas
   superficies. No basta una coincidencia ausente en un buscador para borrar código.

No es una auditoría completa del repositorio ni una promesa de mejora de velocidad.
Estos módulos ya estaban fuera del grafo ejecutable; la mejora es de mantenimiento.

## Fuera de este lote

- `CheckboxCell` y `AgeInput`: documentación explícita de conservación para posibles
  reactivaciones; no son borrados automáticos por ausencia de imports.
- Utilidades de arrays/texto y `diffUtils`: tienen pruebas directas. Retirarlas
  requeriría decidir expresamente si se abandona esa capacidad.
- `localDate.ts`: candidato pequeño sin consumidores, pero expuesto en la API
  TypeDoc generada. Se pospone para no mezclar regeneración documental en este lote.
- `VirtualizedTable`, `Skeleton` y wrappers `core/ui`: posibles siguientes
  candidatos; no se agrupan sin completar su revisión particular.
- Autenticación, sincronización, migraciones, compatibilidad, tipos persistidos,
  backend y extensión: excluidos deliberadamente.

## Cierre exigido

Revisar el diff, typecheck, controles de calidad, pruebas de las pantallas activas,
build, presupuesto/grafo de chunks y bootstrap de preview. Comparar los assets de
producción antes/después para distinguir reducción de fuente de reducción real del
paquete. La CI del SHA publicado debe completar la batería global antes del merge.

## Evidencia local del lote

- 63 pruebas focalizadas aprobadas en 10 archivos de censo, respaldo, auditoría y modal.
- Typecheck, todos los controles de `check:quality` y compilación de producción aprobados.
- `ci:preview-gate` aprobado: presupuesto, grafo de chunks, margen de assets y tres
  pruebas de arranque del censo compilado con datos sintéticos.
- Comparación bajo la misma configuración: 200 assets JavaScript, 8.551.341 bytes
  antes y después. CSS: 271.293 → 270.098 bytes (−1.195). Se comparan tamaños, no
  hashes idénticos: los metadatos temporales del build cambian entre ejecuciones.
- No se modificó la sesión real de localhost:3001 ni se escribieron datos clínicos.

Estas comprobaciones no equivalen a ejecutar localmente toda la batería global;
el resultado completo corresponde a la CI del PR.
