# Pure suites without a DOM

Use `// @vitest-environment node` only for suites whose subject and assertions do
not depend on browser behavior. Keep component, hook and browser-runtime tests in
jsdom or Playwright. Do not add browser mocks merely to qualify a suite for Node.
The shared setup, timezone policy, worker isolation and assertion set remain intact.

## Episode/presence batch — 2026-09-27

The following four pure suites now use Node; all 38 existing tests still run:

- `src/tests/features/census/clinicalDocumentPresenceController.test.ts`
- `src/tests/views/census/clinicalDocumentPresenceController.test.ts`
- `src/tests/application/patient-flow/clinicalEpisode.test.ts`
- `src/tests/application/patient-flow/clinicalEpisodeIdPolicy.test.ts`

They cover episode identity, readmission, legacy keys, patient matching and
presence counts. Their React Query hook tests remain in jsdom.

Reproduce with Node 22 and the four paths above:

```sh
npx vitest run <four-paths> --maxWorkers=2
```

Local measurements used three consecutive runs per environment, same checkout,
Node 22.22.2 and command. Wall time includes `npx` startup:

| Environment | Wall times                 | Median   |
| ----------- | -------------------------- | -------- |
| jsdom       | 18.667 / 14.916 / 11.500 s | 14.916 s |
| Node        | 8.685 / 9.159 / 8.941 s    | 8.941 s  |

Vitest's last-run environment accounting fell from 9.43 s (summed workers) to
1 ms. Other build/check processes were active locally, so wall-time differences
are directional, not a promised CI improvement. The architectural gain is removing
four unnecessary DOM initializations while preserving all behavioral assertions.
Measure the actual shard history before attributing a CI-wide speedup to this batch.

## Census controller batch — 2026-09-28

127 additional suites under `src/tests/views/census/` now use Node. These suites
exercise pure controllers and models, with the same 595 tests and assertion names.
No assertions, global setup, coverage thresholds or CI jobs were removed.

Keep `sharedCensusBrowserRuntimeController`, `censusBrowserRuntimeAdapter` and
`patientRowOrbitalQuickActionsController` in jsdom: their subjects include browser
runtime behavior. Component and hook suites also retain their existing environment.

Before adding the annotations, three paired runs used the same checkout, Node
22.22.2, four workers and the same 127 paths. Run order alternated between pairs;
other local validation commands were stopped. Every run passed all 595 tests.

| Environment | Wall times                 | Median   |
| ----------- | -------------------------- | -------- |
| jsdom       | 19.263 / 17.979 / 19.522 s | 19.263 s |
| Node        | 8.912 / 8.638 / 10.172 s   | 8.912 s  |

The median for this subset fell by 53.7%. This is a local subset measurement,
not a claim about total CI duration or application performance. CI still runs all
critical coverage and release checks. Reassess the observed workflow history before
changing shard allocation or claiming a CI-wide reduction.

To repeat the comparison, take the test paths changed by this batch from its Git
diff and run them on the parent revision with `vitest run <paths> --maxWorkers=4`,
then with `--environment=node`, alternating three pairs. On the annotated revision,
the per-file environment directives take precedence; a CLI `--environment=jsdom`
alone does not restore the original comparison. Confirm all test identities and
outcomes match, and run `npm run check:critical-coverage` after an environment change.

## Bed-management cohort — 2026-10-02

The ten `src/tests/hooks/controllers/bedManagement*.test.ts` suites and the two
`src/tests/hooks/useBedManagementReducer*.test.ts` suites run in Node together.
All 84 cases, assertions, shared setup and critical coverage remain unchanged.
These exercise patch construction, identity, specialty intent, crib actions and
dispatch ports; they do not render hooks or depend on DOM behavior. Integration
and component tests keep their browser environment. No browser mocks were added.

Three alternating pairs on Node 22.22.2, two workers and the same checkout passed
identical test identities and outcomes:

| Environment | Wall times (seconds)  | Median |
| ----------- | --------------------- | ------ |
| jsdom       | 4.355 / 4.034 / 4.519 | 4.355  |
| Node        | 1.721 / 1.717 / 1.794 | 1.721  |

This is a local cohort measurement (60.5% lower median), not a CI-wide or clinical
application speed claim. Reproduce on the parent revision, before the directives:

```sh
node node_modules/vitest/vitest.mjs run src/tests/hooks/controllers/bedManagement*.test.ts src/tests/hooks/useBedManagementReducer*.test.ts --maxWorkers=2 --environment=jsdom
node node_modules/vitest/vitest.mjs run src/tests/hooks/controllers/bedManagement*.test.ts src/tests/hooks/useBedManagementReducer*.test.ts --maxWorkers=2 --environment=node
```

Keep homogeneous migrations in one reviewable cohort with a shared rationale and
paired measurements; do not create one PR per annotation or merge unrelated suites
solely to reduce file count.

## Handoff controller cohort — 2026-10-03

The ten handoff controller suites under `src/tests/hooks/controllers/` use Node:
`handoffLogicViewStateController`, `handoffManagementMutationController`,
`handoffManagementOutcomeController`, `handoffManagementPersistenceController`,
`handoffNursingNoteController`, `handoffShareLinkController`, `handoffVisibilityController`,
`manualMedicalHandoffMessageController`, `medicalHandoffHandlersController` and
`medicalHandoffMutationRunner`. All 43 cases and their assertions are unchanged;
no browser mocks or shared-setup changes were introduced. React hooks, components
and browser integration tests remain in their existing environments.

Three alternating pairs on Node 22.22.2 with two workers passed identical test
identities and outcomes. jsdom runs: 3.523, 3.521, 3.341 s; Node runs: 1.387,
1.360, 1.399 s. Median fell from 3.521 to 1.387 s (60.6%) for this local cohort;
this is not a CI-wide or application speed claim. On the parent revision, run
`node node_modules/vitest/vitest.mjs run src/tests/hooks/controllers/handoff*.test.ts src/tests/hooks/controllers/*Handoff*.test.ts --maxWorkers=2 --environment=jsdom`,
then the same command with `--environment=node`, alternating three pairs. On the
annotated revision, per-file directives take precedence over the CLI environment.
