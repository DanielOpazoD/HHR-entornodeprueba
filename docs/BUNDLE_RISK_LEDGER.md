# Bundle Risk Ledger

Estado: activo
Owner: architecture
Última actualización: 2026-10-11

## Scope

Este ledger gobierna los chunks que hoy explican el warning de tamaño de Vite o quedan cerca de sus presupuestos. No cambia comportamiento clínico; documenta por qué el release no queda bloqueado y qué señal debe disparar el siguiente recorte.

## Current surfaces

| Surface                   | Owner                             | Threshold                           | Current signal                                           | Release posture                                                          | Guardrail                                                                      |
| ------------------------- | --------------------------------- | ----------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `vendor-heic2any`         | prescriptions/runtime             | 1,450,000 bytes chunk budget        | ~1,320 KB, async only for HEIC/HEIF prescription photos  | Not a release blocker while it stays out of precache and below threshold | `chunkingPolicy.test`, `pwaPrecachePolicy.test`, `check:bundle-budget`         |
| `vendor-pdfjs`            | clinical-documents/PDF runtime    | 520,000 bytes chunk budget          | ~455 KB, async PDF.js text/import runtime                | Not a release blocker while excluded from PWA install-time precache      | `chunkingPolicy.test`, `pwaPrecachePolicy.test`, `check:bundle-budget`         |
| `pdfjs-worker`            | clinical-documents/PDF runtime    | 2,500,000 bytes async worker budget | ~2,303 KB, async PDF.js worker                           | Not a release blocker while excluded from PWA install-time precache      | `pwaPrecachePolicy.test`, `check:runtime-asset-margin`                         |
| `vendor-pdf-lib`          | clinical-documents/PDF generation | 430,000 bytes chunk budget          | ~382 KB, near warning band but still below ceiling       | Not a release blocker while PDF generation remains on-demand             | `bundleBudgetConfig.test`, `check:bundle-budget`, `check:runtime-asset-margin` |
| `app-authenticated-shell` | app-shell/census runtime          | 627,000 bytes startup chunk budget  | 626,136 bytes with PR #481 specialty pilot; near ceiling | Not a release blocker while startup imports remain guarded               | `chunkingPolicy.test`, `check:bundle-budget`, `check:runtime-asset-margin`     |

## Trigger policy

- Treat a hard budget failure as blocking for the PR that introduced it.
- Treat a near-limit warning as release-visible debt, not a blocker, when the runtime is async or still below the startup ceiling.
- Do not raise a threshold unless the ledger explains the owner, measured baseline and rollback path.
- Keep optional HEIC/PDF runtimes and the PDF.js worker out of install-time precache so offline install size does not grow silently.
- Regenerate `reports/runtime-asset-margin.md` after production build when a runtime asset crosses warning band.

## Next recommended PR

Open a focused follow-up PR for one of these, not both:

1. Reduce `app-authenticated-shell` by moving one more secondary authenticated concern behind a lazy boundary.
2. Separate PDF generation/viewer dependencies more finely so `vendor-pdf-lib`, `vendor-pdf-core` and `vendor-pdfjs` can be reasoned about by workflow instead of as one PDF family.

The next PR should include `npm run build`, `npm run check:bundle-budget`, `npm run check:chunk-graph`, `npm run check:runtime-asset-margin` and one targeted build/static test proving the dependency no longer belongs to the startup path.

## PR #469: confirmed-cache ordering (2026-09-22)

Owner: app-shell/census runtime. The cache confirmation and read-precedence helpers protect a
server-confirmed synchronization attempt from an older query/subscription result. They run in
normal daily-record writes and reads; deferring them would add a network dependency after a
successful server write. Keep this correctness boundary synchronous in the loaded runtime.

Measured CI baseline: main `bfecb6c3`, run
[35670740492](https://github.com/DanielOpazoD/HHR-entornodeprueba/actions/runs/35670740492),
reports 622.38 kB decimal (gzip 179.94–179.95 kB). PR head `56951e36`, preview run
[35744026312](https://github.com/DanielOpazoD/HHR-entornodeprueba/actions/runs/35744026312),
reports 624.47 kB (gzip 180.38 kB). The increase is approximately 2.09 kB raw / 0.44 kB gzip;
the prior ceiling was already within approximately 620 bytes of main.

Raise only this ceiling from 623,000 to 625,000 bytes (+0.32%). Keep warning bands, all other
chunk/entry/precache limits, and exclusions unchanged. Startup performance checks in both
development and production passed on the same PR head; they measure startup, not end-to-end
Eloísa synchronization time. Re-run bundle and preview checks on the final head.

Rollback: revert the cache-ordering change and this allowance together if its behavior fails
acceptance; restore 623,000 bytes. Do not remove correctness guards merely to fit the old
ceiling. Any further growth needs its own evidence or a scoped reduction of an optional
startup dependency. The existing near-limit warning remains visible.

## PR #481: episode-aware specialty pilot (2026-09-23)

Owner: app-shell/census runtime. The pilot remains disabled by default. Jev's
network client and specialty intent controller load only on demand; the shared
episode metadata and validation stay on the census write path so old clients
cannot erase a signed decision. The production build after these splits measured
`app-authenticated-shell` at 626,136 bytes, 1,136 bytes over the prior ceiling.
Allow only +2,000 bytes (625,000 → 627,000; +0.32%) for this correctness
boundary. Do not change the entry, Firebase, precache, or async chunk budgets.

The authenticated shell remains near its hard limit; next census feature work
must measure and preferably defer an optional dependency. Roll back this
allowance with the specialty pilot if that pilot fails acceptance; retain the
server-side provenance guard until its replacement is independently verified.

## Censo: inicio y menú de especialidades (2026-09-24)

Owner: app-shell/census runtime. The compact specialty menu now appears beside
the census summary instead of loading with the deferred patient table. The Jev
window and rule editor remain lazy; moving the entry control to the header adds
a small synchronous UI cost. With the same local lockfile and build command,
`origin/main` 11d1ea6a measured `app-authenticated-shell` at 626,182 bytes;
this branch measured 628,453 bytes (+2,271 bytes, 0.36%).

Raise only this startup chunk ceiling from 627,000 to 630,000 bytes (+0.48%).
The remaining margin is 1,547 bytes on the measured build; entry, precache and
other chunk limits remain unchanged. Keep the size warning visible and run
`build`, `check:bundle-budget` and startup performance checks before release.
Rollback: move the specialty entry back behind the deferred census table and
restore the 627,000-byte ceiling if the header change regresses startup.

## RN y recuperación del archivo CUDYR (2026-10-10)

Owner: census/sync. The patient, census and movement contracts share immutable string Zod
validators to avoid duplicating the same validator in the authenticated shell.
No accepted values or validation behavior change. Server-verified CUDYR archive
recovery and shared report facts stay available as on-demand assets and are
excluded from install-time precache, like their online-only report and sync owners.
Offline clinical writes and their durable outbox remain cached. All byte ceilings
remain unchanged. Validate with schema tests, `pwaPrecachePolicy`, `build`,
`check:bundle-budget`, `check:chunk-graph` and preview/runtime performance checks.
Rollback: restore the two precache entries and the repeated field constructors;
archive payloads and Firebase records require no migration.

## Moa opcional y barra azul (2026-10-11)

Owner: app-shell/navbar. Las secuencias comparten la identidad y el renderer. La barra
usa un degradado compartido con el preboot; ya no solicita el paisaje.
El activador es un retrato SVG estático. Moa comienza oculto. Sus dieciocho escenas
tienen seis fotogramas ilustrados cada una en PNG con transparencia y resolución
doble; se solicita el saludo común para el reposo y la escena seleccionada, con un máximo de 300 KB por atlas
y 4 MiB para el conjunto. El módulo decorativo se descarga al activarlo. Su JS, CSS y atlas quedan
fuera del precache; el censo y el activador siguen disponibles si falla la descarga.
No se excluyen dependencias clínicas, no se amplían límites y no se añaden librerías
ni cachés. La primera activación requiere acceso al módulo, incluido el caso offline.

La X y Escape cierran Moa; la pestaña oculta pausa el movimiento y el movimiento
reducido muestra escenas estáticas. El reposo no tiene animaciones recurrentes.
Comprobar `pwaPrecachePolicy`, `check:bundle-budget`, `check:chunk-graph`,
`check:runtime-asset-margin` y las pruebas de gestos, teclado, recarga y fallo de chunk.
Rollback: revertir componentes, estilos y las dos exclusiones de Moa en Vite y el
inventario de presupuesto. No hay migración de información clínica.

## PR #892: durable queue wakeup

Using the same local Node 22.22.2 toolchain, lockfile and environment, base
`b0262b91e` measures 630,000 bytes and the synchronous wakeup implementation
measures 630,254 bytes (0.041% growth). Its timer resumes eligible durable writes
after session admission without a new edit or network event. Raise only the
authenticated shell ceiling to 630,400 bytes; all other budgets stay unchanged.
The prior ceiling had no headroom. Splitting this small runtime adds loading
complexity without a useful reduction; keep the existing engine and retry policy.
Guardrails: session-readiness and timer tests, lease/quarantine tests, critical
E2E recovery, bundle budget and preview smoke. Rollback: revert PR #892; persisted
outbox entries remain intact. This allowance is not headroom for new UI features.

## Fase 1a P4a: higiene de escritura en días divididos

Con el mismo toolchain local (Node 24.14.1, mismo lockfile), `main` en `257900995` mide
628.935 bytes y la higiene de escritura de días divididos mide 631.549 bytes (+0,42 %). La
higiene impide que un cliente vuelva a escribir en un día dividido copias locales de
`clinicalSyncCheckpoint` y `vitalSignsHistory`, o que cree un día con el marcador
(`docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md`, D9). La usan el auto-merge de conflictos,
que es síncrono y vive en este chunk, el guardado directo y la publicación de la cola; por eso no
puede quedar detrás de un import dinámico. La guarda de importación, que solo usan la importación
JSON y la restauración de respaldos, ya se separó a su propio módulo (−220 bytes). Se sube solo
este techo a 632.000 bytes; los demás presupuestos no cambian. Riesgo: un poco más de carga
inicial, sin dependencias ni lecturas nuevas. Guardas: pruebas de higiene, conflictos, cola,
restauración e importación, presupuesto de bundle y grafo de chunks. Rollback: revertir la PR; en
días sin marcador el comportamiento es idéntico. Este margen no es espacio para funciones nuevas
de interfaz.

## Historical sync diagnostic context (2026-10-18)

Owner: census synchronization. The authenticated shell measured 630,690 bytes
with the bounded optional diagnostic schema, compared with 630,254 bytes at
the preceding baseline. Preserve that schema at the daily-record validation
boundary so persisted incident identities survive reload. The report and its
expanded UI remain behind their existing lazy boundary. Set only this ceiling
to 631,000 bytes (600 bytes above the previous ceiling); other budgets stay fixed.
Risk: a small startup payload increase, without dependencies or additional reads.
Guardrails: schema roundtrip, episode isolation, bundle budget, chunk graph,
preview bootstrap and critical coverage. Rollback: revert this PR; optional
diagnostic fields remain backward compatible and clinical values are unchanged.

## PR #1010: validación offline con Zod 4 corregido

Owner: platform y arquitectura. Zod 4.6.7 corrige
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
El validador compartido debe seguir disponible sin conexión para leer y guardar
censos y respaldos. Se conserva en el precache; no cambia la clasificación de
chunks ni se excluyen archivos clínicos.

Comparación local secuencial con Node 22.22.2, Vite 6.4.4, modo production y
`VITE_E2E_MODE=true` (sin dotenv), sobre `main` `329df64ab` y el candidato
`0f3181337` con los adaptadores de Zod 4:

| Artefacto            |    Zod 3 / main | Zod 4 / candidato |
| -------------------- | --------------: | ----------------: |
| vendor-zod           |    55.634 bytes |      94.434 bytes |
| Precarga total       | 4.949.726 bytes |   4.988.601 bytes |
| Archivos precargados |             239 |               239 |

La diferencia total es 38.875 bytes (0,785 %), de los cuales 38.800 corresponden
al validador. El CI de `65db89c` mostró 4.871,7 KiB frente al límite de
4.836 KiB. Los imports de namespace ya eliminan exports no usados. Adoptar la API funcional Mini exigiría reescribir
los validadores clínicos; queda fuera de esta corrección de dependencias.

Se permite sólo 40 KiB adicionales en precache: de 4.952.064 a 4.993.024 bytes.
Zod tiene además un techo dedicado de 96.000 bytes, conservando los demás
límites de chunks, arranque, assets y Functions. Este margen cubre la corrección
de seguridad y no reserva espacio para nuevas funciones. El aumento afecta
la descarga e instalación offline; no acredita mayor consumo sostenido ni una
mejora de latencia.

Gates: compatibilidad de esquemas/defaults, `check:bundle-budget`,
`check:chunk-graph`, `check:runtime-asset-margin`, preview bootstrap y los E2E
críticos. Rollback: revertir dependencias, adaptadores y este margen juntos; el
regreso a las versiones vulnerables vuelve a bloquear la auditoría y no debe
presentarse como un cierre válido.

## PR #1024: exportación Word de formularios bajo demanda

El CI de `b37a9f0` midió 4.878,2 KiB de precache frente al límite de 4.876 KiB.
`clinicalFormDocx` ocupa 4,50 kB en ese build y sólo se carga desde el editor
de formularios opcional, ya excluido. Su plantilla Word vive en `docs/`, también
fuera del precache. Se excluye ese chunk con el mismo patrón en Vite y el control
de presupuesto. Se alinean además las exclusiones existentes de descargas,
verificación de arrastre e informes CUDYR en la configuración del control;
el control sigue sumando los archivos del manifest generado, sin restar exclusiones.

Se conservan los límites, el outbox, el censo, los calculadores y la carátula
de traslado disponibles sin conexión. La prueba `pwaGeneratedManifest` genera
un manifest con Workbox sobre assets sintéticos y compara su pertenencia con
la contabilidad del presupuesto. El total definitivo corresponde al build de CI.
Rollback: restaurar ambas entradas de `clinicalFormDocx`; no elevar el límite.

## PR #1028: recuperación de imports de callables (2026-10-25)

Owner: platform/auth y census/sync. El SDK de Functions sigue fuera del precache.
App monta una sola recuperación y calentamiento online para todas las rutas, incluidos
login, shell, escáner/QR, recetas, heridas y firmas. El aviso lazy tiene un fallback
vacío si no puede cargar, sin sustituir la pantalla ni los formularios.
Los resolvers rechazan antes del import cuando el navegador está offline, con
`functions/unavailable`; no se envían callables ni se cambia el comportamiento offline.

El verificador reprodujo imports retenidos hasta recargar en Firefox 144,
WebKit 26 (Safari y navegadores iOS) y Chromium 143, dentro del alcance conocido
Chromium ≤153. Ocurre tanto con conexión rechazada como con HTTP 503, aunque
`navigator.onLine` siga true. Afecta a todas las callables, incluidos patch/save
del registro diario, entrega especialista, lotes Rayen, firmas, QR y CUDYR.
Chrome 156 puede recuperar el mismo URL sin recarga.

Un fallo de carga del SDK marca el runtime como pendiente de recuperación. Incluye
el caso de despliegue con hash antiguo: el fallback SPA responde HTML al URL del
chunk y WebKit rechaza el MIME JavaScript. El detector compartido también cubre
los mensajes de Firefox y WebKit en los componentes lazy.
Mientras persista esa marca, los errores de red de la cola conservan PENDING,
payload y contador de intentos; no agotan el presupuesto ni pasan a FAILED.
Los reintentos de recuperación esperan al menos un minuto, incluso cuando el
backoff normal de la cola está limitado a 30 segundos.
Los errores permanentes y conflictos mantienen su política vigente. Una petición
sin caché a version.json confirma conectividad antes de reintentar el import.
Si el navegador sigue reteniéndolo, una región viva estable muestra un aviso fijo
que permanece visible al desplazarse. El login RUT indica recargar para restablecer
el acceso. El aviso ofrece una recarga
confirmada que advierte de lo escrito sin guardar. Recargar conserva IndexedDB y
reanuda el envío pendiente. Si el import se recupera, se retira la marca sin recargar.
No hay recarga automática, purga ni modificación de datos clínicos.

El aviso está en un chunk lazy precacheado. El build local de esta ronda mide
4.984.925 bytes de precache (margen 8.099) y 621.079 bytes de shell (margen 10.921).
El chunk del aviso mide 1.857 bytes. No se elevan límites ni se añade Functions
(12.028 bytes) al precache. El margen permanece reservado para seguridad de datos.

Guardas: el grafo generado protege también MoaHelpButton y el portal orbital;
un escáner AST clasifica todos los lazy/lazyWithRetry e imports dinámicos de los
árboles de primer pintado, con roots o excepciones opcionales justificadas.
Una nueva carga sin clasificar hace fallar src/tests/build. Se conservan las 17
excepciones del grafo. La recuperación se prueba con el engine y store Dexie reales,
aviso, confirmación, import HTTP fallido y callable sintética tras recargar en los
cuatro motores; los probes de arranque frío y especialidad usan sólo datos sintéticos.

## Aumento de precarga aprobado por el dueño (2026-10-25, opción C)

**Decisión.** El dueño aprobó subir el límite de precarga hasta unos 78 KB. Se usan 38.912 bytes: de 4.993.024 a 5.031.936 (4.914,0 KB).

**En qué se usan:**

- **`vendor-firebase-functions` (12.028 B) pasa a la precarga.** WebKit, Firefox y Chromium ≤153 retienen un import dinámico fallido hasta recargar. Por eso, una primera carga inestable dejaba sin funcionar todas las escrituras por callables. Con el chunk en el service worker, eso ya no ocurre en sesiones instaladas. El aviso de recuperación de #1028 queda como respaldo para primeras visitas. Las callables siguen necesitando red, y el cargador compartido las rechaza sin conexión antes de llamar.
- **Nuevo chunk `shared-runtime-loaders` (2.008 B), precargado.** Reúne `createCachedRuntimeLoader`, los runtimes de texto PDF y `eloisaPersonName`. Antes, Rollup los dejaba dentro del chunk `replanRayenStructure-*` (unos 43 KB), que es solo en línea y está fuera de la precarga. Así, 37 chunks quedaban atados a él (los PDF, las recetas, el escáner, farmacia y CUDYR), y las recetas y el escáner no arrancaban sin conexión. Después de separarlos solo lo importan las herramientas de Rayen y Eloísa, y el chunk de 43 KB sigue fuera de la precarga.
- **Espacio para dos PR de seguridad de datos:**
  - #1026, la nota del especialista ligada a paciente y episodio: unos 16,3 KB;
  - #1022, identidad ilegible en cuarentena: unos 5,8 KB.

  Con los dos fusionados queda un margen de unos 9 KB.

**Controles:**

- `check:bundle-budget`, con el manifiesto igual a la contabilidad.
- El guard de grafo de precarga y el escáner AST de #1028 (`src/tests/build`).
- `pwaPrecachePolicy.test.ts`, que fija que Functions y `shared-runtime-loaders` se precargan.
- `chunkingPolicy.test.ts`, que fija los cuatro módulos del chunk compartido.

**Reversión.** Volver a excluir `vendor-firebase-functions` en Vite y en el presupuesto, quitar la regla `shared-runtime-loaders` y restaurar el límite anterior. Cualquier aumento posterior requiere una nueva aprobación del dueño.

## PR #1034: proyecciones de notas y confirmación del censo (2026-10-26)

Owner: census/sync. El dueño eligió la opción C el 25 de octubre: aproximadamente
78 KiB adicionales. La integración de #1033 había aplicado 38 KiB de esa autorización.
Esta corrección de las notas de #1026 utiliza otros 8 KiB del mismo margen autorizado:
5.031.936 → 5.040.128 bytes. El aumento acumulado desde 4.993.024 bytes es 47.104
bytes (46 KiB), por debajo de los aproximadamente 78 KiB aprobados.

El candidato con Node 22.22.2 y los lockfiles sin cambios mide 5.037.813 bytes en
246 entradas de precarga: supera el límite anterior en 5.877 bytes y queda con
2.315 bytes de margen bajo el nuevo. El aumento está en las protecciones de notas,
identidad, rechazo, reintento y confirmación del censo: deben seguir disponibles
sin conexión. El build previo de main tras #998 mostraba 4.912,9 KiB; el candidato
muestra 4.919,7 KiB. Son mediciones de artefactos locales, no de latencia en producción.

Se probó una tercera pasada de Terser: el resultado fue 5.037.456 bytes, solo
357 bytes menos y todavía fuera del límite anterior. Se revirtió esa prueba;
se conservan dos pasadas, todas las entradas offline, las exclusiones existentes,
los otros límites y la banda de advertencia. Este margen corresponde a esta
corrección medida, no a funcionalidades añadidas sin medición.

Controles de cierre: `check:bundle-budget`, política y grafo de precarga, grafo de
chunks, margen de recursos, pruebas de sincronización y el cierre completo
`ci:close`. Las aserciones del límite exacto se actualizan en los dos controles
existentes; ninguno queda desactivado. Reversión: si se retira la corrección,
revertir con ella estos 8 KiB y las dos aserciones. Para mantener las protecciones
bajo el límite anterior debe demostrarse primero una reducción equivalente, sin
retirar capacidades clínicas offline.

## Revisión manual de envíos bloqueados (27 octubre 2026)

El retiro confirmado conserva la fila como respaldo local `RETIRED`; la persistencia,
las comprobaciones de sesión y el procesamiento de la cola siguen en sus caminos
existentes. La nueva interfaz de revisión y descarga se abre desde el panel Eloísa.

La primera compilación añadió un chunk de 6.067 bytes y excedió la precarga en unos
6,5 KiB; el panel Rayen también cruzó su límite de chunk. Se separan
`RayenSyncQueueDetails` y `DailyRecordTaskRecovery` como herramientas bajo demanda
del panel `RayenImportButton`, ya excluido de la precarga. Las exclusiones de Workbox
y de contabilidad enumeran exactamente esos dos chunks. Ningún límite aumenta.
El guard del grafo conserva la protección de las dependencias del arranque clínico.

Límite: abrir estas herramientas por primera vez requiere descargar sus módulos.
Si la carga falla, el cargador existente contiene el error y conserva el censo y
los envíos; no retira nada ni recarga automáticamente. Tras cargar, el retiro y
la descarga del respaldo operan contra IndexedDB sin escribir en el servidor.
La captura clínica, el guardado local y el worker no dependen de estas herramientas.
Reversión: revertir el cambio del panel y sus dos exclusiones; preservar cualquier
fila ya retirada, que nunca constituye un ACK remoto.
