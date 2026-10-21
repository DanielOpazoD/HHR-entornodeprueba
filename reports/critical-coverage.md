# Critical Coverage Report

- Generated: 2026-10-21T01:36:48.833Z
- Mode: dual-gated
- Coverage artifact: `coverage/critical/coverage-final.json`
- Coverage artifact present: yes
- Status: passing

## Critical Zones

| Zone | Source files | Test files | Structural | Lines | Functions | Branches | Baseline | Status |
| --- | ---: | ---: | --- | ---: | ---: | ---: | --- | --- |
| `src/features/census/controllers` | 143 | 285 | PASS (199.3%) | 91.8% | 95.0% | 79.0% | 90.6% / 94.3% / 77.1% | PASS |
| `src/features/clinical-documents` | 140 | 108 | PASS (77.1%) | 86.1% | 85.0% | 74.6% | 83.0% / 80.0% / 72.0% | PASS |
| `src/services/transfers` | 11 | 6 | PASS (54.5%) | 89.4% | 89.3% | 75.7% | 81.5% / 79.5% / 70.2% | PASS |
| `src/services/storage/firestore` | 26 | 79 | PASS (303.8%) | 89.8% | 92.5% | 86.6% | 82.5% / 89.0% / 78.0% | PASS |
| `src/services/auth` | 43 | 26 | PASS (60.5%) | 82.0% | 81.6% | 68.9% | 72.0% / 73.0% / 57.0% | PASS |
| `src/services/auth/bootstrap` | 5 | 26 | PASS (520.0%) | 92.2% | 100.0% | 77.8% | 87.0% / 89.0% / 75.0% | PASS |
| `src/services/backup` | 20 | 18 | PASS (90.0%) | 82.2% | 83.9% | 67.3% | 78.0% / 80.0% / 63.0% | PASS |
| `src/features/reminders/admin` | 3 | 4 | PASS (133.3%) | 98.3% | 97.6% | 91.2% | 77.5% / 60.0% / 85.0% | PASS |
| `src/app-shell` | 11 | 121 | PASS (1100.0%) | 78.2% | 81.3% | 66.0% | 76.2% / 70.0% / 64.5% | PASS |
| `src/services/patient-history` | 3 | 5 | PASS (166.7%) | 87.6% | 85.7% | 75.9% | 80.0% / 80.0% / 67.6% | PASS |
| `src/services/export-manager` | 3 | 6 | PASS (200.0%) | 99.4% | 97.8% | 98.0% | 75.0% / 75.0% / 65.0% | PASS |
| `src/shared/census/upc-critical` | 3 | 4 | PASS (133.3%) | 71.4% | 53.2% | 67.7% | 65.2% / 50.0% / 55.9% | PASS |
| `src/services/storage/sync-critical` | 3 | 79 | PASS (2633.3%) | 99.0% | 96.3% | 100.0% | 95.0% / 95.0% / 90.5% | PASS |
| `src/services/storage/indexeddb-recovery` | 3 | 79 | PASS (2633.3%) | 100.0% | 100.0% | 86.7% | 99.0% / 99.0% / 83.0% | PASS |
| `src/features/rayen-import/discharge-replan-critical` | 5 | 422 | PASS (8440.0%) | 91.4% | 92.9% | 86.9% | 87.0% / 88.0% / 82.0% | PASS |
| `src/features/handoff` | 59 | 33 | PASS (55.9%) | 83.7% | 78.3% | 75.5% | 82.5% / 76.5% / 74.6% | PASS |

## Notes

- El gate principal usa cobertura instrumentada por zona critica.
- La metrica estructural se mantiene como guardrail auxiliar para detectar zonas sin masa critica de pruebas.

