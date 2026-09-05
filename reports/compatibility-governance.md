# Compatibility Governance Snapshot

- Generated: stable:compatibility-governance
- Policy version: 2026-04-v1
- Tracked entries: 4

## Policy

- Expansion rule: Ninguna feature nueva puede depender de compatibilidad legacy salvo excepcion documentada y gobernada.
- Documentation rule: Todo bridge debe tener owner, motivo, retirementCriteria y remainingConsumers.
- Exception process: Las excepciones deben agregarse a este inventario antes de merge y deben quedar cubiertas por guardrail o test de regresion.

## Compatibility Inventory

| Path | Owner | Kind | Exists | Remaining consumers | Risk if retained | Target |
| --- | --- | --- | --- | --- | --- | --- |
| `functions/lib/auth/authHelpersFactory.js` | auth | migration_shim | yes | callables auth que todavía pueden encontrar viewer_census en config/roles legado | Puede ocultar deuda transicional y retrasar el retiro del modelo legacy. | 2026-Q2 |
| `netlify/functions/lib/firebase-auth.ts` | platform | migration_shim | yes | Netlify Functions que dependen de config/roles como fuente operativa de autorización | Puede ocultar deuda transicional y retrasar el retiro del modelo legacy. | 2026-Q2 |
| `firestore.rules` | security | legacy_bridge | yes | tokens o config/roles aún no recanonizados en ambientes desplegados | Extiende superficie de compatibilidad y riesgo operativo en reglas o datos. | 2026-Q2 |
| `storage.rules` | security | legacy_bridge | yes | sesiones existentes con claim viewer_census todavía sin refresh de token | Extiende superficie de compatibilidad y riesgo operativo en reglas o datos. | 2026-Q2 |

## Retirement Criteria

- `functions/lib/auth/authHelpersFactory.js`: Fuente real de roles sin aliases legacy y helper sin write-back de canonización. (reason: Autocorregir aliases legacy de roles al resolver acceso desde config/roles sin perder compatibilidad operacional.)
- `netlify/functions/lib/firebase-auth.ts`: Fuente real de roles sin aliases legacy y helper sin compatibilidad viewer_census -> viewer. (reason: Autocorregir aliases legacy de roles antes de autorizar endpoints serverless sensibles.)
- `firestore.rules`: Claims activos y config/roles sin viewer_census en producción, con rules recortadas al rol canónico. (reason: Mantener compatibilidad temporal de claims/config legacy hasta cerrar la migración operacional completa.)
- `storage.rules`: Claims activos sin viewer_census en producción y rules limitadas al rol viewer canónico. (reason: Mantener compatibilidad temporal de claims viewer legacy para storage mientras se completa la recanonización.)

