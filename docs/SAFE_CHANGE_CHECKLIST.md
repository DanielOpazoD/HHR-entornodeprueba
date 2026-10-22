# Safe Change Checklist

> Sólo guía vigente. El historial de incidentes y parches va en la descripción del PR que los resuelve; el anterior está en el [historial de runbooks](archive/RUNBOOK_HISTORY_2026.md).

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

### Selección local del gate

`package.json` define las etapas ejecutadas; la política de
`scripts/config/sustainable-change-policy.json` conserva los requisitos adicionales
por tipo de cambio. Esta tabla orienta la selección, no sustituye esa política.

| Alcance                                                            | Validación local de cierre                                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Solo documentación operativa, sin scripts, código ni configuración | `check:docs-drift` y `check:operational-runbooks`; comprobar enlaces y comandos editados |
| Código habitual                                                    | `ci:pre-merge`                                                                           |
| Runtime clínico, auth, storage, bundle o contratos de arquitectura | `ci:merge-gate` y controles adicionales exigidos por la política                         |
| Release o reglas persistentes                                      | `ci:release-gate` y controles adicionales exigidos por la política                       |

Durante edición bastan pruebas focalizadas para obtener feedback; no acreditan
el cierre. `ci:inner-loop` sirve para iterar y para los cambios locales de UI que
la política clasifica expresamente como `safe_local_ui`.

No encadenar gates completos: `ci:release-gate` contiene `ci:merge-gate`, que
contiene `ci:pre-merge`. Un check fallido sigue pendiente aunque el resto pase.
El CI del SHA final y la revisión independiente deben aprobarse antes del merge.
La clasificación remota `docs-only` se decide en CI; no forzar ni omitir checks.

### Checklist de cierre

La compactación visual del acceso del 22 octubre 2026 es `safe_local_ui`:
estrecha el panel y su formulario compartido con la pantalla de carga, elimina
los textos introductorios y muestra Google como icono circular con nombre
accesible. Conserva handlers, bloqueo, recuperación y recarga no destructiva.
Verificar `ci:inner-loop`, pruebas afectadas, build/budgets y navegador: ausencia
de scroll y pie de soporte visible en escritorio y móvil de 320×568, geometría
estable al cargar el módulo, Google oficial y fallback centrados, ambos fondos.
No cambia autenticación, permisos, datos clínicos ni CUDYR.

La ayuda de acceso del 22 octubre 2026 es `critical_runtime`: sustituye el borrado
local desde el login por una recarga normal del navegador. La confirmación informa
que se pierde el formulario, pero conserva datos locales, sesiones y cambios aún
no enviados. Cancelar conserva credenciales y errores en memoria; mientras se
decide, RUT (incluido Enter) y Google permanecen bloqueados. El login ya no invoca
mantenimiento de almacenamiento. No cambia las APIs públicas de mantenimiento,
la limpieza de cierre de sesión ni los controles de autorización.
Verificar `ci:merge-gate`, `test:release-confidence`, pruebas focalizadas de login
y `auth-login-resilience` con una tarea sintética no confirmada en la IndexedDB
real, Web Storage y caché, conservadas tras navegar. La semilla y la autenticación
E2E usan únicamente los fixtures locales del proyecto demo. Revisión independiente
y CI del head definitivo antes del merge; no acreditar verificaciones pendientes.

La continuidad visual del acceso RUT del 21 octubre 2026 es `safe_local_ui`:
elimina la composición provisional antigua y comparte marco, imagen y geometría
con la página lista. Agrupa la ayuda de acceso conservando autocomplete y bloqueo
de campos; la recarga de esa ayuda se rige por el bloque del 22 de octubre anterior.
El formulario RUT carga con la pantalla. No cambia auth runtime,
roles, persistencia, endpoint, credenciales ni datos clínicos. Verificar
`ci:inner-loop`, pruebas afectadas, build/budgets y navegador en escritorio y
móvil: arranque con módulo retrasado, ambos fondos, formulario RUT, ayuda y
refresh autenticado. Revisión independiente y CI del head final antes de merge.

La compactación de la lista de funcionarios es `safe_local_ui`: reduce el espaciado y
presenta las acciones existentes como iconos en una fila, con nombre accesible, tooltip
y foco visible. Compacta el formulario de modificación con campos y botones alineados
en escritorio y apilados en pantallas pequeñas. Conserva handlers, confirmaciones,
bloqueos y permisos. Verificar
`ci:inner-loop`, build y la tabla en escritorio/pantalla estrecha, incluida navegación
por teclado, además de revisión independiente y CI del head final antes del merge.

Las correcciones visuales del censo y Moa del 20 octubre 2026 son `safe_local_ui`: eliminan
fechas/etiquetas de procedencia de las celdas, ocultan el tipo de cama en traslados y simplifican
los controles decorativos de Moa con selección aleatoria por pulsación. No cambian datos,
metadata clínica, sincronización, contratos ni handlers de movimientos. Validar `ci:inner-loop`,
pruebas focalizadas, build/budget y preview de carryover, traslados y Moa (catálogo/local,
recarga, teclado y movimiento reducido), además de revisión independiente y CI del head final.

1. Clasificar la change según `scripts/config/sustainable-change-policy.json`.
2. Actualizar tests unitarios e integración afectados por la change.
3. Si la change es upgrade o excepción, documentar owner, riesgo, rollback y criterio de cierre.
4. Revisar si la change toca reglas clínicas de fecha/turno, sync o identidad paciente.
5. Seleccionar el gate según el alcance y la política; ver [Selección local del gate](#selección-local-del-gate).
6. No ejecutar por separado tipos/calidad si ya están incluidos en ese gate.
7. Ejecutar el gate elegido:
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

### Aceptación temporal de braces (2026-10-07)

Excepción autorizada explícitamente por Daniel Opazo, limitada al aviso y árbol
de desarrollo aprobados. Daniel retiró explícitamente el vencimiento el 12-10-2026
para esperar una actualización oficial de braces. Se conservan
los hallazgos originales y un aviso visible; otros riesgos siguen bloqueando.
Owner, riesgo residual, rollback y validación: [registro de aceptación](BRACES_TEMPORARY_RISK_ACCEPTANCE.md).
