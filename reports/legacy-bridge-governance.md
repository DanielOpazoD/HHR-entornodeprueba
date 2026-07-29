# Legacy Bridge Governance Snapshot

- Generated: stable:legacy-bridge-governance
- Policy version: 2026-03-v2
- Allowed modes: explicit_bridge, disabled
- Hot path policy: disabled

## Allowed Entrypoints

- `DailyRecordRepository.bridgeLegacyRecord`
- `legacyRecordBridgeService.bridgeLegacyRecordsRange`

## Allowed Importers

- `src/services/repositories/dailyRecordRepositoryReadService.ts`

## Retirement Gates

| Gate | Label | Rationale |
| --- | --- | --- |
| hot-path-isolation | Hot path isolated | Legacy compatibility must stay outside read/write/sync hot paths. |
| explicit-usage-observed | Explicit usage observed and auditable | Any remaining bridge usage must be measurable before restricting or retiring it. |
| migration-rules-governed | Migration rules governed | Legacy imports must keep using the governed migration pipeline and schema checks. |
| release-window-clear | Release window without bridge dependency | The bridge can retire only after at least one release window with no required usage. |

## Candidate Path Templates

- `hospitals/hanga_roa/dailyRecords/:date`
- `hospitals/hhr/dailyRecords/:date`
- `dailyRecords/:date`
- `records/:date`
- `hospitals/hanga_roa/dailyRecords`
- `hospitals/hhr/dailyRecords`
- `dailyRecords`

## Retirement Phases

- `observe`: Use only while hot path isolation or governance prerequisites are incomplete.
- `restrict`: Default stage once bridge is explicit-only and auditable.
- `retire_ready`: Allowed only when runtime mode is disabled and a release window passed without dependency.

