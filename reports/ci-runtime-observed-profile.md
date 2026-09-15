# CI Runtime Observed Profile

- Generated: 2026-09-15T21:49:44.019Z
- Git SHA: `d49aaced`
- Worktree dirty: `true`
- Source: `github-actions`
- Repository: `DanielOpazoD/HHR-ServicioHospitalizados`
- Run: `28767128242`
- Input: `/var/folders/6c/jzmkty3d3zdc1p13lrvwgm7m0000gn/T/ci-runtime-observed-2ba8024f-91e3-4db7-ac99-9bc783f0360b.json`
- Status: `observed_ci_data`
- Observed shards: 4/4
- Spread: 16.4% (tolerance 25%)

- Total observed runtime: 14.2m
- Slowest shard: #1 (3.9m)
- Fastest shard: #2 (3.4m)

## Observed Unit Shards

| Shard | Job | Duration | Conclusion |
| ---: | --- | ---: | --- |
| 1 | unit-risk-shard-1 | 3.9m | SUCCESS |
| 2 | unit-risk-shard-2 | 3.4m | SUCCESS |
| 3 | unit-risk-shard-3 | 3.5m | SUCCESS |
| 4 | unit-risk-shard-4 | 3.4m | SUCCESS |

## Recommendation

Observed CI unit shard spread is within observed tolerance; keep monitoring trend data.

## Estimated vs Observed Workload Share

Estimated durations are relative assignment weights; observed durations include full CI job overhead. Balance decisions use each shard share of its respective total.

| Shard | Estimated share | Observed share | Relative ratio |
| ---: | ---: | ---: | ---: |
| 1 | 25% | 27.5% | 110% |
| 2 | 25% | 23.6% | 94.5% |
| 3 | 25% | 25% | 100.1% |
| 4 | 25% | 23.9% | 95.4% |

- Estimated total: 4.5m
- Observed total: 14.2m
- Total ratio: 318%

