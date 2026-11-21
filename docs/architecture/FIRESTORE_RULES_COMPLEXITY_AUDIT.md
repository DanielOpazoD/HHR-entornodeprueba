# Firestore Rules Complexity Audit

Fecha: 2026-04-12
Estado: `P1-02` cerrado con limitación conocida del emulador; el hotspot principal quedó reducido y validado
Owner sugerido: seguridad / repositorios / runtime

> Noviembre de 2026: el camino del especialista y la firma médica que describe este documento
> se retiraron junto con la entrega médica antigua. Los fragmentos `10-`, `11-` y
> `12-specialist-*` ya no existen y los roles médicos no escriben `dailyRecords`. Lo que
> sigue es historia.

## Objetivo

Bajar el riesgo operativo de `firestore.rules` sin abrir una reescritura completa.

## Señales observadas

- El archivo tiene 731 líneas y concentra demasiada lógica en un solo boundary.
- El emulador ya mostró errores por límite de evaluación en updates críticos.
- La resolución de roles dinámicos (`config/roles`) se usa muchas veces en cascada.
- El path de `dailyRecords.update` es el más sensible porque mezcla:
  - ventana temporal de edición
  - permisos por rol
  - firma médica
  - escritura especialista estructurada y por cama

## Hotspots priorizados

1. Resolución de acceso clínico y edición
   Archivos: `firestore.rules`, helpers `isAdmin/isNurse/isDoctor/...`
   Riesgo: recalcular roles en cascada encarece cada evaluación.

2. `isSpecialistMedicalHandoffUpdate`
   Archivo: `firestore.rules`
   Riesgo: cadena larga de camas permitidas y checks estructurales profundos.

3. `getConfiguredRole`
   Archivo: `firestore.rules`
   Riesgo: depende de `config/roles` y hoy participa de múltiples caminos de acceso.

4. `isValidSystemHealthWrite`
   Archivo: `firestore.rules`
   Riesgo: payload guard extenso; no es el path más caliente, pero sí costoso.

## Iteración 1 ejecutada

Se consolidó la resolución de roles para evitar cascadas innecesarias en:

- `canReadClinicalData`
- `canEdit`
- `canReportSystemHealth`
- `canManageCensusAccess`
- helpers `isAdmin/isNurse/isDoctor/isDoctorSpecialist/isEditorRole/isGeneralViewer`

La mejora busca bajar el costo de evaluación sin cambiar la semántica de permisos.

## Resultado de la validación

- `bash scripts/run-firestore-rules-ci.sh`: verde (`76` tests).
- `npm run test:emulator:sync:ci`: verde (`4` tests sync + `3` UI).
- Aun así, el emulador sigue registrando el error de límite de evaluación en el caso
  denegado de `dailyRecords.update` sobre documento faltante.

Conclusión: la iteración 1 mejoró el hot path de resolución de acceso, pero no resuelve
todavía el hotspot estructural principal.

## Iteración 2 ejecutada

Se intentó bajar el costo específico de `dailyRecords.update` con dos cambios controlados:

- se agregó una guarda `hasPersistedDailyRecord()` para evitar tratar documentos inexistentes como candidatos válidos a `update`
- se consolidó la decisión de `dailyRecords.update` en `canUpdateDailyRecord()`, resolviendo `getEffectiveRole()` una sola vez y separando `isSpecialistMedicalHandoffPayload()` del chequeo de rol especialista

La mejora mantuvo la semántica de permisos y dejó verdes las suites funcionales, pero no eliminó el límite de expresiones del emulador en el caso denegado de `partial update` sobre documento faltante.

## Resultado de la validación de la iteración 2

- `bash scripts/run-firestore-rules-ci.sh`: verde (`76` tests).
- `npm run test:emulator:sync:ci`: verde (`4` tests sync + `3` UI).
- El emulador sigue registrando `maximum of 1000 expressions to evaluate` en `dailyRecords.update` para el caso denegado de `sync-concurrency.emulator.test.ts`.

Conclusión: la iteración 2 mejoró la claridad y redujo recomputación de roles en el hot path, pero el costo dominante sigue concentrado en el payload path de especialista y/o en la resolución dinámica de `config/roles`.

## Iteración 3 ejecutada

Se reescribió `dailyRecords.update` para que la decisión de escritura quede segmentada por rol:

- `allow update` ahora delega en `canUpdateDailyRecord()`
- la rama de enfermería usa `request.resource.data` y exige `dateTimestamp` explícito antes de abrir la ventana temporal
- las ramas de médico urgencia y especialista solo tocan `resource` cuando el rol realmente corresponde

Además, se probó una simplificación de `getConfiguredRole()` para evitar `exists + get`, pero se descartó en la misma iteración porque introdujo `Service call error` en el emulador cuando `config/roles` no existía. El repo quedó con la versión estable previa de ese helper.

## Resultado de la validación de la iteración 3

- `bash scripts/run-firestore-rules-ci.sh`: verde (`76` tests).
- `npm run test:emulator:sync:ci`: verde (`4` tests sync + `3` UI).
- El caso denegado de `partial update` sobre documento faltante ya no dispara `maximum of 1000 expressions to evaluate`.
- El emulador sigue reportando un `evaluation error` localizado en `allow update: if canUpdateDailyRecord()` para ese mismo caso denegado.

Conclusión: la severidad bajó. El hotspot ya no agota el presupuesto del evaluador, pero todavía no produce un rechazo completamente limpio en el caso de `update` sobre documento inexistente.

## Riesgos que siguen abiertos

- `isSpecialistMedicalHandoffUpdate` sigue siendo el hotspot más complejo del archivo.
- `getConfiguredRole` todavía usa un patrón caro (`exists` + `get`) y conviene revisarlo con cuidado.
- `dailyRecords.update` ya tiene mejor factoring, pero el caso denegado por documento faltante sigue atravesando suficiente lógica como para agotar el presupuesto del evaluador.
- El caso denegado de `partial update` sobre documento faltante ahora cae en `evaluation error` localizado, no en límite global de expresiones; sigue siendo deuda, aunque más acotada.
- La política de bootstrap admins ya quedó revisada y documentada como excepción temporal de recuperación; sigue pendiente su retiro futuro, pero no su inventario ni justificación.

## Iteración 4 ejecutada

Se hizo un recorte estructural pequeño sobre el path especialista y el gating de `update`:

- `isSpecialistMedicalHandoffPayload()` ahora calcula una sola vez el caso `una sola cama permitida afectada`, evitando repetir `size + hasOnly` dentro de cada OR por cama
- `dailyRecords.update` pasó a negar con `exists(...)` antes de entrar a `canUpdatePersistedDailyRecord()`, para intentar cortar temprano el caso de `update` sobre documento inexistente

El árbol final mantiene semántica de permisos y deja verdes las suites funcionales, pero el residuo del emulador no desapareció: el caso denegado de `partial update` sobre documento faltante sigue cayendo en `evaluation error` localizado en `allow update`.

## Resultado de la validación de la iteración 4

- `bash scripts/run-firestore-rules-ci.sh`: verde (`76` tests).
- `npm run test:emulator:sync:ci`: verde (`4` tests sync + `3` UI).
- El emulador sigue reportando `evaluation error` en `dailyRecords.update` para el caso denegado de documento inexistente.

Conclusión: la iteración 4 mejora factoring y deja menos duplicación estructural en el path especialista, pero no resuelve todavía el borde del evaluador en el `update` denegado sobre documento ausente.

## Iteración 5 ejecutada

Se corrigió un desvío introducido en la iteración previa dentro del path especialista:

- `isSpecialistMedicalHandoffPayload()` volvió a usar `isOnlySpecialistAffectedBed(...)` para la rama de cama única
- con eso, el evaluador vuelve a hacer `size + hasOnly([bedId])` antes de tocar `isValidSpecialistMedicalBedUpdate(bedId)`, evitando diffs profundos sobre camas no afectadas

Este ajuste no cambia permisos ni contratos; corrige el costo del camino de validación para que solo la cama realmente afectada entre al chequeo profundo.

## Resultado de la validación de la iteración 5

- `bash scripts/run-firestore-rules-ci.sh`: verde (`76` tests).
- `npm run test:emulator:sync:ci`: verde (`4` tests sync + `3` UI).
- El caso denegado de `partial update` sobre documento faltante sigue cayendo en `evaluation error`, pero el path de especialista recupera una forma de evaluación más barata que la variante anterior.

Conclusión: la iteración 5 sí mejora el hotspot principal del especialista, aunque el residuo del `update` sobre documento inexistente sigue abierto como deuda separada del emulador.

## Iteración 6 ejecutada

Se recortó el caso profundo de `clinicalCrib` en el path especialista:

- `isValidSpecialistMedicalBedUpdate(bedId)` ahora separa explícitamente el caso de handoff médico del paciente principal y el caso exclusivo de `clinicalCrib`
- el update del `clinicalCrib` solo se acepta cuando la cama afecta exclusivamente la clave `clinicalCrib`, y luego valida solo `medicalHandoffEntries`, `medicalHandoffNote`, `medicalHandoffAudit` y `clinicalEvents` dentro de ese subdocumento
- se agregaron dos regresiones de reglas:
  - especialista puede persistir handoff médico acotado sobre `beds.R1.clinicalCrib.*`
  - especialista no puede tocar campos no permitidos del `clinicalCrib`, como `patientName`

Este corte vuelve la regla más estricta y reduce el trabajo del evaluador cuando el patch corresponde al RN clínico.

## Resultado de la validación de la iteración 6

- `bash scripts/run-firestore-rules-ci.sh`: verde (`78` tests).
- `npm run test:emulator:sync:ci`: verde (`4` tests sync + `3` UI).
- El residuo del emulador sobre `update` a documento inexistente sigue igual, pero el path especialista para `clinicalCrib` quedó mejor delimitado y cubierto.

Conclusión: la iteración 6 mejora mantenibilidad, reduce ambigüedad en el path `clinicalCrib` y sube cobertura de seguridad sin cambiar el contrato productivo.

## Cierre de `P1-02`

Decisión tomada el `2026-04-12`:

- se da por cerrado `P1-02` a nivel de mejora estructural y reducción de riesgo
- el residuo restante se clasifica como **limitación conocida del emulador** en el caso denegado de `update` sobre documento inexistente
- no se seguirá iterando a ciegas sobre ese borde mientras:
  - la denegación siga siendo correcta (`permission-denied`)
  - `bash scripts/run-firestore-rules-ci.sh` permanezca verde
  - `npm run test:emulator:sync:ci` permanezca verde
  - el write path productivo del especialista siga pasando por callable y no por write directo a reglas

Justificación técnica:

- el problema grave original (`maximum of 1000 expressions to evaluate`) ya fue eliminado
- el residuo actual no habilita escrituras indebidas ni rompe el contrato funcional; el documento inexistente sigue siendo rechazado
- después de varias iteraciones, el `evaluation error` quedó aislado al borde denegado del emulador y no mostró impacto productivo adicional
- seguir iterando sobre ese caso sin nueva evidencia probablemente tendría retorno bajo y riesgo innecesario

Seguimiento:

- si aparece evidencia de impacto productivo real, o si el write path vuelve a depender de reglas para especialista, este frente debe reabrirse
- hasta entonces, el siguiente valor técnico está en `P1-03`, `P1-04` y `P1-05`

## Próximas iteraciones recomendadas

1. Pasar a `P1-03`: revisar bootstrap admins y excepciones legacy de seguridad.
2. Abrir `P1-04`: reducir complejidad del write path de `dailyRecord`.
3. Abrir `P1-05`: consolidar golden path de lectura/sync.

## Iteración 7 ejecutada

Se abrió un frente nuevo y de bajo riesgo sobre el guard de `systemHealth`:

- se agregaron helpers reutilizables `isOptionalString(...)`, `isOptionalBool(...)`, `isOptionalBoundedInt(...)` e `isOptionalEnum(...)`
- `isValidSystemHealthWrite(userId)` pasó a reutilizar esos helpers para validar escalares opcionales, contadores acotados y enums operativos
- no se cambiaron keys permitidas, rangos ni semántica de permisos; el recorte fue estructural y orientado a bajar repetición/costo de mantenimiento

## Resultado de la validación de la iteración 7

- `bash scripts/run-firestore-rules-ci.sh`: verde (`81` tests).

Conclusión: el archivo sigue siendo grande, pero `systemHealth` ya dejó de ser un bloque de validación repetitivo difícil de extender. Este frente tiene buen retorno estructural y riesgo funcional bajo.

## Iteración 8 ejecutada

Se hizo otro recorte quirúrgico sobre el handoff estructurado de especialista:

- se agregó `hasOnlySpecialistStructuredRecordKeys(...)` para centralizar la lista de keys permitidas en el payload estructurado
- se agregó `isOnlyAffectedSpecialistStructuredSpecialty(...)` para evitar repetir `size == 1 + hasOnly + isValid...` por cada especialidad
- `isSpecialistStructuredMedicalHandoffUpdate()` quedó más corto y con menos duplicación visible, sin cambiar permisos ni el contrato del path especialista

## Resultado de la validación de la iteración 8

- `bash scripts/run-firestore-rules-ci.sh`: verde (`81` tests).

Conclusión: `firestore.rules` sigue siendo un boundary grande, pero el subpath estructurado del especialista quedó más fácil de auditar y menos propenso a volver a crecer con ORs repetidos.

## Iteración 9 ejecutada

Se hizo un recorte adicional sobre el path estructurado de especialista:

- se agregó `isAllowedSpecialistStructuredSpecialty(...)` para centralizar el allowlist de especialidades válidas
- `isOnlyAffectedSpecialistStructuredSpecialty(...)` ahora reutiliza ese allowlist
- `isSpecialistStructuredMedicalHandoffUpdate()` mantiene el OR por especialidad permitida, pero deja el allowlist centralizado en un helper para evitar que la validación profunda vuelva a crecer con strings duplicados fuera de un solo punto

## Resultado de la validación de la iteración 9

- `bash scripts/run-firestore-rules-ci.sh`: verde (`81` tests).

Conclusión: el path estructurado del especialista sigue mejorando con cortes pequeños y auditables, sin reabrir una reescritura del archivo completo.

## Iteración 10 ejecutada

Se hizo un recorte adicional sobre el mismo path estructurado de especialista:

- se agregó `isAnyAllowedSpecialistStructuredSpecialtyAffected(...)` para concentrar en un solo helper el OR de especialidades permitidas
- `isSpecialistStructuredMedicalHandoffUpdate()` ahora delega esa comprobación y deja menos ruido repetido en el guard principal

## Resultado de la validación de la iteración 10

- `bash scripts/run-firestore-rules-ci.sh`: verde (`81` tests).

Conclusión: la validación estructurada de especialista sigue convergiendo hacia helpers auditables sin alterar permisos ni forzar una reescritura de `firestore.rules`.

## Iteración 11 ejecutada

Se hizo otro recorte pequeño en el mismo boundary de especialista:

- se agregó `isAnySpecialistAffectedBed(...)` para concentrar en un único helper el OR largo de camas permitidas para edición especialista
- `isSpecialistMedicalHandoffPayload()` ahora delega esa comprobación, dejando el guard principal más corto y más fácil de auditar

## Resultado de la validación de la iteración 11

- `bash scripts/run-firestore-rules-ci.sh`: verde (`81` tests).

Conclusión: el path de especialista sigue bajando duplicación visible con helpers locales y verificables, sin mover lógica fuera de `firestore.rules` ni alterar la semántica del permiso.

## Iteración 12 ejecutada

Se compactó otro guard pequeño del payload especialista:

- se agregó `hasOnlySpecialistMedicalHandoffRecordKeys(...)` para encapsular en un helper la combinación entre keys de camas y keys estructuradas del handoff especialista
- `isSpecialistMedicalHandoffPayload()` ahora delega ese allowlist de keys y deja el guard principal un poco más legible

## Resultado de la validación de la iteración 12

- `bash scripts/run-firestore-rules-ci.sh`: verde (`81` tests).

Conclusión: sigue bajando la repetición del boundary de especialista con cortes locales y verificables, manteniendo intacta la semántica de acceso.

## Iteración 13 ejecutada

Se aisló otro guard temporal del mismo boundary:

- se agregó `isWithinSpecialistMedicalHandoffWindow(...)` para encapsular la ventana de escritura de 24 horas del handoff especialista
- `isSpecialistMedicalHandoffPayload()` ya no recompone inline la lógica temporal y mantiene el resto del guard principal más concentrado

## Resultado de la validación de la iteración 13

- `bash scripts/run-firestore-rules-ci.sh`: verde (`81` tests).

Conclusión: el boundary especialista sigue ganando legibilidad local con helpers de una sola responsabilidad, sin alterar permisos ni abrir una reescritura riesgosa.

## Iteración 14 ejecutada

Se hizo un corte editorial del frente especialista para bajar costo de revisión sin tocar semántica:

- el antiguo bloque `10-specialist-medical-handoff-helpers.rules` se dividió en tres fragmentos editables:
  - `10-specialist-bed-update-helpers.rules`
  - `11-specialist-structured-handoff-helpers.rules`
  - `12-specialist-handoff-boundary-helpers.rules`
- el orden de concatenación se actualizó en `scripts/rulesSourceSupport.mjs`
- durante la exploración se probó un micro-refactor sobre helpers locales del path especialista, pero no se conservó como objetivo principal porque no mejoró la señal real del emulador; el valor retenido del lote es la separación editorial del boundary

## Resultado de la validación de la iteración 14

- `bash scripts/run-firestore-rules-ci.sh`: verde (`102` tests).
- `npm run test:emulator:sync:ci`: verde (`4` tests sync + `3` UI).
- `npm run check:quality`: verde.
- El caso denegado de `partial update` sobre documento faltante sigue mostrando `maximum of 1000 expressions to evaluate` en el emulador, aunque la denegación continúa siendo correcta (`permission-denied`).

Conclusión: esta iteración sí mejora auditabilidad y tamaño de review del hotspot especialista, pero no reduce todavía el costo profundo del evaluador en `dailyRecords.update`. El siguiente retorno real no está en agregar más helpers cosméticos dentro del mismo path, sino en atacar explícitamente el caso denegado sobre documento inexistente desde el gating de `dailyRecords.update`.

## Iteración 15 ejecutada

Se atacó de frente el caso denegado sobre `dailyRecords.update` cuando el documento persistido no existe:

- se agregó `hasPersistedDailyRecordResource()` en `30-daily-record-write-helpers.rules` para cortar antes si `resource` no está cargado
- `canUpdatePersistedDailyRecord()` dejó de delegar en un helper con OR largos y ahora hace un branching corto por rol solo después de confirmar que existe `resource.data`
- el `match /dailyRecords/{date}` en `40-hospitals.rules` dejó de duplicar un `exists(...)` externo; el gating quedó concentrado dentro de `canUpdatePersistedDailyRecord()`

## Resultado de la validación de la iteración 15

- `node scripts/check-rules-generated.mjs`: verde.
- `bash scripts/run-firestore-rules-ci.sh`: verde (`102` tests).
- `npm run test:emulator:sync:ci`: verde (`4` tests sync + `3` UI).
- `npm run check:quality`: verde.
- El caso denegado de `partial update` sobre documento faltante dejó de caer en `maximum of 1000 expressions to evaluate` y volvió al nivel anterior de `evaluation error`, manteniendo la denegación correcta (`permission-denied`).

Conclusión: este sí fue un corte de complejidad semántica útil. No reescribe permisos ni simplifica artificialmente `firestore.rules`, pero reduce trabajo inútil del evaluador en el caso denegado más costoso y deja mejor encapsulado el gating de `dailyRecords.update`.

## Iteración 16 ejecutada

Se hizo el siguiente corte útil sobre el path especialista, ya con el caso denegado estabilizado:

- `isSpecialistMedicalHandoffPayload()` dejó de calcular siempre los diffs de `beds` y de recorrer ambos subpaths a la vez
- el boundary ahora enruta temprano según el allowlist top-level:
  - payload estructurado por especialidad
  - payload bed-scoped
  - cualquier mezcla entre ambos cae a `false` sin seguir profundizando
- `isSpecialistStructuredMedicalHandoffUpdate(...)` dejó de recomputar el diff top-level y ahora recibe solo el subconjunto que realmente necesita validar

Además se agregó una prueba explícita para congelar ese contrato:

- rechazo de payload mixto `medicalHandoffBySpecialty + beds.*` en la suite de reglas

## Resultado de la validación de la iteración 16

- `bash scripts/run-firestore-rules-ci.sh`: verde (`103` tests).
- `npm run test:emulator:sync:ci`: verde (`4` tests sync + `3` UI).
- `npm run check:quality`: verde.
- El caso denegado sobre documento inexistente sigue en `evaluation error`, sin volver a `maximum of 1000 expressions to evaluate`.

Conclusión: esta fue la última iteración de complejidad estructural con retorno claro en el frente especialista. A partir de aquí, el valor ya no está en seguir partiendo helpers, sino en mantener cobertura dirigida y evitar que el boundary vuelva a mezclar payloads o recomputar diffs innecesarios.

## Iteración 17 ejecutada

Se hizo una revisión enfocada del boundary especialista sin abrir una reescritura de reglas:

- se congeló por test que un especialista puede reparar `dateTimestamp` faltante durante un handoff válido
- se agregó una regresión que bloquea alterar un `dateTimestamp` ya existente como efecto colateral de un handoff especialista
- `hasValidSpecialistRecordTimestampChange(...)` concentra esa política en `12-specialist-handoff-boundary-helpers.rules`

La prueba falló primero contra la regla vigente: el emulador permitía cambiar un timestamp persistido a otro valor todavía dentro de la ventana clínica. La corrección mantiene el flujo legacy de reparación, pero bloquea mutación de timestamp en registros ya hidratados.

## Resultado de la validación de la iteración 17

- `bash scripts/run-firestore-rules-ci.sh`: verde (`105` tests).

Conclusión: el valor aquí no es reducir líneas, sino bajar riesgo clínico-operacional en un campo que define la pertenencia temporal del registro diario.
