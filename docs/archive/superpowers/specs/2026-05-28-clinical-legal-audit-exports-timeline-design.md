# Clinical Legal Audit Exports And Patient Timeline Design

## Goal

Extend the clinical/legal audit refactor beyond the main table. The audit module should export the same clinical language shown in the UI, provide a patient/episode-oriented timeline, and reduce fallback generic narratives for frequent actions.

## Design

- Keep `AuditLogEntry` persistence unchanged.
- Keep `buildClinicalAuditPresentation(log)` as the single source of clinical language.
- Add a small export/timeline row mapper that derives stable clinical fields from each log.
- Update PDF and Excel exports to use clinical fields instead of raw action codes, raw details, or internal summaries.
- Replace the current user-session-only timeline with a clinical traceability timeline grouped by affected subject. User/session context remains visible inside each event through responsible actor and origin/IP.

## Export Contract

Normal exports include:

- fecha/hora,
- responsable,
- identificador secundario del usuario when present,
- evento clínico,
- relato clínico,
- afectado,
- origen/IP,
- área,
- impacto,
- cambios relevantes.

Normal exports do not include `PATIENT_MODIFIED`, `movementKind`, raw JSON, or `details` dumps. Technical data remains available only in advanced UI detail, not in standard PDF/Excel.

## Timeline Contract

The timeline tab groups events by clinical subject when possible:

- patient name,
- RUT/patient identifier,
- bed/record/entity id fallback,
- user/system fallback for non-patient events.

Each event shows date/time, responsible actor, IP/origin, clinical event title, narrative, affected subject, and relevant changes. The timeline uses current filters indirectly through search/date/action behavior in the audit module, but it does not require a new database query or new persistence model.

## Semantic Coverage

Extend clinical narratives for common actions:

- handoff nursing/medical/sign/restore/novedades,
- patient notes and clinical events,
- CUDYR edits/views,
- bed blocked/unblocked/extra bed,
- data import/export/backfill,
- patient views/harmonization,
- clinical documents,
- prescription deletions,
- wound-care photo upload,
- conflict/system events.

Unknown actions continue to use a safe generic narrative with technical action hidden from normal display.

## Acceptance Criteria

- PDF and Excel audit exports are clinically readable.
- No standard export contains raw internal action codes or `movementKind`.
- Timeline tab shows a clinical/legal patient/episode-oriented view instead of only session activity.
- Timeline event rows show time, responsible, origin/IP, clinical action, affected subject, and changes.
- Frequent actions produce specific clinical narratives.
- Focused tests cover export rows, workbook/PDF output, timeline grouping, and new narrative coverage.
- `typecheck`, `lint -- --max-warnings 0`, `check:quality`, focused tests, and `build` pass before PR.
