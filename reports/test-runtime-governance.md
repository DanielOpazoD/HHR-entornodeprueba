# Test Runtime Governance

- Generated: 2026-07-06T05:44:53.359Z
- Git SHA: `cf972b18`
- Worktree dirty: `false`
- PR critical path budget: 35.0m

## PR Blocking Suites

| Suite | Scripts | Budget | Reason |
| --- | --- | ---: | --- |
| Unit risk shards | `test:ci:unit:shard` | 13.0m | Broad unit/integration coverage remains PR-blocking but horizontally sharded. |
| Clinical sync simulator release gate | `test:clinical-sync-simulator` | 2.0m | Distributed clinical sync regressions must stay visible in PR CI. |
| Firestore rules and sync emulator | `test:rules:ci`<br>`test:emulator:sync:ci` | 4.0m | Security rules and sync emulator behavior protect production writes. |
| Critical browser flows | `test:e2e:critical:ci` | 8.0m | Critical user-visible clinical flows remain PR-blocking. |

## Nightly Suites

| Suite | Script | Budget | Reason |
| --- | --- | ---: | --- |
| Sync queue load budget | `test:sync-load` | 5.0m | Load behavior is valuable trend evidence but should not lengthen every PR. |
| Full release confidence pack | `test:release-confidence:full` | 20.0m | Full pack catches cross-surface drift on schedule/manual runs. |
| Clinical stability E2E | `test:e2e:clinical-stability:ci` | 20.0m | Long browser scenario suite belongs in nightly coverage, not the PR critical path. |

## Slow Runtime Signals

| Check | Group | Duration |
| --- | --- | ---: |
| `check:feature-public-api-boundary` | boundaries | 6.2s |
| `check:security` | security | 3.4s |
| `check:test-runtime-governance` | tests | 2.5s |
| `check:unit-shard-balance` | tests | 1.9s |
| `check:architecture` | boundaries | 1.7s |
| `check:module-dependencies` | boundaries | 1.4s |
| `check:firestore-runtime-boundary` | boundaries | 1.4s |
| `check:native-dialogs` | boundaries | 1.4s |

- Unit shard balance: 1401 files, 0% spread across 4 shard(s), tolerance 25%, per-file overhead 0.1s.

- CI observed unit shard runtime: no_observed_ci_data, 0/4 shard(s), 0% observed spread.
  - Advisory: No observed CI runtime data is available yet.

## Fixture Duplication Governance

- Max inline DailyRecord fixture lines: 80
- Preferred roots: `src/tests/support`, `src/tests/utils`, `src/tests/integration/setup.tsx`

| Watchlist | Preferred Home | Reason |
| --- | --- | --- |
| large-inline-daily-record | shared builders under src/tests/support or src/tests/utils | DailyRecord fixtures are expensive to maintain when copied across clinical tests. |
| browser-runtime-mock | src/tests/utils/browserWindowRuntimeMock.ts | Runtime adapter mocks should stay centralized to avoid subtle UI/runtime drift. |
| sync-client-scenario | src/tests/support/clinicalSyncSimulator | Multi-PC/replay cases should reuse the simulator harness rather than bespoke stale-client fixtures. |

## Fixture Duplication Signals

| Signal | Files | Examples | Preferred Home |
| --- | ---: | --- | --- |
| large-inline-daily-record | 135 | `src/tests/application/ai/clinicalSummaryContextUseCase.test.ts`<br>`src/tests/application/census-email/sendCensusEmailUseCases.test.ts`<br>`src/tests/application/handoff/handoffManagementUseCases.test.ts`<br>`src/tests/domain/handoff/view.test.ts`<br>`src/tests/emulator/atomic-write-guards.emulator.test.ts` | shared DailyRecord builders under src/tests/support or src/tests/utils |
| browser-runtime-mock | 10 | `src/tests/components/BookmarkEditorModal.test.tsx`<br>`src/tests/components/DatabaseStatusBanner.test.tsx`<br>`src/tests/components/IEEHFormDialog.test.tsx`<br>`src/tests/components/StorageStatusBadge.test.tsx`<br>`src/tests/components/TransferDocumentPackageModal.test.tsx` | src/tests/utils/browserWindowRuntimeMock.ts |
| sync-client-scenario | 24 | `src/tests/emulator/sync-mutation-idempotency.emulator.test.ts`<br>`src/tests/functions/dailyRecordWriteAuthorityFullSaveRevision.test.ts`<br>`src/tests/functions/dailyRecordWriteAuthorityFunctions.test.ts`<br>`src/tests/functions/dailyRecordWriteAuthorityIdempotency.test.ts`<br>`src/tests/integration/sync-resilience.test.ts` | src/tests/support/clinicalSyncSimulator |

