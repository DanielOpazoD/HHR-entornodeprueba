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
- Un transporte simulado no demuestra idempotencia del servidor, seguridad de
  Firestore ni recuperación de una escritura remota cuya respuesta se perdió.
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
