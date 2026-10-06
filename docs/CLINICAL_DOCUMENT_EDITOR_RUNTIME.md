# Clinical Documents Editor Runtime

## Purpose

This note captures the runtime contracts that keep the `clinical-documents` editor stable in day-to-day use. It complements the broader workspace ADR with the specific editor/draft behaviors that are easy to break accidentally.

## Editor Invariants

1. All editor insertions go through the same mutation pipeline.
   That includes typing, pasted HTML, pasted plain text, pasted images, slash commands, table insertion and link insertion.

2. External draft values do not rewrite the focused editor in place.
   If a remote/base value arrives while the editor is focused, the sync is deferred until blur.

3. Indentation uses the shared clinical formatting contract.
   Visual indentation, sanitized HTML and plain-text export must stay aligned through `CLINICAL_DOCUMENT_INDENT_STEP_PX`.

4. Toolbar commands are wiring, not business logic.
   Toolbar dialogs may build HTML, but they delegate the actual insertion to the active editor API.

5. Re-seeding history discards snapshots pending from the previous buffer.
   External content becomes the single undo baseline; a delayed local snapshot
   must not reappear after that replacement. Flush, re-seed and unmount share
   the same cancellation path. Content changes still publish eagerly through
   `onChange`; cancelling a history snapshot does not discard the draft.

## Draft / Sync Invariants

1. Local dirty state wins over equivalent remote reloads.
   A selected document is preserved while the user has local changes unless a truly newer remote version appears.

2. Remote updates stage before they replace the draft.
   Dirty local drafts should receive `REMOTE_UPDATE_RECEIVED`, not an immediate `LOAD_DOCUMENT`.

3. Autosave is latest-response-wins.
   Older autosave responses must not mark the draft clean or overwrite the base state after a newer request has already completed.

## QA Focus

When touching this module, manually verify at least:

- write, blur, and continue writing without cursor jumps
- indent/outdent across consecutive lines
- indent a paragraph and leave the module before autosave debounce fires
- indent a paragraph and switch to another document before autosave debounce fires
- paste from Word, PDF and email
- insert table and link from the toolbar
- edit an image, then continue typing
- local dirty draft while a remote refresh arrives

## Required Validation

- `npm run typecheck`
- `npm run check:quality`
- focused clinical-documents tests covering editor + draft sync
