# Hooks Reference

## Objetivo

Taxonomía operativa para el core del sistema. La idea es reducir carga cognitiva y dejar claro qué rol cumple cada hook antes de abrir más fragmentación.

## Categorías

| Categoría                  | Propósito                                                                               | Convención recomendada        |
| -------------------------- | --------------------------------------------------------------------------------------- | ----------------------------- |
| `facade`                   | API pública estable para una vista o subdominio. Coordina estado, bootstrap y acciones. | `useX`                        |
| `state`                    | Estado local/UI o draft; no debería conocer infraestructura remota.                     | `useXState`                   |
| `bootstrap`                | Carga inicial, selección base, hidratación o suscripción.                               | `useXBootstrap`               |
| `delivery`                 | Acciones remotas de envío, exportación o comunicación.                                  | `useXDeliveryActions`         |
| `persistence`              | Save/patch/delete o coordinación con write use-cases.                                   | `useXPersistence`             |
| `query`                    | Lectura reactiva/caché/Query wrapper.                                                   | `useXQuery`                   |
| `compat`                   | Bridge temporal para compatibilidad legacy.                                             | `useXCompat`                  |
| `policy/controller-backed` | Hook liviano que delega decisiones puras a `controllers/`.                              | `useX*` + controller dedicado |

## Guía de decisión

### Cuándo algo va a `application/`

- Si coordina side effects remotos.
- Si devuelve `ApplicationOutcome`.
- Si debe ser reusable sin React.

### Cuándo algo va a `controllers/`

- Si transforma datos.
- Si clasifica outcomes.
- Si resuelve copy/labels/validaciones puras.
- Si puede probarse sin React ni repositorios.

### Cuándo sigue siendo hook local

- Si administra estado local, timers, refs o wiring de UI.
- Si no aporta valor moverlo fuera de React.

## Mapa del core actual

| Hook                                          | Categoría                            | Notas                                                |
| --------------------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| `useDailyRecord`                              | `facade`                             | Orquestador principal del censo.                     |
| `useDailyRecordDomainModules`                 | `policy/controller-backed`           | Compone módulos de dominio del censo sin exponer UI. |
| `useDailyRecordCopyActions`                   | `delivery`                           | Copia cross-date con feedback y refresh.             |
| `useDailyRecordQuery`                         | `query`                              | Lectura/caché/optimistic updates.                    |
| `useDailyRecordSyncQuery`                     | `query` + `policy/controller-backed` | Refresh, status y compatibilidad de API.             |
| `usePersistence`                              | `persistence`                        | Crear, copiar y eliminar día.                        |
| `useHandoffManagement`                        | `facade`                             | Composition root del subdominio handoff.             |
| `useHandoffManagementPersistence`             | `persistence`                        | Guardado/patch/refresh de handoff.                   |
| `useHandoffManagementDelivery`                | `delivery`                           | Envío médico, link y firma.                          |
| `useCensusEmail`                              | `facade`                             | Configuración + estado del flujo de censo por email. |
| `useCensusEmailRecipientLists`                | `bootstrap` + `persistence`          | Bootstrap y sync de listas.                          |
| `useCensusEmailMessageState`                  | `state`                              | Mensaje editable.                                    |
| `useCensusEmailSendState`                     | `state`                              | Estado transitorio de envío.                         |
| `useCensusEmailDeliveryActions`               | `delivery`                           | Email/link/share.                                    |
| `useAudit`                                    | `facade`                             | Registro de auditoría con ediciones agrupadas.       |
| `useAuditTrail`                               | `facade`                             | Período, filtros, agrupación y vista de auditoría.   |
| `useAuditConnectionTracker`                   | `bootstrap`                          | Conexión del equipo: inicio, latido y cortes de red. |
| `useBackupFileBrowser`                        | `facade`                             | Navegación y acciones del browser de respaldos.      |
| `useBackupFilesQuery`                         | `query`                              | Listing de Storage con outcome homogéneo.            |
| `useBackupFileBrowserActions`                 | `delivery`                           | Delete/download/backfill.                            |
| `useFileOperations`                           | `delivery`                           | Import/export manual de archivos.                    |
| `useExportManager`                            | `delivery`                           | Exportación y respaldo PDF/Excel.                    |
| `useClinicalDocumentWorkspaceBootstrap`       | `bootstrap`                          | Templates, episodio y listado.                       |
| `useClinicalDocumentWorkspaceDraft`           | `state` + `persistence`              | Draft/autosave/validación derivada.                  |
| `useClinicalDocumentWorkspaceDocumentActions` | `delivery`                           | Create/save/sign/unsign/delete.                      |
| `useClinicalDocumentWorkspaceExportActions`   | `delivery`                           | Print/upload/export.                                 |

## Naming rules

- Usar `useXState` para estado UI/draft.
- Usar `useXBootstrap` para selección/carga inicial.
- Usar `useXDeliveryActions` para envío/export/comunicación.
- Usar `useXPersistence` para save/patch/delete.
- Evitar `useXFacade` en nombres públicos; el hook raíz ya cumple ese rol.

## Contratos

- Si un contrato es semántico y cruza más de un archivo, debe vivir en `*Contracts.ts` o `*Types.ts`.
- Evitar `ReturnType<typeof hook>` cuando el core ya necesita un contrato estable y reusable.

## Regla de poda

Un wrapper se conserva solo si encapsula al menos una de estas cosas:

- policy reusable,
- adapter técnico,
- contrato estable,
- separación real de bootstrap/state/delivery/persistence.

Si solo reexporta o pasa parámetros sin valor semántico, se fusiona con su owner inmediato.
