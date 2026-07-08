# Bundle Risk Ledger Snapshot

- Generated: stable:bundle-risk-ledger
- Policy version: 2026-06-v1
- Status: ok

## Surfaces

| Surface | Owner | Workflow | Threshold | Status | Budget | Precache | Release posture | Guardrails |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| vendor-heic2any | prescriptions/runtime | HEIC/HEIF prescription photo conversion | 1,450,000 bytes chunk budget | ok | covered | excluded | Async only for high-efficiency prescription photos; not a release blocker while below threshold and outside install-time precache. | check:bundle-budget, src/tests/build/chunkingPolicy.test.ts, src/tests/build/pwaPrecachePolicy.test.ts |
| vendor-pdfjs | clinical-documents/PDF runtime | PDF text/import runtime | 520,000 bytes chunk budget | ok | covered | excluded | Async PDF.js runtime remains acceptable while excluded from PWA install-time precache. | check:bundle-budget, src/tests/build/chunkingPolicy.test.ts, src/tests/build/pwaPrecachePolicy.test.ts |
| pdfjs-worker | clinical-documents/PDF runtime | PDF.js worker runtime | 2,500,000 bytes async worker budget | ok | covered | excluded | Async worker remains acceptable while excluded from PWA install-time precache and under its dedicated ceiling. | check:runtime-asset-margin, src/tests/build/pwaPrecachePolicy.test.ts |
| vendor-pdf-lib | clinical-documents/PDF generation | PDF generation and manipulation | 430,000 bytes async vendor budget | ok | covered | excluded | Async PDF generation remains acceptable while on-demand and under its dedicated ceiling. | check:bundle-budget, src/tests/build/bundleBudgetConfig.test.ts, src/tests/build/pwaPrecachePolicy.test.ts |
| app-authenticated-shell | app-shell/census runtime | Authenticated census shell | 600,000 bytes startup chunk budget | ok | covered | n/a | Startup chunk remains below hard ceiling; secondary authenticated concerns should keep moving behind lazy boundaries. | check:bundle-budget, check:chunk-graph, src/tests/build/chunkingPolicy.test.ts |

## Next Actions

- vendor-heic2any: Keep heic2any behind the prescription runtime loader and revisit only if usage telemetry or chunk size crosses the warning band.
- vendor-pdfjs: Keep PDF.js text extraction behind workflow loaders and split further only if it starts sharing startup dependencies.
- pdfjs-worker: Treat worker growth as PDF.js dependency drift; do not raise the budget without confirming extraction workflows still need the current worker.
- vendor-pdf-lib: Separate generation/viewer imports only if the PDF family grows past the current dedicated ceiling.
- app-authenticated-shell: Move the next secondary authenticated concern behind a lazy boundary if this chunk exceeds the warning band again.
