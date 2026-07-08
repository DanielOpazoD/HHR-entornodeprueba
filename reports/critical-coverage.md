# Critical Coverage Report

- Generated: 2026-07-05T06:17:54.609Z
- Mode: dual-gated
- Coverage artifact: `coverage/critical/coverage-final.json`
- Coverage artifact present: yes
- Status: passing

## Critical Zones

| Zone | Source files | Test files | Structural | Lines | Functions | Branches | Baseline | Status |
| --- | ---: | ---: | --- | ---: | ---: | ---: | --- | --- |
| `src/features/census/controllers` | 143 | 236 | PASS (165.0%) | 96.1% | 99.1% | 87.9% | 93.6% / 97.5% / 83.3% | PASS |
| `src/features/clinical-documents` | 141 | 103 | PASS (73.0%) | 85.8% | 84.8% | 74.5% | 83.0% / 80.0% / 72.0% | PASS |
| `src/services/transfers` | 24 | 13 | PASS (54.2%) | 85.5% | 84.0% | 74.9% | 81.5% / 79.5% / 70.2% | PASS |
| `src/services/storage/firestore` | 16 | 51 | PASS (318.8%) | 89.7% | 94.5% | 81.8% | 82.5% / 89.0% / 78.0% | PASS |
| `src/services/auth` | 37 | 22 | PASS (59.5%) | 84.9% | 86.3% | 71.1% | 72.0% / 73.0% / 57.0% | PASS |
| `src/services/auth/bootstrap` | 5 | 22 | PASS (440.0%) | 91.9% | 100.0% | 81.7% | 87.0% / 89.0% / 75.0% | PASS |
| `src/services/backup` | 20 | 18 | PASS (90.0%) | 81.1% | 82.0% | 64.9% | 78.0% / 80.0% / 63.0% | PASS |
| `src/features/reminders/admin` | 3 | 4 | PASS (133.3%) | 98.3% | 97.6% | 91.2% | 77.5% / 60.0% / 85.0% | PASS |
| `src/app-shell` | 11 | 104 | PASS (945.5%) | 92.6% | 93.3% | 81.3% | 80.0% / 70.0% / 81.0% | PASS |
| `src/services/patient-history` | 2 | 1 | PASS (50.0%) | 96.0% | 100.0% | 78.4% | 80.0% / 80.0% / 70.0% | PASS |
| `src/services/export-manager` | 2 | 1403 | PASS (70150.0%) | 96.0% | 96.6% | 92.5% | 75.0% / 75.0% / 65.0% | PASS |
| `src/shared/census/upc-critical` | 3 | 1403 | PASS (46766.7%) | 98.3% | 97.9% | 84.7% | 80.0% / 80.0% / 70.0% | PASS |
| `src/services/storage/sync-critical` | 3 | 51 | PASS (1700.0%) | 99.0% | 96.3% | 100.0% | 95.0% / 95.0% / 90.5% | PASS |
| `src/services/storage/indexeddb-recovery` | 3 | 51 | PASS (1700.0%) | 100.0% | 100.0% | 86.7% | 99.0% / 99.0% / 83.0% | PASS |
| `src/features/handoff` | 59 | 32 | PASS (54.2%) | 85.6% | 78.2% | 79.3% | 84.0% / 76.5% / 78.0% | PASS |

## Notes

- El gate principal usa cobertura instrumentada por zona critica.
- La metrica estructural se mantiene como guardrail auxiliar para detectar zonas sin masa critica de pruebas.

