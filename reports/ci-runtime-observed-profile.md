# CI Runtime Observed Profile

- Generated: 2026-09-01T14:59:22.409Z
- Git SHA: `dc795795`
- Worktree dirty: `true`
- Source: `github-actions`
- Repository: `DanielOpazoD/HHR-ServicioHospitalizados`
- Run: `28767128242`
- Input: `/var/folders/6c/jzmkty3d3zdc1p13lrvwgm7m0000gn/T/ci-runtime-observed-5621b224-93f0-4e39-bf60-f01d42ecb8f9.json`
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

## Estimated vs Observed

| Shard | Estimated | Observed | Ratio |
| ---: | ---: | ---: | ---: |
| 1 | 1.1m | 3.9m | 349.8% |
| 2 | 1.1m | 3.4m | 300.4% |
| 3 | 1.1m | 3.5m | 318.4% |
| 4 | 1.1m | 3.4m | 303.4% |

- Estimated total: 4.5m
- Observed total: 14.2m
- Total ratio: 318%

## Advisory Findings

- Observed shard 1 runtime is 349.8% of the estimated duration.
- Observed shard 2 runtime is 300.4% of the estimated duration.
- Observed shard 3 runtime is 318.4% of the estimated duration.
- Observed shard 4 runtime is 303.4% of the estimated duration.

