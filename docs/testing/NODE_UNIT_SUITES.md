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
