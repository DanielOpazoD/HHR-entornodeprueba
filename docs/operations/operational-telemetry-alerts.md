# Alertas operativas duraderas

## Flujo y límites

El navegador envía códigos/contadores saneados a `/.netlify/functions/operational-telemetry`.
El receptor moderno de Netlify coordina el envío mediante un ledger privado de Netlify Blobs:
`operational-alerts-v1-production/delivery-ledger`, con consistencia fuerte y escrituras
condicionales por ETag. No utiliza Firestore ni modifica reglas de acceso clínico.

- Un registro actual por operación: `pending`, `sending`, `sent`, `failed` o `uncertain`.
- Máximo 64 operaciones retenidas, 12 intentos de envío globales por ventana móvil de 10 minutos.
- Máximo 3 intentos por registro. Solo una respuesta explícita HTTP 429 se reintenta automáticamente.
- Esperas de 1 y 5 minutos. El barrido privado `operational-telemetry-retry` corre cada 5 minutos,
  procesa hasta 1 registro por ejecución y puede recogerlos después de esas esperas, no antes.
  No reclama un envío sin reservar tiempo para Gmail y su confirmación; corta I/O a los 28 s.
- Un permiso de envío dura 60 segundos. Otro proceso no puede enviar con ese permiso.
- Pendientes caducan a las 24 horas y quedan como fallo; estados terminales se retienen hasta
  7 días, salvo reemplazo por una nueva alerta de la misma operación tras el plazo de 10 minutos.
  Es un registro del último incidente por operación, no un archivo histórico completo.
- El plazo antirrepetición de un envío confirmado empieza al confirmarlo, no al intentarlo.
  Una llegada repetida no reinicia intentos, plazos ni contenido de un registro pendiente.

## Entrega incierta no significa fallo confirmado

Gmail no ofrece una clave de idempotencia para enviar mensajes. Un timeout, corte de conexión,
HTTP 5xx o proceso que muere después de reclamar el envío puede ocurrir después de que Gmail
lo haya aceptado. Esos casos quedan `uncertain` y **no se reintentan automáticamente**.
El `Message-ID` y la referencia de entrega son para correlación, no una promesa de exactamente
una entrega. Un permiso vencido se marca incierto en el siguiente barrido/solicitud.

Ante `uncertain`, comprobar el correo recibido y los enviados del buzón emisor antes de reenviar
manualmente. Ante `failed/provider_rejected` o `mail_not_configured`, revisar OAuth/configuración.
No borrar el ledger ni alterar permisos para forzar un reintento. Una nueva incidencia de la misma
operación puede generar otro registro después del plazo antirrepetición.

Si Blobs no confirma una lectura/escritura, no hay envío sin coordinación: HTTP 503. No se devuelve
una falsa aceptación. Un fallo al guardar el resultado tras un envío puede devolver 503 aunque Gmail
lo haya aceptado; el permiso durable impide reenvío inmediato y después quedará incierto.
El beacon no garantiza reentrega si el receptor estuvo caído antes de persistir; este PR garantiza
la recuperación de registros aceptados, no una cola offline completa del navegador.

## Privacidad y configuración

Asuntos, cuerpo, ledger y logs solo reciben el evento saneado. Los detalles de errores se consultan
localmente en Observabilidad. No se persisten credenciales, objetos de error del proveedor, nombres,
RUT, documentos ni identificadores de pacientes. No confundir esto con eliminar datos que ya
existieran en logs de despliegues anteriores.

El emisor dedicado requiere `OPERATIONAL_TELEMETRY_ALERT_SENDER` y
`OPERATIONAL_TELEMETRY_GMAIL_REFRESH_TOKEN` juntos. Una configuración incompleta falla de forma
explícita, en vez de cambiar silenciosamente al emisor compartido. Sin ambas variables se conserva
el emisor compartido. Destinatarios: `OPERATIONAL_TELEMETRY_ALERT_RECIPIENTS` (máximo cinco).
Censo y fuga no usan la cola ni sus reintentos; conservan sus opciones habituales.

Solo el deploy **publicado de producción** puede enviar y acceder al ledger de producción.
Previews y deploys de producción aún no publicados usan un store separado por deploy ID y no envían.
Las credenciales de Blobs las proporciona Netlify automáticamente: no crear un token público,
no añadir variables `VITE_*` para Blobs, no abrir escrituras anónimas en Firebase.
El receptor de beacon sigue sin autenticación: Origin no prueba identidad. Mantiene tamaño máximo
8 KB, limitación por IP y un presupuesto global durable de correos para limitar abuso; no sustituye
un receptor autenticado ni protege contra todos los ataques de denegación de servicio.

## Comprobación y mantenimiento

1. CI y tests de cola: concurrencia, reinicio, 429, rechazo permanente, timeout, permisos vencidos,
   vencimiento/retención, presupuesto y Blobs no disponible.
2. Tests de integración: SDK real de Blobs contra un servidor HTTP CAS controlado con archivo
   persistente y Gmail HTTP simulado. Eso no prueba por sí solo el backend remoto de Netlify.
   El servidor local oficial de Blobs 11.0.3 no devuelve ETag en GET y no permite validar este contrato.
3. Preview desplegado: comprobar almacenamiento/CAS y que no envíe correos ni acceda al store productivo.
4. Producción: un evento `telemetry_delivery_probe` se etiqueta PRUEBA CONTROLADA. Comprobar correo
   recibido, referencia, remitente y destinatario; repetir en paralelo y revisar un solo intento en Blobs.
5. En Netlify, Functions → `operational-telemetry-retry` → Run now permite comprobar el barrido privado.
   Su configuración `schedule` impide invocarlo por una URL pública.
6. Netlify Blobs muestra el último estado por operación. `retry_sweep` informa contadores sin datos
   de pacientes. Si cambia configuración de correo, reconstruir y publicar; conservar el bloqueo de
   auto-publicación existente. Un rollback a código previo a este PR pierde esta coordinación.

No simular fallos alterando credenciales de producción ni generar errores sobre pacientes reales.
