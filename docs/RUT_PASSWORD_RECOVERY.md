# Acceso por RUT y recuperación

- Usuario: RUT con DV sin puntos/guion y k minúscula. Se normaliza el texto pegado.
- Cuenta nueva: clave inicial numérica sin DV, sólo para preparar el acceso.
- Primer ingreso: nueva clave (6–128 caracteres, una mayúscula y un número),
  repetición y correo obligatorio. Firebase aplica el mínimo de seis caracteres.
- Ojo: muestra/oculta cada clave sin enviar el formulario; oculto por defecto.
- Olvido: RUT → código al correo previamente registrado → código + nueva clave.
- Código: ocho dígitos, diez minutos, cinco intentos, un uso. Reenviar genera otro
  desafío; cambiar la clave invalida todos los anteriores por versión de cuenta.
- Cuentas existentes: conservan clave/estado. Las que no registraron correo usan
  la activación administrativa para registrar uno; no se adivinan contactos.

## Publicación y operación

Funciones afectadas: createNursingAccount, activateNursingAccount, signInWithRut,
changeNursingPassword y nuevas requestNursingPasswordRecovery/resetNursingPassword,
además del trigger privado deliverNursingPasswordRecovery.
El resto de controles administrativos, reglas y CUDYR mantienen su contrato.

El trigger deliverNursingPasswordRecovery vincula secretos de Secret Manager
GMAIL*CLIENT_ID, GMAIL_CLIENT_SECRET y GMAIL_REFRESH_TOKEN del buzón institucional
hospitalizados@hospitalhangaroa.cl. No basta con que existan en Netlify. Configurar
estos secretos y desplegar sólo en el destino autorizado antes de publicar cliente.
No copiar credenciales a documentación, navegador, logs ni variables VITE*.
Probar el correo con una cuenta sintética y un buzón de prueba autorizado; comprobar
recepción, canje, recarga, rechazo de código repetido y conservación de Google.
Sin esa prueba no declarar disponible el envío real. Ningún secreto ni cuenta real
se crea, restablece o habilita al integrar código.

La solicitud pública siempre crea un desafío privado y responde sin consultar la
cuenta ni esperar Gmail. El trigger de creación consulta la cuenta y reclama el
envío una sola vez; eventos duplicados no generan correos duplicados. Si falla la
entrega, queda `delivery_failed` y se solicita otro código. Una interrupción tras
reclamar y antes de enviar tampoco reenvía automáticamente: el código nunca se
persiste en claro. El vencimiento se cuenta desde la solicitud, no desde la entrega.
El trigger no ofrece acceso HTTP ni revela el estado de entrega al solicitante.

Colección privada de desafíos: hhr_account_recovery (denegada por defecto a clientes).
Campos: hash de RUT, uid opaco, versión, hash con identificador del desafío, intentos, estado y
vencimiento; sin correo ni código en claro. Los intentos erróneos se confirman antes
de devolver error. La recuperación usa el mismo bloqueo de credenciales y versión
que la activación: ante resultado Auth incierto, queda cerrada para reparación admin.

Riesgo aceptado en el diseño solicitado: el RUT no es secreto y una clave derivada
permite reclamar una cuenta pendiente a quien lo conozca. El acceso clínico se
habilita sólo tras establecer clave/correo; eso no prueba identidad del primer actor.
La verificación administrativa previa del funcionario se conserva.

Rollback: revertir cliente/funciones juntos; conservar estados, UID, auditoría y
credenciales establecidas. No borrar índices ni restaurar contraseñas iniciales a
cuentas activas. Los desafíos de recuperación no conceden permisos clínicos.
