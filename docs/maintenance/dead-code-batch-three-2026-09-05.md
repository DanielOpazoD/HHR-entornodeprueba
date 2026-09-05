# Código de presentación sin uso — lote 3

Base auditada: `f41766b2bbaca42ee79bfbf7fc4948ea053d5f70` (merge #333).
Se retiran siete módulos internos, 653 líneas de fuente, y los ocho casos que sólo
ejercitaban uno de ellos. No se modifican consumidores activos ni gates de CI.
Los archivos y pruebas se pueden recuperar desde Git.

## Grafo de consumidores

| Módulos retirados | Entradas encontradas antes del retiro | Superficie activa conservada |
| --- | --- | --- |
| `src/features/backup/components/internal/BackupFilters.tsx` y `BackupFileCard.tsx` | `BackupFilters`: ninguna. `BackupFileCard`: únicamente su bloque de ocho casos en `src/tests/features/backup/backupComponents.test.tsx`. | `BackupFilesView` monta `BackupFilesToolbar`, `BackupFilesContent` y `BackupFilesPreview`. El contenido usa `BackupDriveItems.FileCard` y los calendarios activos. |
| `src/core/ui/Card.tsx`, `Input.tsx`, `Select.tsx`, `Modal.tsx` y `useCoreScrollLock.ts` | Card, Input, Select y Modal: ninguna. `useCoreScrollLock` sólo era importado por ese Modal. | `BaseModal` usa `baseModalContent` → `useBaseModalLifecycle` → `src/hooks/useScrollLock.ts`. `SettingsModalTabs` sigue consumiendo `src/core/ui/Button.tsx`. |

Se revisaron referencias de rutas y símbolos en código, pruebas, scripts,
configuración, documentación y Storybook; también imports/re-exports AST,
namespaces, `import()` y `require()` literales. No se encontró registro ni carga
no literal que alcance estos módulos. La carga variable de ExcelJS no los alcanza.
No tienen efectos operativos al importar: los listeners, foco y bloqueo de scroll
del Modal y su hook sólo actuaban al montarse, y ese Modal no se montaba.

## Cobertura retenida y exclusiones

- `backupComponents.test.tsx` conserva sus 37 casos ejecutables de toolbar,
  `FolderCard`, `FileCard`, breadcrumbs, presentación y constantes. Se mantienen
  sus seis `todo` preexistentes; no se contabilizan como cobertura ejecutada.
- Sólo se retiran los ocho casos del componente huérfano `BackupFileCard`.
  La comparación AST confirma que los ocho bloques `describe` retenidos mantienen
  idénticos cuerpos y assertions. Los helpers de presentación y sus pruebas
  independientes permanecen intactos.
- Se conserva el **tipo** `BackupFilters` de `src/types/backup.ts`, usado por
  servicios, puertos, casos de uso y hooks; no es el componente retirado.
- Se preservan `Button`, `BaseModal`, `useScrollLock` y todas sus pruebas vivas.
- `DatabaseStatusBanner` queda fuera: forma parte del contrato de cobertura
  crítica y sus pruebas ejercitan la recuperación de almacenamiento activa.
- No se toca lógica clínica, autenticación, sincronización, migraciones,
  compatibilidad, extensión, dependencias ni los retiros de los lotes anteriores.

## CSS y límites

`src/index.css` declara las fuentes de Tailwind explícitamente con `source(none)`;
`src/core` no forma parte de ese escaneo. El scanner instalado de Tailwind comparó
los dos archivos de backup retirados contra los 1.591 archivos de las fuentes
restantes: no desaparece ningún candidato que sea una clase CSS; sólo identificadores
de código/texto. Las reglas `.premium-card`, `.premium-card-hover`, `.glass-card`
e `.input-field` de `src/index.css` se conservan sin cambios. No se amplía el lote
para retirar estilos. No se promete ahorro de JavaScript, CSS ni tiempo global de CI.

## Verificación local

- Node 22.22.2, conforme a `package.json`; dependencias existentes reutilizadas.
- Seis suites focalizadas aprobadas: 61 casos y seis `todo` preexistentes.
  Suites: `backupComponents`, `useBackupFileBrowser`, `backupPresentation`,
  `BaseModal`, `useScrollLock` y `baseModalEntrypointGovernanceStatic`.
- Typecheck de aplicación y Netlify, ESLint focalizado y `git diff --check`
  aprobados.
- La suite global, build, preview y CI del SHA publicado corresponden al cierre
  del PR; estos resultados focalizados no sustituyen esa evidencia.
