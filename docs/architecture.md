# Arquitectura de HHR

Esta guía explica el flujo vigente. La taxonomía y el ownership de carpetas están
centralizados en [Codebase Canon](CODEBASE_CANON.md); las decisiones de cada
subsistema viven en sus ADR, enlazadas desde [Documentation Map](DOCUMENTATION_MAP.md).
`ARCHITECTURE.md` conserva sólo el enlace a esta guía.

## Simplificar antes de añadir

Resolver primero con el módulo dueño y el camino existente. Crear una separación
sólo cuando delimite una responsabilidad, un efecto o un contrato que ya importe.
No es obligatorio añadir controller, caso de uso, port y repositorio a cada función.
Las escrituras clínicas tienen controles propios que sí deben conservarse:
[comandos canónicos](ADR_CANONICAL_WRITE_COMMANDS.md) y
[facades de adopción](ADR_CANONICAL_WRITE_ADOPTION_FACADES.md).

- Eliminar wrappers sin comportamiento y código sin consumidores comprobados.
  La preparación de escrituras importa sus reglas clínicas y metadatos desde los
  módulos dueños; `dailyRecordDomainServices` y `dailyRecordWriteSupport` fueron
  retirados. No recrear esos agregadores internos.
- Los efectos del navegador usan `shared/runtime/browserWindowRuntimeCore`; el
  portapapeles usa `browserClipboardRuntime`. No recrear la fachada agregadora
  `browserWindowRuntime` retirada. Los adaptadores y sus fallbacks permanecen.
- Unificar reglas repetidas en su dueño; evitar utilidades transversales de un solo uso.
- Separar efectos de decisiones cuando permita verificar un comportamiento real.
- Mantener entrypoints públicos acotados. Dentro de una feature, usar sus módulos
  internos; desde otra, usar su API pública existente.
- No reintroducir los barrels retirados de `repositories`, la fachada histórica
  `DailyRecordRepository` ni la capa inactiva `src/infrastructure`.
- La compatibilidad con datos y sesiones históricos es una protección activa.
  No retirarla por antigüedad aparente ni confundirla con código muerto.

Los límites verificables se ejecutan con `npm run check:quality:group -- boundaries`.
La política completa vive en [Quality Guardrails](QUALITY_GUARDRAILS.md).

## Lectura del censo

```text
UI / contexto de día
  -> useDailyRecordQuery y useDailyRecordSyncQuery
  -> query controllers + port dailyRecord inyectado
  -> dailyRecordRepositoryReadService / dailyRecordRepositorySyncService
  -> dailyRecordPersistenceGoldenPath y políticas de consistencia
  -> caché de consulta -> hooks/contextos derivados -> UI
```

`useDailyRecord` compone directamente su contrato público dentro del `useMemo`;
no requiere un constructor que vuelva a copiar el mismo objeto. La validación de
cama de origen y el destino por defecto de la copia viven en
`useDailyRecordCopyActions`, junto a la única operación que los consume.

`useCensusActionsProviderModel` compone los parámetros de los comandos y del
contexto en el mismo hook. `useCensusActionCommandsController` conserva su
`useMemo` y las referencias actuales; no necesita constructores intermedios que
sólo vuelvan a copiar campos. Las reglas y facades de movimientos permanecen.

`dailyRecordReadResultController` proyecta una sola vez los metadatos de consistencia
del golden path. Cada rama conserva el registro y la compatibilidad de su fuente;
una lectura indisponible sigue siendo distinta de una ausencia confirmada.

Firestore es la autoridad remota. IndexedDB conserva persistencia local y la
proyección de cambios pendientes; TanStack Query publica el estado que consume la
interfaz. Son responsabilidades distintas, no tres autoridades intercambiables.

Una lectura remota más antigua o un `null` transitorio no debe borrar una copia
válida o un cambio pendiente. La selección local/remota y la clasificación de
registro ausente pertenecen al repositorio y sus contratos, no a cada componente.
Los estados, precedencia y recuperación se definen en
[Daily Record Runtime Path](ADR_DAILY_RECORD_RUNTIME_PATH.md) y
[Daily Census Truth Contract](ADR_DAILY_CENSUS_TRUTH_CONTRACT.md).

`recordQueryService` consulta calendario e historial local sin cargar Firestore;
la sincronización explícita por rango carga `firestoreRecordQueries` bajo demanda
antes de persistir el resultado localmente. Un calendario local no certifica por
sí solo que se haya leído todo el historial remoto.

## Escritura y sincronización

```text
acción clínica -> hook/comando existente -> port dailyRecord
  -> dailyRecordRepositoryWriteService
  -> validación, concurrencia y autoridad según el tipo de comando
  -> confirmación / proyección local / outbox según su política
  -> caché y suscripción -> UI
```

No existe una regla universal de «guardar primero local y luego remoto».
Los comandos que requieren autoridad remota confirman esa operación antes de
publicar o persistir una propuesta rechazada. Las escrituras locales admitidas
mantienen sus políticas de outbox y recuperación; no se cambian por conveniencia
de un componente. El acknowledgement y el resultado del repositorio deben
conservarse hasta el consumidor.

Las mutaciones optimistas usan `usePatchDailyRecordMutation` y sus controllers.
No se debe interpretar una proyección optimista como confirmación del servidor,
ni añadir un segundo coordinador o una caché paralela para resolver un conflicto.

Eliminar un día entra por el port existente y `dailyRecordDeletionService`:
exclusión de escritura por fecha, protección del outbox, validación del comando,
confirmación local y posterior traslado remoto a papelera. Los constructores de
comandos permanecen en `contracts/*`; no precisan otro wrapper.

La extensión Eloísa captura información; los flujos HHR validan y aplican cada
operación con sus protecciones de identidad, episodio, fecha y autoridad. Una
captura completa no equivale a persistencia confirmada. Consultar el
[runbook de sync](RUNBOOK_SYNC_RESILIENCE.md) para diagnosticar captura,
propuesta, persistencia y estado visible sin mezclarlos.

`useMovementSectionModel` compone el estado derivado y las acciones sin un
wrapper de runtime. `useMovementSectionActions` conserva un único
`useConfirmedMovementAction` para deshacer y eliminar: la exclusión cubre la
confirmación y la mutación de ambas acciones. `null` sigue siendo distinto de
una colección ausente o vacía.

## Estado, errores y efectos

| Responsabilidad                       | Dueño                                               |
| ------------------------------------- | --------------------------------------------------- |
| Consultas y mutaciones del registro   | TanStack Query y controllers de `src/hooks/`        |
| Sesión, acceso y estado UI compartido | Providers existentes de `src/context/`              |
| Decisión de dominio                   | Controller/contrato del contexto dueño              |
| Persistencia y proveedores externos   | `src/services/` detrás del port/adaptador permitido |
| Efectos del navegador                 | Runtime adapters existentes                         |

No añadir estado global para datos derivados ni duplicar la clasificación de un
fallo en UI. Conservar los outcomes del contrato y distinguir operación rechazada,
fallida, local pendiente y confirmada. Los mensajes seguros se presentan al usuario;
la causa técnica se conserva en observabilidad sin incorporar contenido clínico.

`StaffProvider` conserva la identidad del valor mientras datos, carga, acciones y
estado de sus gestores no cambien. Cambios reales siguen notificando consumidores.
El calendario conserva un listener por mes activo y QueryClient, con cleanup al
cambiar mes, deshabilitar o desmontar. No añadir stores para sustituir esas garantías.

## Decisiones por subsistema

- [Censo, precedencia y recuperación](ADR_DAILY_RECORD_RUNTIME_PATH.md)
- [Auth y recuperación de sesión](ADR_AUTH_RUNTIME_RECOVERY.md)
- [Documentos clínicos](ADR_CLINICAL_DOCUMENT_WORKSPACE_CONTRACT.md)
- [Handoff](ADR_HANDOFF_RUNTIME_SURFACES.md)
- [Índice de ADR y runbooks](DOCUMENTATION_MAP.md)
- [Repositorios y compatibilidad](../src/services/repositories/README.md)
- [Storage y outbox](../src/services/storage/README.md)

## Validar y evolucionar

[CONTRIBUTING.md](../CONTRIBUTING.md) contiene instalación, selección de pruebas y
publicación. [Safe Change Checklist](SAFE_CHANGE_CHECKLIST.md) y la
[Definition of Done](ENGINEERING_DEFINITION_OF_DONE.md) gobiernan el cierre.

Preferir pruebas de comportamiento del dueño y una integración que alcance el
límite real. No añadir tests que sólo repitan delegaciones. No reducir umbrales,
excepciones o compatibilidad para que una simplificación pase. El loader mockeado,
el conteo de renders y el grafo de imports miden propiedades distintas: ninguno
por sí solo demuestra mejor latencia de una sesión clínica real.

La acción `.github/actions/setup-ci-dependencies` reutiliza una instalación sólo
con clave exacta de runner, arquitectura, Node, manifests, lockfile, `.npmrc` y
acción. Un miss/fallo mantiene `npm ci`; Functions conserva instalación separada.
No compartir emuladores ni builds de escenarios distintos ni alterar la política
de gates al simplificar el código.

### Caminos internos de camas y entrega

El dispatch de camas llama a `bedManagementReducer` en `useBedManagementReducer.ts`.
Ese único reducer puro conserva el rechazo de un registro nulo y delega las reglas
clínicas a los builders existentes, sin el antiguo controller intermediario.
`HandoffRow` importa cada celda de su módulo propietario; el antiguo barrel
`HandoffRowCells` no define una frontera pública ni debe recrearse.

### Antecedentes conservados al cambiar de pestaña

El drawer conserva la sección de antecedentes montada para mantener historia y
paginación, pero comunica si está activa. La consulta periódica se pausa cuando
la sección o el documento están ocultos. Al volver se conserva el plazo desde
el último inicio; una solicitud pendiente no se cancela por cambiar de pestaña
ni se duplica. Cambiar episodio o reintentar conserva su cancelación existente.
