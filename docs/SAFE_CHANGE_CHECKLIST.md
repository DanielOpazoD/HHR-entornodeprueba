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

### Cerrar con la evidencia de CI

La validación de GitHub del SHA final es la evidencia normal de cierre. No se exige
una segunda ejecución local de los controles que CI ya aprobó. Antes del merge:

1. Comprobar que el head de la PR coincide con el SHA de la ejecución aprobada,
   que `ci-summary` está en verde y que la rama está al día y se puede mergear.
2. Verificar que el alcance seleccionado por CI cubre el cambio y los controles
   requeridos. Registrar el enlace al run y a los jobs o artefactos pertinentes;
   un job omitido no acredita un control y un informe de otro SHA no sirve.
3. Ejecutar sólo las comprobaciones específicas que CI no cubra: una regresión
   nueva, un entorno particular o una validación de release expresamente requerida.
   Una revisión pendiente o un defecto reproducible sigue bloqueando el merge.

Durante la edición, las pruebas locales sirven para reproducir y corregir problemas.
Conservar los fallos y su diagnóstico; CI verde no permite ocultar un fallo conocido.
Un fallo local no reproducido se documenta con su contraste y sus límites: no obliga
a repetir toda la matriz local ni se presenta como una ejecución local aprobada.
Si cambia el código, revalidar lo afectado y esperar CI del nuevo SHA.

### Cobertura requerida y comandos disponibles

`package.json` define las etapas ejecutadas; la política de
`scripts/config/sustainable-change-policy.json` conserva los requisitos adicionales
por tipo de cambio. Sus `requiredGates` describen la cobertura requerida, no una
obligación de ejecutarla otra vez localmente. Esta tabla orienta la selección.

| Alcance                                                            | Cobertura requerida; CI puede acreditarla                                                |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Solo documentación operativa, sin scripts, código ni configuración | `check:docs-drift` y `check:operational-runbooks`; comprobar enlaces y comandos editados |
| Código habitual                                                    | `ci:pre-merge`                                                                           |
| Runtime clínico, auth, storage, bundle o contratos de arquitectura | `ci:merge-gate` y controles adicionales exigidos por la política                         |
| Release o reglas persistentes                                      | `ci:release-gate` y controles adicionales exigidos por la política                       |

`npm run ci:close` queda disponible para validar localmente la unión de
`ci:merge-gate` y `test:release-confidence` cuando haga falta, no como requisito
adicional a CI aprobado. El runner conserva sus etapas y argumentos, evita comandos
idénticos y no reutiliza resultados de otra ejecución. Un fallo, interrupción o cambio
de entradas invalida esa corrida local; no invalida por sí solo evidencia independiente
de CI del mismo SHA. No sustituye los controles de `ci:release-gate` ni el perfil `full`
que no estén cubiertos por CI. Los informes generados pueden actualizarse.

Durante edición bastan pruebas focalizadas para obtener feedback; no acreditan
el cierre. `ci:inner-loop` sirve para iterar y para los cambios locales de UI que
la política clasifica expresamente como `safe_local_ui`.

El acceso a actas de farmacia desde Documentos Clínicos es `architecture_contracts`:
declara la dependencia unidireccional hacia la API pública de la biblioteca para
componer dos accesos en el panel lateral. Reutiliza editor, confirmación de salida
y PDF existentes. No cambia permisos, autorrelleno, persistencia clínica, catálogo
ni exportación. Verificar `ci:merge-gate` (incluye calidad completa y build/budgets),
el módulo de documentos clínicos y navegador: ambas actas desde Documentos Clínicos,
foco al volver, Escape sin cerrar el documento y conservación del acta al cancelar
su descarte. Exige revisión independiente y CI del head definitivo antes del merge.

No encadenar gates completos: `ci:release-gate` contiene `ci:merge-gate`, que
contiene `ci:pre-merge`. Un check fallido sigue pendiente aunque el resto pase.
El CI del SHA final y la revisión independiente deben aprobarse antes del merge.
La clasificación remota `docs-only` se decide en CI; no forzar ni omitir checks.

### Checklist de cierre

La simplificación del Centro HHR de Eloísa elimina las superficies de Turno, Vitales y
Scores, incluido Reg + BRADEN, y conserva Recetas/Indicaciones, Laboratorio, Imágenes y
Sesión. Verificar inicio, navegación, barra flotante, fuentes y ZIP sin owners retirados;
acceso a HHR, foco/cierre, cambio de paciente, impresión y presentación móvil. Las emisiones
ISO de farmacia sin offset se interpretan como UTC y se presentan con `Pacific/Easter`:
probar verano/invierno, offsets explícitos, fecha calendario y consistencia de pantalla/PDF
(TIME-02). Exige release gate de extensión, pruebas afectadas, revisión independiente y CI
del SHA final; las protecciones persistentes y el puente clínico de HHR mantienen su contrato.

El feedback de descarga de egreso, el contexto/orden del menú de movimientos,
los valores ausentes explícitos y los controles equivalentes son `safe_local_ui`.
Reutilizan estados y datos disponibles. Verificar descarga pendiente, fallo y
reintento; contexto y callbacks del paciente correcto; vacíos sin mutar registros;
altura de controles, foco y encaje con puntero normal/táctil, impresión y movimiento
reducido. Validar pruebas focalizadas, build/budgets, revisión independiente y CI
del SHA final. No ampliar límites para financiar la presentación.

La respuesta visual del acceso, la apertura completa del menú de usuario y la
alineación de altas/traslados del 29 octubre 2026 son `safe_local_ui`: conservan
handlers, permisos, datos clínicos y fechas. Validar envío pendiente/error/reintento,
primera apertura del menú, columnas equivalentes con textos de distinta longitud,
scroll con teclado en móvil, impresión y movimiento reducido. Exigen pruebas
focalizadas, build/budgets sin ampliar límites, revisión independiente y CI del head final.

La comprobación previa de Eloísa, las lecturas clínicas frescas por captura y la
configuración del gesto manual de especialidad son `critical_runtime`. Verificar
el bloqueo sin nueva ejecución cuando falta una fuente y conservar el fallo real
posterior al inicio. Comprobar captura consecutiva con diagnóstico/código distintos,
cama y cuna bajo los contextos Netlify, paquete de extensión y actualización desde
la versión anterior. Exige `ci:merge-gate`, `test:release-confidence`, scorecard vigente,
revisión independiente y CI del head final; conservar permisos y autoridad clínica.

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
5. Verificar la evidencia de CI y completar sólo lo no cubierto; ver [Cobertura requerida y comandos disponibles](#cobertura-requerida-y-comandos-disponibles).
6. No repetir tipos/calidad ni otros controles ya acreditados por CI del SHA final.
7. Si falta evidencia, ejecutar sólo el control necesario. Los gates locales
   `ci:inner-loop`, `ci:pre-merge`, `ci:merge-gate` y `ci:release-gate` siguen disponibles.
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
18. Si la policy lo exige, verificar `reports/release-readiness-scorecard.md` del run vigente; regenerarlo sólo si falta evidencia válida.
19. Si la change toca `daily-record/sync`, revisar [docs/ADR_DAILY_RECORD_RUNTIME_PATH.md](./ADR_DAILY_RECORD_RUNTIME_PATH.md).
20. Si la change toca auth runtime, revisar [docs/ADR_AUTH_RUNTIME_RECOVERY.md](./ADR_AUTH_RUNTIME_RECOVERY.md).
21. Si la change toca documentos clínicos, revisar [docs/ADR_CLINICAL_DOCUMENT_WORKSPACE_CONTRACT.md](./ADR_CLINICAL_DOCUMENT_WORKSPACE_CONTRACT.md).
22. Si la change toca handoff, revisar [docs/ADR_HANDOFF_RUNTIME_SURFACES.md](./ADR_HANDOFF_RUNTIME_SURFACES.md).

### Aceptación de braces cerrada (2026-10-24)

El aviso fue retirado oficialmente el 23-10-2026 y la auditoría fresca confirmó
su ausencia. Se elimina la aceptación temporal conforme a su criterio de cierre;
raíz y Functions deben aprobar sin excepciones altas/críticas. Las regresiones
del CLI conservan evidencia cruda y prueban rechazo alto/crítico, incluidos futuros
avisos de braces. Fuente, owner e historial: [registro de aceptación](BRACES_TEMPORARY_RISK_ACCEPTANCE.md).

### Validadores y parsers de solicitudes (2026-10-24)

La medición de precache del upgrade se registra en [BUNDLE_RISK_LEDGER.md](BUNDLE_RISK_LEDGER.md):
40 KiB de margen acotado y techo dedicado de 96.000 bytes para Zod. Se mantienen
los 239 archivos offline y todos los demás límites.

Owner: `platform`, con revisión de `storage` y `backup` para los contratos de datos.
Motivo: corregir GHSA-mrhx-c7xc-m3w5 y GHSA-27r3-jxmh-p828.
Targets: Zod 4.6.7, Firebase CLI 15.34.1, body-parser 1.20.9/2.4.0 según su rama
y qs 6.16.1, compatible con el parser actualizado.
Riesgo: alto por el cambio mayor del validador compartido; conservar defaults,
campos opcionales, lectura de días legacy/marcados y validación de respaldos.
Rollback: revertir el cambio completo de dependencias y adaptadores; restaurar
versiones vulnerables vuelve a bloquear la auditoría y no constituye cierre del incidente.
Gates: `typecheck`, `lint`, `ci:release-gate`, `test:release-confidence` y
`check:dependency-vulnerabilities`, con scorecard del commit final.
