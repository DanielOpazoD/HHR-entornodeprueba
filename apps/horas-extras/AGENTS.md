# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Approved scope and visual decisions

Responsive website for phones and PCs, not a native mobile app. Combine rapid shift entry,
personal monthly calendar/list and administration review. Navy HHR header, cyan primary
controls, yellow supplied logo, Outfit headings and Inter UI. Synthetic demo covering calendar years 2026 and 2027. Keep it isolated from the clinical root build, Firebase, real accounts and real staff
identifiers. Do not expose it in the HHR login until independent hosting and production
security are explicitly implemented. Grade and employment quality remain blank in Excel;
night labels belong in column E; no extra footer; all admins may close/reopen with reason.

## Profile and calendar decisions (7 October 2026)

Worker accounts (TENS or Enfermería) only access their own records. Admin is an
additional account permission, separate from professional group: administrators
have Mis horas and Gestión del equipo. Team management must visibly separate TENS
and Enfermería. Select calendar year/month before days; records and approval/closure
are independent per period. Preserve institutional Excel for 28/30/31-day months.
