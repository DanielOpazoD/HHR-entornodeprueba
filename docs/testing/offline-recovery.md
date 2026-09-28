# Evidencia de recuperación offline

## Alcance del primer PR del bloque A

`offlineQueueRecovery.test.ts` reemplaza `pwaOffline.test.ts`. La suite anterior
comprobaba ejemplos de almacenamiento, colas y políticas definidos dentro del propio
test. Sus 13 casos no ejecutaban la cola, el service worker ni la política de conflictos
de la aplicación. Por eso no se conserva su conteo como indicador de cobertura.

La suite nueva integra `createSyncQueueEngine`, `createDexieSyncQueueStore` y sus
políticas reales. Usa `fake-indexeddb` como sustituto de la API del navegador y un
transporte remoto controlado. Cierra y vuelve a abrir la conexión, crea un motor nuevo
y comprueba el registro y la tarea persistidos, no sólo la respuesta del método.

## Contratos verificados

| Escenario                        | Resultado exigido                                                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edición offline y nueva conexión | Registro y tarea sobreviven; el transporte recibe el contrato original; la tarea desaparece tras confirmación y no se reenvía en el siguiente arranque del motor. |
| Fallo transitorio del transporte | La tarea sigue pendiente con su identidad y plazo de reintento; un motor nuevo respeta ese plazo y puede completarla después.                                     |
| Motor de otro usuario            | No despacha ni elimina la tarea del propietario original.                                                                                                         |
| Fallo de escritura de la tarea   | La transacción revierte también el cambio del registro; el estado anterior sigue disponible tras reabrir la conexión.                                             |

Se comprobó la sensibilidad con cuatro sustituciones temporales del adaptador:
omitir la eliminación tras confirmar, adelantar la selección de tareas, forzar un
propietario incorrecto y escribir el registro fuera de la transacción. Cada sustitución
hizo fallar el escenario correspondiente. No forman parte del código publicado.

## Límites y cobertura relacionada

- Reabrir IndexedDB no equivale a recargar una página ni reiniciar Chrome.
- Un transporte simulado no demuestra idempotencia del servidor ni seguridad de
  Firestore. La secuencia de respuesta perdida se cubre por separado abajo, con
  lecturas reales del emulador y una callable controlada.
- Los contratos del caché PWA se verifican en `src/tests/build/pwaPrecachePolicy.test.ts`;
  la actualización de un service worker real requiere validación de navegador.
- `src/tests/services/storage/localPersistenceService.test.ts` y
  `src/tests/services/storage/localPersistenceRuntimeSnapshot.test.ts` ejercitan el
  almacenamiento local de la aplicación.
- `src/tests/services/storage/syncQueueMutationConflict.test.ts` y las suites del
  emulador cubren otras partes de la recuperación; no se sustituyen por esta suite.

El bloque A continúa con las combinaciones de recuperación que falten y con la
validación de actualización de extensión/aplicación. Antes de añadir casos se revisa
la cobertura existente, incluidos los scripts de smoke de actualización de extensión.

## Ejecución focalizada

```sh
npx vitest run src/tests/integration/offlineQueueRecovery.test.ts
```

Este cambio modifica pruebas y documentación; no altera el comportamiento clínico
ni el almacenamiento de producción. Su reversión es revertir el PR.

## Segundo PR: respuesta perdida y recuperación combinada

`src/tests/emulator/sync-lost-ack-recovery.emulator.test.ts` conecta el motor y el
adaptador IndexedDB reales con `createFirestoreSyncTransport` y Firestore Emulator.
La callable es el punto de inyección: persiste un documento sintético en el emulador
y rechaza la respuesta como `unavailable`. No se simulan las decisiones de la cola,
la detección de mutaciones ya aplicadas ni el control de conflictos.

| Secuencia                                                                      | Resultado exigido                                                                                                                               |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| El servidor conserva la mutación, se pierde la respuesta y se reabre IndexedDB | Se conserva el plazo y la identidad de la tarea; la lectura remota permite retirarla sin volver a publicar. El documento remoto queda idéntico. |
| Otro escritor modifica el mismo campo antes del reintento                      | La tarea queda en `CONFLICT`, con su contenido local disponible; el reintento no publica ni sobrescribe el documento remoto más reciente.       |
| El primer intento falla antes de guardar                                       | La ausencia del documento no se confunde con una confirmación: el motor publica al reintentar y sólo entonces retira la tarea.                  |

Como controles negativos, desactivar temporalmente el reconocimiento de la mutación
y el bloqueo de campos superpuestos hace fallar sus respectivos casos. Esas
modificaciones no se incluyen en el PR.

Límites: esta suite verifica la recuperación del cliente con persistencia remota
real en el emulador, no la implementación transaccional de la callable ni un reinicio
del navegador. El caso de otro escritor exige conservar el conflicto, no resolverlo
automáticamente. Tampoco acredita la convergencia de la interfaz si el servidor
normalizó el registro; ese contrato requiere sus propias pruebas de readback.

Con el emulador activo:

```sh
RUN_FIRESTORE_EMULATOR_TESTS=1 npx vitest run -c vitest.emulator.config.ts src/tests/emulator/sync-lost-ack-recovery.emulator.test.ts
```

`npm run test:emulator:sync:ci` inicia un emulador y ejecuta las suites de sync y UI,
incluida esta prueba. Para este cambio exclusivamente de tests/documentación se usa
`ci:pre-merge` más ese gate de emulador; no se modifican reglas ni código de producción.

## Tercer PR: actualización de extensión durante una lectura

`npm run test:e2e:rayen-extension-upgrade` amplía el smoke de Chromium existente.
Compila `requestPatientClinicalBundle` y su canal real desde el código de HHR;
no reproduce los temporizadores ni la correlación de respuestas dentro de la prueba.

La secuencia retiene en `fetch` las tres fuentes clínicas de la extensión 0.48.33,
comprueba que la solicitud sigue pendiente y reemplaza el paquete por la versión
actual mediante el botón de recarga de `chrome://extensions`. Las pestañas conservan
sus documentos. La lectura interrumpida debe terminar con error en las tres fuentes,
no con un paquete vacío presentado como éxito.

Después inicia un reintento explícito, también retenido en las tres fuentes. Una
respuesta tardía con el identificador anterior no puede resolver la solicitud nueva.
Sólo al liberar las respuestas del nuevo worker se acepta el paquete del reintento.
Se comprueba una petición nueva y una lectura por fuente, además de la recuperación
de los relays, la identidad de la extensión y la ausencia de barras duplicadas que
ya verificaba el smoke.

Los controles negativos eliminan temporalmente la comparación de `reqId` o el error
de una fuente interrumpida; cada modificación debe hacer fallar su aserción específica.
No forman parte del código publicado.

Límites: Chromium usa un perfil temporal y páginas/backend sintéticos. Se monta el
cliente de lectura y se declara su capability en el fixture; no se monta la aplicación
completa ni se acredita su indicador visual de sincronización, persistencia clínica,
la descarga desde Chrome Web Store o la reanudación automática de una escritura.
Los `fetch` controlados sólo sirven de barrera en el test y no añaden estado al worker
de producción. El plazo de fallo del cliente conserva la política real de HHR.

La prueba ya forma parte del job `e2e-critical` de CI. Este PR no cambia el paquete,
la versión ni los permisos de la extensión instalada.
