# Bundle Risk Ledger

Estado: activo
Owner: architecture
Última actualización: 2026-09-22

## Scope

Este ledger gobierna los chunks que hoy explican el warning de tamaño de Vite o quedan cerca de sus presupuestos. No cambia comportamiento clínico; documenta por qué el release no queda bloqueado y qué señal debe disparar el siguiente recorte.

## Current surfaces

| Surface                   | Owner                             | Threshold                           | Current signal                                          | Release posture                                                          | Guardrail                                                                      |
| ------------------------- | --------------------------------- | ----------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `vendor-heic2any`         | prescriptions/runtime             | 1,450,000 bytes chunk budget        | ~1,320 KB, async only for HEIC/HEIF prescription photos | Not a release blocker while it stays out of precache and below threshold | `chunkingPolicy.test`, `pwaPrecachePolicy.test`, `check:bundle-budget`         |
| `vendor-pdfjs`            | clinical-documents/PDF runtime    | 520,000 bytes chunk budget          | ~455 KB, async PDF.js text/import runtime               | Not a release blocker while excluded from PWA install-time precache      | `chunkingPolicy.test`, `pwaPrecachePolicy.test`, `check:bundle-budget`         |
| `pdfjs-worker`            | clinical-documents/PDF runtime    | 2,500,000 bytes async worker budget | ~2,303 KB, async PDF.js worker                          | Not a release blocker while excluded from PWA install-time precache      | `pwaPrecachePolicy.test`, `check:runtime-asset-margin`                         |
| `vendor-pdf-lib`          | clinical-documents/PDF generation | 430,000 bytes chunk budget          | ~382 KB, near warning band but still below ceiling      | Not a release blocker while PDF generation remains on-demand             | `bundleBudgetConfig.test`, `check:bundle-budget`, `check:runtime-asset-margin` |
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
