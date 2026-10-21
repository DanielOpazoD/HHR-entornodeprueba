# Acceso por RUT y recuperación

- Pantalla principal: Usuario y Contraseña visibles, recuperación directa, Google como icono en la esquina inferior de la tarjeta. La contraseña permanece oculta hasta pulsar el ojo.
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

Comprobar también las reglas publicadas de Firestore y Storage: deben reconocer
`hhr_account_access` y la versión de sesión. Desplegar sólo las funciones de
cuentas no actualiza estas reglas. Un `checkUserRole` correcto junto con lecturas
básicas denegadas puede revelar reglas antiguas, no una clave incorrecta.
Comparar el ruleset activo con los archivos generados del SHA validado, sin
ampliar permisos ni modificar datos para resolver el cierre de sesión.

Funciones afectadas: `createNursingAccount`, `manageNursingAccount`, `activateNursingAccount`, `signInWithRut`,
`changeNursingPassword` y nuevas `requestNursingPasswordRecovery`/`resetNursingPassword`,
además del trigger privado `deliverNursingPasswordRecovery`.
El resto de controles administrativos, reglas y CUDYR mantienen su contrato.

El trigger `deliverNursingPasswordRecovery` vincula secretos de Secret Manager
`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` y `GMAIL_REFRESH_TOKEN` del buzón institucional
hospitalizados@hospitalhangaroa.cl. No basta con que existan en Netlify. Configurar
estos secretos y desplegar sólo en el destino autorizado antes de publicar cliente.
No copiar credenciales a documentación, navegador, logs ni variables `VITE_`.
Antes del merge, comprobar los tres secretos en `hhr-pruebas`: el despliegue automático
actual sólo tiene acceso documentado a metadatos de `TYPESAFE_API_KEY`. Un administrador
debe preparar los secretos y sus permisos específicos, y la invocación de las dos
nuevas funciones públicas. El trigger Firestore no debe hacerse público. Alinear
backend y cliente; el cliente antiguo no completa el alta inicial que ahora requiere correo.
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

Colección privada de desafíos: `hhr_account_recovery` (denegada por defecto a clientes).
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

## Gestión de usuarios

La lista muestra nombre, RUT, correo de recuperación registrado, rol y estado. Los
roles reutilizan la matriz existente de HHR; no se crean permisos clínicos nuevos.
Solo un administrador con sesión reciente puede consultar correos o administrar.

- **Modificar:** cambia nombre y rol, preservando UID, RUT, clave y correo. Revoca
  la versión de sesión anterior y registra los valores anteriores/nuevos en auditoría.
- **Resetear:** invalida la clave y los códigos anteriores; habilita la clave inicial
  del RUT únicamente después de confirmar las operaciones de Auth. El siguiente
  ingreso vuelve a exigir clave personal y correo. No emite un código de activación.
- **Deshabilitar / Habilitar:** bloquea/restaura el acceso conservando la clave.
  Una cuenta con configuración interrumpida requiere Resetear, no Habilitar.
- **Eliminar:** elimina exclusivamente el usuario de Firebase Auth creado por HHR
  (`hhrn_…`). Conserva la identidad retirada, reserva del RUT y auditoría para evitar
  reasignar autorías. No borra censos, notas, correos Google ni datos de otras apps.
  Si Auth no confirma la eliminación, queda inaccesible y puede completarse después
  de cinco minutos. Los eliminados se ocultan salvo solicitud explícita del listado.

La observación de verificación al crear una cuenta es opcional; la confirmación de
identidad y vigencia permanece obligatoria. Los accesos antiguos se muestran en una
sección colapsada. No se activa la transición oficial al abrir o modificar esta UI.
La ampliación de la lista requiere alinear también `listNursingAccounts` en pruebas;
no basta desplegar las ocho funciones iniciales. No se cambian reglas ni CUDYR.
