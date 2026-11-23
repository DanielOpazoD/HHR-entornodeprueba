# Fuga Notification Flow

## Propósito

Permitir que enfermería hospitalaria y administración notifiquen por correo eventos de fuga desde la fila de egresos del censo diario, con mensaje automático editable y nota clínica opcional.

## Roles permitidos

- `nurse_hospital`
- `admin`

Solo `admin` puede usar `modo prueba`.

## Flujo

1. Un egreso con tipo `Fuga` expone la acción `FUGA` en la fila.
2. [FugaNotificationModal.tsx](../../src/features/census/components/FugaNotificationModal.tsx) muestra el mensaje automático y la nota opcional.
3. [useFugaNotificationModalModel.ts](../../src/features/census/hooks/useFugaNotificationModalModel.ts) resuelve destinatarios y validación de envío.
4. [fugaNotificationPolicyController.ts](../../src/domain/census/fugaNotificationPolicy.ts) decide si el envío es `manual`, `automatic` o `test`.
5. [send-fuga-notification.ts](../../netlify/functions/send-fuga-notification.ts) valida autenticación, rol, destinatarios efectivos y envía usando Gmail.

## Destinatarios automáticos de Psiquiatría

- Si la especialidad corresponde a Psiquiatría, el frontend no solicita correos manuales.
- La lista efectiva se resuelve en backend desde `FUGA_PSYCHIATRY_RECIPIENTS`.
- Si esa variable no está configurada, la función rechaza el envío con mensaje explícito.

## Variables de entorno

- `FUGA_PSYCHIATRY_RECIPIENTS`
  Lista separada por comas de destinatarios automáticos para Psiquiatría.
- `VITE_FUGA_EMAIL_ENDPOINT`
  Override opcional del endpoint de envío desde frontend.
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`

## Contrato funcional

Payload esperado:

- `patientName`
- `rut`
- `diagnosis`
- `bedName`
- `specialty`
- `recordDate`
- `time`
- `automaticMessage`
- `nursesSignature`
- `note`
- `recipients` opcional
- `testMode` opcional
- `testRecipient` opcional

Resultados esperados:

- `200` envío exitoso
- `400` payload inválido o destinatarios no resolubles
- `401/403` autenticación o rol insuficiente
