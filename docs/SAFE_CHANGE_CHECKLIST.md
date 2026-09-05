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
