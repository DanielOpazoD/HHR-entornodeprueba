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
