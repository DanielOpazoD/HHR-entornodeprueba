# Bundle Risk Ledger

Estado: activo
Owner: architecture
Última actualización: 2026-06-30

## Scope

Este ledger gobierna los chunks que hoy explican el warning de tamaño de Vite o quedan cerca de sus presupuestos. No cambia comportamiento clínico; documenta por qué el release no queda bloqueado y qué señal debe disparar el siguiente recorte.

## Current surfaces

| Surface                   | Owner                             | Threshold                           | Current signal                                          | Release posture                                                          | Guardrail                                                                      |
| ------------------------- | --------------------------------- | ----------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `vendor-heic2any`         | prescriptions/runtime             | 1,450,000 bytes chunk budget        | ~1,320 KB, async only for HEIC/HEIF prescription photos | Not a release blocker while it stays out of precache and below threshold | `chunkingPolicy.test`, `pwaPrecachePolicy.test`, `check:bundle-budget`         |
| `vendor-pdfjs`            | clinical-documents/PDF runtime    | 520,000 bytes chunk budget          | ~455 KB, async PDF.js text/import runtime               | Not a release blocker while excluded from PWA install-time precache      | `chunkingPolicy.test`, `pwaPrecachePolicy.test`, `check:bundle-budget`         |
| `pdfjs-worker`            | clinical-documents/PDF runtime    | 2,500,000 bytes async worker budget | ~2,303 KB, async PDF.js worker                          | Not a release blocker while excluded from PWA install-time precache      | `pwaPrecachePolicy.test`, `check:runtime-asset-margin`                         |
| `vendor-pdf-lib`          | clinical-documents/PDF generation | 430,000 bytes chunk budget          | ~382 KB, near warning band but still below ceiling      | Not a release blocker while PDF generation remains on-demand             | `bundleBudgetConfig.test`, `check:bundle-budget`, `check:runtime-asset-margin` |
| `app-authenticated-shell` | app-shell/census runtime          | 600,000 bytes startup chunk budget  | ~550 KB, near warning band but below ceiling            | Not a release blocker while startup imports remain guarded               | `chunkingPolicy.test`, `check:bundle-budget`, `check:runtime-asset-margin`     |

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
