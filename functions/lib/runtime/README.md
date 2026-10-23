# `functions/lib/runtime`

## Contrato

- Configuración y políticas runtime compartidas para Functions.
- El hospital activo, capacidad y validaciones de contexto viven aquí.
- `runtimeContract.js` fija el contrato backend publicado: versión runtime, cliente mínimo
  soportado y rango de schema esperado.
- La versión 3 del backend corresponde a los días divididos de la fase 1a
  (`DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md`).
- El cliente mínimo publicado es solo un aviso: lo sirve `netlify/functions/runtime-contract.js`
  con la publicación web, el cliente se bloquea a sí mismo (`VersionContext.tsx`) y ninguna
  Function lo lee. La valla real es la verificación por solicitud: en un día dividido, o que la
  escritura dividiría, el parche con guarda y el lote clínico rechazan una escritura de campos
  movidos sin `clientRuntimeContractVersion` 3 o mayor (`clinical_derived_client_outdated`), después
  de la clasificación idempotente. El guardado completo no la necesita: en esos días toma los campos
  movidos del remoto.

## Límites

- Los módulos de dominio (`auth`, `mirror`, `minsal`) no deben hardcodear hospital/capacidad.
- Nuevas restricciones de contexto deben pasar por `hospitalPolicy.js`.
- Si cambia el contrato runtime, debe mantenerse alineado con:
  - `src/constants/runtimeContracts.ts`
  - `src/constants/version.ts`
  - `src/services/repositories/runtimeContractGovernance.ts`
