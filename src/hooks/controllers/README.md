# `src/hooks/controllers`

## Propósito

Controladores puros consumidos por hooks para separar:

- decisiones de negocio,
- estado derivado,
- traducción de errores/mensajes.

## Ownership

- Los controllers específicos de `census` tienen owner canónico en `src/features/census/controllers`.
- Si el mismo basename existe en `src/hooks/controllers`, ese archivo debe ser solo un shim de compatibilidad.
- No se admiten dos implementaciones activas del mismo controller entre ambas rutas.

## Mapa

| Archivo                                           | Propósito                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `dailyRecordSyncNotificationController.ts`        | Traducción de errores de sync a feedback UX                                        |
| `dailyRecordSyncStatusController.ts`              | Estado de sync derivado de mutaciones                                              |
| `censusEmailRecipientsBootstrapController.ts`     | Bootstrap de destinatarios globales/locales sin exponer excepciones esperadas      |
| `censusEmailRecipientMutationActionController.ts` | Especificaciones declarativas para create/rename/delete de listas de destinatarios |
| `censusEmailSendController.ts`                    | Reglas de envío de email de censo                                                  |
| `censusEmailBrowserRuntimeController.ts`          | Runtime del flujo email desacoplado del browser global                             |
| `handoffManagementMutationController.ts`          | Runner común para mutaciones de handoff con errores y auditoría consistentes       |

## Patrón

Hook -> controller -> hook.

Esto permite tests unitarios directos de controller sin montar React.

Para `census`, la implementación dueña vive en `src/features/census/controllers`. Los shims legacy en `src/hooks/controllers/*` solo deben existir cuando todavía haya consumidores reales.
