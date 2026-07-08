# Clinical Legal Audit Traceability Design

## Goal

Improve the audit module so clinical/legal traceability is clear, navigable, and understandable by a clinical reviewer. The normal audit view should answer: who did what, to which patient or record, when, from which available origin, and what changed, without exposing implementation codes or raw JSON.

## Current Context

The existing audit system already persists `AuditLogEntry` records with `action`, `entityType`, `entityId`, `timestamp`, user fields, `ipAddress`, `summary`, and `details`. It also has a broad admin UI with filters, grouping, timeline, PDF/Excel export, IndexedDB fallback, Firestore sync, worker-based filtering, and tests.

The current weakness is presentation and clinical semantics. Some rows show useful phrases, but the fallback can expose internal action names or raw JSON. Important legal context such as IP is present only when cached, not visually elevated. Search does not clearly treat IP and UID as first-class legal traceability fields. Expanded rows mix clinical detail with technical differential language.

## Principles

- Preserve the current stored payload shape for compatibility.
- Add a clinical/legal presentation layer instead of rewriting persistence.
- Prefer clinical language over code language in the default UI.
- Keep technical fields available only in an advanced/admin detail area.
- Make patient-first reconstruction the primary path; user/IP investigation is secondary but explicit.
- Treat missing IP or missing actor metadata as visible traceability gaps, not invisible absence.

## Clinical Audit Presentation Contract

Each audit log shown in the UI should derive a `ClinicalAuditPresentation` object:

- `title`: short clinical phrase, for example `Paciente trasladado de cama`.
- `narrative`: one sentence describing the action in plain clinical Spanish.
- `affectedSubject`: patient, cama, documento, registro, usuario, or sistema.
- `actorLabel`: display name or user id fallback.
- `actorSecondary`: email or UID if available.
- `originLabel`: IP if present, otherwise `IP no disponible`.
- `timestampLabel`: localized date and time.
- `impact`: `registro`, `visualizacion`, `modificacion`, `eliminacion`, `exportacion`, `sistema`, or `sesion`.
- `clinicalArea`: censo, entrega, documentos, recetas, CUDYR, heridas, sesion, mantenimiento, or sistema.
- `importantChanges`: readable field-level changes with clinical labels.
- `technical`: original action, entity type, entity id, and selected raw details for advanced inspection.

The presentation layer must never mutate the original log. It only translates and classifies.

## UI Design

The audit view should become easier to scan:

- Main row shows clinical title, narrative, actor, patient/record, time, and IP/origin.
- Search placeholder should name the real legal targets: patient, RUT, user, UID, IP, action, or record.
- Table headings should use clinical/legal language: `Momento`, `Responsable`, `Evento clínico`, `Afectado`, `Origen`.
- Expanded row should show sections:
  - `Resumen clínico`
  - `Responsable`
  - `Origen de acceso`
  - `Cambios relevantes`
  - `Detalle técnico avanzado`
- Technical codes such as `PATIENT_MODIFIED`, `movementKind`, and raw `details` JSON should not appear in the normal row.

## Scope For This First Implementation

This first block focuses on high value, low risk:

- Create the pure presentation layer and tests.
- Make IP, UID, user, summary, patient, RUT, action labels, and entity id searchable.
- Update row/table/filter labels to clinical/legal language.
- Replace raw fallback summaries with clinical-safe fallbacks.
- Add an advanced technical detail panel in expanded rows.

Out of scope for this first block:

- Migrating existing Firestore audit documents.
- Changing Firestore rules.
- Adding immutable legal-signature or cryptographic audit chains.
- Guaranteeing regulatory compliance certification.
- Building a separate audit database.

## Data Flow

1. Persistence continues writing the current `AuditLogEntry`.
2. `AuditLogRow` receives a log and derives its clinical presentation.
3. `auditWorkerLogic` filters logs using both raw searchable fields and human labels.
4. Export paths can continue using existing log data in this block; export language improvements can follow after the UI contract is stable.

## Error And Missing Data Handling

- Missing IP renders as `IP no disponible`.
- Missing actor renders as `Usuario no identificado`.
- Missing patient renders as `Paciente no identificado` only when the action is patient-related.
- Unknown actions render as `Evento registrado` with the original action hidden in advanced technical detail.
- Malformed timestamps keep the existing `Fecha desconocida` behavior.

## Testing Strategy

- Unit tests for the presentation layer:
  - movement/action logs produce clinical Spanish narratives.
  - user/IP fields render clearly.
  - unknown actions do not expose raw JSON in the default narrative.
  - important changes translate known field names.
- Worker/filter tests:
  - IP, UID, action label, entity id, patient, and summary are searchable.
- Component tests:
  - audit rows show clinical/legal headings and hide raw internal action names in normal view.

## Acceptance Criteria

- The audit module has a central clinical presentation layer.
- User/IP are visible and searchable when present.
- Missing IP is explicitly shown as unavailable.
- Default audit rows avoid code-oriented language and raw JSON.
- Expanded detail makes clinical summary and technical detail separate.
- Focused tests pass.
- `npm run typecheck`, `npm run lint -- --max-warnings 0`, and `npm run check:quality` pass before PR.
