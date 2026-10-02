# Safe Change Checklist

Antes de cerrar una modificación relevante en este repo:

### Iterar sin repetir los gates completos

Durante la edición, ejecutar las pruebas del módulo afectado (`npx vitest run <ruta>`)
y el grupo pertinente de `npm run check:quality:group -- <grupo>`:
`boundaries`, `governance`, `security`, `size`, `tests` o `reports`.
Esto es feedback focalizado, **no reemplaza el gate previo al merge**.

Para cambios en límites de imports:

```sh
npx vitest run src/tests/build/featureBoundaryRunner.test.ts src/tests/security/laboratoryImportGovernanceStatic.test.ts
npm run check:quality:group -- boundaries
```

El runner compartido conserva la política de imports y excepciones. El control genérico
reutiliza un snapshot en memoria durante una sola invocación; cada ejecución nueva
lee de nuevo el código. No añadir otra política basada en grep en un test de módulo.

Al cerrar, elegir un gate existente de la lista inferior. `ci:pre-merge` ya incluye
typecheck, lint, calidad completa y unitarios: no ejecutar de nuevo sus componentes
si ya pasaron sobre el mismo diff y entorno. `ci:merge-gate` amplía ese gate con build
y validaciones de preview. Si el código cambia después, revalidar lo afectado y dejar
que CI compruebe el head definitivo. Registrar comando, SHA/diff y resultado; nunca
tratar un resultado anterior a una modificación como evidencia del nuevo código.

### Checklist de cierre

1. Clasificar la change según `scripts/config/sustainable-change-policy.json`.
2. Actualizar tests unitarios e integración afectados por la change.
3. Si la change es upgrade o excepción, documentar owner, riesgo, rollback y criterio de cierre.
4. Revisar si la change toca reglas clínicas de fecha/turno, sync o identidad paciente.
5. Correr `npm run typecheck`.
6. Correr `npm run check:quality`.
7. Elegir y ejecutar el gate correcto:
   `npm run ci:inner-loop`, `npm run ci:pre-merge`, `npm run ci:merge-gate` o `npm run ci:release-gate`.
8. Verificar límites de tamaño/hotspots si el cambio toca archivos grandes.
9. Revisar contratos runtime si la change toca repositorios, Firestore, templates o serialización.
10. Revisar si la change impacta `firestore.rules`, emulador o E2E crítico.
11. Si se agrega una excepción de arquitectura o tamaño, documentarla en la allowlist correspondiente.
12. Si se introduce un nuevo error operativo, mapearlo al contrato compartido y a telemetría.
13. Dejar referencias en README/ARCHITECTURE del módulo si la decisión cambia una regla estable.
14. Si la change toca startup, lazy loading o vistas críticas, correr `npm run check:flow-performance-budget`.
15. Si el budget por flujo cambia, regenerar y revisar `reports/e2e/flow-performance-budget-summary.json` y `.md`.
16. Si la change toca `index.html`, login o refresh autenticado de módulos críticos, revisar y preservar el contrato de [docs/system-behaviors.md](./system-behaviors.md) y mantener verdes `src/tests/security/startupPrebootContractStatic.test.ts`, `src/tests/app-shell/BootstrapRouteChrome.test.tsx` y `src/tests/components/AppLoadingBehavior.test.tsx`.
17. Si la change toca login, roles o auth bootstrap, revisar y actualizar [docs/AUTH_ACCESS_MODEL.md](./AUTH_ACCESS_MODEL.md).
18. Si la policy lo exige, regenerar `reports/release-readiness-scorecard.md`.
19. Si la change toca `daily-record/sync`, revisar [docs/ADR_DAILY_RECORD_RUNTIME_PATH.md](./ADR_DAILY_RECORD_RUNTIME_PATH.md).
20. Si la change toca auth runtime, revisar [docs/ADR_AUTH_RUNTIME_RECOVERY.md](./ADR_AUTH_RUNTIME_RECOVERY.md).
21. Si la change toca documentos clínicos, revisar [docs/ADR_CLINICAL_DOCUMENT_WORKSPACE_CONTRACT.md](./ADR_CLINICAL_DOCUMENT_WORKSPACE_CONTRACT.md).
22. Si la change toca handoff, revisar [docs/ADR_HANDOFF_RUNTIME_SURFACES.md](./ADR_HANDOFF_RUNTIME_SURFACES.md).

### Parche transitivo gRPC (2026-10-01)

- **Owner:** plataforma Firebase/Functions HHR.
- **Reason:** corregir GHSA-m9gg-hp2v-232j actualizando el override existente en
  ambos paquetes; no se ha demostrado explotación en HHR.
- **TargetVersion:** `@grpc/grpc-js` 1.14.5 en los dos manifests y lockfiles.
- **RiskLevel:** bajo/medio: parche de transporte Node utilizado por Admin/Google;
  se conserva Firebase web 12.14.0 y el resto del grafo.
- **RollbackPlan:** revertir este commit y ejecutar `npm ci` en raíz y Functions;
  la versión anterior volvería a estar señalada por el audit. No borrar datos ni colas.
- **VerificationGate:** categoría `dependency_upgrade`: audit de ambos paquetes,
  `ci:merge-gate`, revisión independiente y CI del head final; ampliar con
  `test:release-confidence` para validar el transporte de la autoridad.

Referencia: [aviso gRPC](https://github.com/advisories/GHSA-m9gg-hp2v-232j).

El gate ampliado `check:release-evidence` sigue señalando 27 archivos de tests con
relojes reales o esperas de turno. Esa señal es anterior al parche: no cambia ningún
archivo de tests ni su detector. No se declara aprobado ese gate, no se añaden
marcas `@flake-safe` ni excepciones para silenciarlo. Su revisión corresponde a un
bloque propio de determinismo de fixtures y control de esperas. Este parche
transitivo no actualiza el SDK Firebase web ni su bootstrap; conserva los controles
exigidos por `dependency_upgrade` sin modificar la política de clasificación.

### Parche del tooling FTP de CI (2026-10-01)

- **Owner:** infraestructura de tests/CI HHR.
- **Reason:** GHSA-c475-qrg2-pj4r bloquea el audit del tooling Firebase; no se ha
  demostrado explotación en HHR.
- **TargetVersion:** override existente de `basic-ftp` a 6.2.1; sólo manifest y
  lockfile raíz. No cambia Firebase web, Functions ni la política de audit.
- **RiskLevel:** medio: el salto 5 a 6 rechaza hosts de transferencia FTP distintos
  por defecto. `get-uri` conserva las APIs usadas (`Client`, `access`, `list`,
  `lastMod`, `downloadTo`, `close`); no habilitar `allowSeparateTransferHost`.
- **RollbackPlan:** revertir este PR y ejecutar `npm ci`; el audit volvería a
  bloquear la versión vulnerable. No borrar datos ni colas.
- **VerificationGate:** categoría `dependency_upgrade`: audit de raíz y Functions,
  carga del consumidor `get-uri`, emulador/autoridad sintética, revisión independiente
  y CI completo del head final con sus umbrales intactos.

Referencias: [aviso FTP](https://github.com/advisories/GHSA-c475-qrg2-pj4r),
[cambio de seguridad en 6.0](https://github.com/patrickjuchli/basic-ftp/releases/tag/v6.0.0).

### Alineación del SDK Admin de tooling raíz (2026-10-02)

- **Owner:** plataforma Firebase/Functions y emuladores HHR.
- **Reason:** los scripts y emuladores importan Admin directamente, pero la raíz
  lo recibía como peer de Functions 7.2.5. Admin 13.9 incorporaba `node-forge`
  1.4.0, señalado por GHSA-86w9-cpqp-85rv; no se ha demostrado explotación en HHR.
- **TargetVersion:** declarar Admin 14.4.0 y Functions 7.4.0 como dev dependencies
  explícitas de raíz, alineadas con las versiones ya usadas en `functions/`.
  Functions 7.4 admite Admin 13 y 14; actualizar sólo Functions no garantiza el retiro.
- **RiskLevel:** medio: cambia el SDK de tooling y sus tipos/transitivos. Firebase web,
  el paquete Functions desplegable, APIs clínicas y reglas permanecen intactos.
- **RollbackPlan:** revertir manifest/lock raíz y ejecutar `npm ci`; reaparece la
  cadena vulnerable. No borrar datos, colas ni aplicar un override criptográfico.
- **VerificationGate:** `dependency_upgrade`: instalación limpia, audit en ambos
  paquetes, tipos/lint y `ci:merge-gate`, suites Functions, emuladores sintéticos
  de autoridad, revisión independiente y CI del head final.

Referencia: [aviso node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
El aviso no publica un parche; Admin 14 elimina esa dependencia. Los permisos IAM
y el despliegue no forman parte de esta alineación del tooling local/CI.
