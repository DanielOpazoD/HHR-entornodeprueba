# Firestore Rules Critical Access Matrix

## Objetivo

Mantener visible la politica efectiva de permisos en rutas clinicas criticas y evitar cambios silenciosos en `firestore.rules`.

Este documento no reemplaza los tests de emulador. Funciona como mapa ejecutivo y como respaldo humano del guardrail:

- `scripts/check-firestore-rules-critical-access-matrix.mjs`
- `scripts/firestoreRulesCriticalAccessMatrixSupport.mjs`
- `src/tests/build/firestoreRulesCriticalAccessMatrixSupport.test.ts`

## Matriz vigente

| Ruta critica                                                                     | Read                                | Create                                                                                                                                              | Update                                                                                                                 | Delete                                      |
| -------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `hospitals/{hospitalId}/dailyRecords/{date}`                                     | `canReadClinicalData()`             | `canEdit() && !isRayenClinicalWriteFenceActive(hospitalId) && !isSpecialtyDecisionFenceActive(hospitalId) && createsWithoutClinicalDerivedLayout()` | `canUpdatePersistedDailyRecord() && preservesServerOwnedClinicalState(hospitalId) && preservesClinicalDerivedLayout()` | `isAdmin()`                                 |
| `hospitals/{hospitalId}/dailyRecords/{date}/clinicalDerived/{clinicalEpisodeId}` | `canReadClinicalData()`             | `false`                                                                                                                                             | `false`                                                                                                                | `false`                                     |
| `hospitals/{hospitalId}/clinicalDocuments/{documentId}`                          | `canReadClinicalData()`             | `canWriteClinicalDocument()`                                                                                                                        | `canUpdateClinicalDocument()`                                                                                          | `canDeleteClinicalDocument()`               |
| `hospitals/{hospitalId}/auditLogs/{logId}`                                       | `canReadAppendOnlyOperationalLog()` | `canCreateOwnAuditLogEntry()`                                                                                                                       | `false`                                                                                                                | `false`                                     |
| `hospitals/{hospitalId}/transferRequests/{transferId}`                           | `canReadClinicalData()`             | `canEdit()`                                                                                                                                         | `canEdit()`                                                                                                            | `isAdmin()`                                 |
| `hospitals/{hospitalId}/backupFiles/{fileId}`                                    | `canReadClinicalData()`             | `canCreateEditableHospitalDocument()`                                                                                                               | `canAdminMaintainHospitalDocument()`                                                                                   | `canAdminMaintainHospitalDocument()`        |
| `hospitals/{hospitalId}/patients/{rut}`                                          | `canReadClinicalData()`             | `canEdit()`                                                                                                                                         | `canEdit()`                                                                                                            | `canEdit()`                                 |
| `hospitals/{hospitalId}/reminders/{reminderId}`                                  | `canReadClinicalData()`             | `isAdmin()`                                                                                                                                         | `isAdmin()`                                                                                                            | `isAdmin()`                                 |
| `stats/system_health/users/{userId}`                                             | `canReportSystemHealth()`           | `isValidSystemHealthWrite(userId)`                                                                                                                  | `isValidSystemHealthWrite(userId)`                                                                                     | `false`                                     |
| `config/roles`                                                                   | `isAdmin()`                         | `isAdmin() && !isIndividualAccessEnabled()`                                                                                                         | `isAdmin() && !isIndividualAccessEnabled()`                                                                            | `isAdmin() && !isIndividualAccessEnabled()` |

## Regla operacional

Cualquier cambio en una condicion de esta matriz debe ser deliberado y venir con:

- cambio correspondiente en el guardrail;
- test focalizado o emulator test cuando afecte lectura/escritura real;
- actualizacion de este documento si cambia la politica esperada.

Cambios cosmeticos en `firestore.rules` no deben modificar esta matriz.

## Autoría de la auditoría

Un evento de `auditLogs` solo se crea si nombra a quien lo escribe: `userUid` igual al uid de la
sesión y `userId` igual a su correo (o a su uid si el token no trae correo). Nadie registra un
evento a nombre de otra persona; las funciones del servidor (Admin SDK) no pasan por estas reglas.
Las pruebas de emulador cubren el intento con otro uid, con otro correo y sin autor.

## Días divididos (`clinicalDerived`)

Los documentos `clinicalDerived` guardan, por día y episodio, los campos clínicos que la fase 1a
saca del registro del día (`docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md`). Sólo los
escribe el servidor; se leen con la misma condición que `specialtyDecisions`. En `dailyRecords`, la
actualización además exige `preservesClinicalDerivedLayout()`: ningún cliente agrega, cambia ni
quita el marcador `clinicalDerivedLayout`, y en un día marcado `meta.revision` sigue siendo un
entero y no baja (los documentos por episodio copian esa revisión). La creación exige
`createsWithoutClinicalDerivedLayout()`: ningún cliente crea un día con marcador, ni siquiera desde
una copia de IndexedDB o un JSON, porque solo el servidor marca y con una generación nueva. Las
pruebas de emulador cubren la lectura por rol, la escritura negada, el marcador al crear y al
actualizar, y la revisión.

## Integridad de documentos clínicos

Las actualizaciones no administrativas conservan el UID y correo del autor original.
Completar campos de un autor legado con los valores neutros de compatibilidad sigue permitido;
no permite atribuirse el documento. El cierre de episodio y el archivo son monotónicos:
un cliente no puede retirar `lockedReason`, desbloquear un cierre ni reactivar un documento archivado.
Los bloqueos antiguos de firma sin `lockedReason` conservan su normalización existente.
El administrador mantiene la corrección explícita y los autores pueden borrar sus documentos
activos sin bloqueo. Las pruebas de emulador cubren el intento de cambiar autor y luego borrar.
