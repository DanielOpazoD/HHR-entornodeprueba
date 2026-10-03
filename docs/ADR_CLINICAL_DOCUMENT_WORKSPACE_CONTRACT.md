# ADR: Clinical Document Workspace Contract

**Estado:** Vigente

## Decision

The clinical documents workspace must remain definition-driven and contract-validated:

- document behavior comes from feature definitions and section registries
- workspace orchestration lives in feature hooks/use-cases
- persistence/export/print return typed outcomes
- consumers outside the feature use only `public.ts` or `index.ts`

No new document-type behavior should be reintroduced through ad hoc `if` branches in the sheet or through direct remote/runtime access from the UI.

## Why

`clinical-documents` has high branch complexity because it combines templates, drafts, autosave, signing, printing, PDF export, Drive integration and compatibility migration. The cost of change stays acceptable only if extensibility points remain explicit and runtime validation stays centralized.

## Source Of Truth

- Public entrypoint: `src/features/clinical-documents/public.ts`
- Architecture map: `../src/features/clinical-documents/ARCHITECTURE.md`
- Editor runtime notes: `./CLINICAL_DOCUMENT_EDITOR_RUNTIME.md`
- Workspace bootstrap/draft/actions hooks inside `src/features/clinical-documents/hooks`
- Definitions and registries inside `src/features/clinical-documents/domain`
- Repository/runtime contracts in feature services and repositories

## Invariants

- New section behavior must be registered, not hard-coded in the sheet.
- Read/write/export paths must validate contracts before leaving repositories/services.
- Recoverable Drive/export failures must return user-safe outcomes, not raw exceptions as “normal flow”.
- External callers must not depend on internal hooks/controllers/components.
- The workspace must not expose manual remote-conflict UX: no "Actualización remota pendiente",
  "Recargar remoto" or "Descartar local" notices/actions in clinical documents.

## How To Change Safely

1. For a new document behavior, start from definitions/registries before touching render code.
2. For save/sign/export changes, update use-cases or typed services before changing UI.
3. If a remote setting/template source changes, keep runtime adapters injectable and avoid direct `defaultFirestoreRuntime` dependencies.
4. If external modules need a new capability, expose it from `public.ts`; do not import internals from outside the feature.

## Required Validation

- `npm run typecheck`
- `npm run check:quality`
- `npm run test:clinical-documents`
- boundary checks for clinical-documents feature

## Persisted content hash

`src/domain/clinical-documents/hash.ts` owns the content hash used by draft factories,
AI import and repository integrity rendering. Consumers use `createClinicalDocumentHash`
directly; do not duplicate the algorithm in feature utilities. The existing UTF-16,
32-bit arithmetic and `h` prefix are compatibility behavior for stored documents.
This hash is a change/integrity marker, not a cryptographic authenticity guarantee.
Golden vectors cover accents, surrogate pairs, line endings and integer overflow.
