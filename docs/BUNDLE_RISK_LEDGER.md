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
