# Engineering Definition Of Done

Una change queda lista solo si cumple todo lo siguiente:

1. `npm run typecheck`, `npm run lint`, `npm run check:quality` y `npm run build` pasan en verde.
2. No introduce warnings en `src/`.
3. Si toca flujos críticos, agrega o ajusta tests automatizados.
4. Si cambia boundaries, wiring o contratos, actualiza documentación/ADR en la misma change.
5. No agrega bypasses a `application`, `shared/access` ni providers obligatorios.
6. No deja excepciones abiertas sin owner, motivo y criterio de cierre documentados.
7. Si toca un subsistema crítico, mantiene actualizado `scripts/config/technical-ownership-map.json` con owner, gate y runbook vigentes.
8. Si la change entra en una categoría gobernada, sigue `scripts/config/sustainable-change-policy.json` y deja evidencia del gate o artefacto requerido.
9. Si incluye lógica de app, assets estáticos o snapshots de `reports/`, separa esos concerns en commits distintos cuando no dependan del mismo fix.

Para validar ingresos tras cambios de cama, probar el recorrido de conciliación,
aplicación y validación con dos camas ocupadas que intercambian episodios. El
comparador usa identidad de episodio y conserva el rechazo de cambios reales de
fecha, incluidos episodios antiguos sin identificador. El historial de un guardado
rechazado debe conservar la causa y la identidad del intento, sin errores crudos ni
atribuir el fallo al ocupante posterior de la cama.

Para cambios de identidad en la guarda de borrado, exigir paridad cliente/servidor, bloqueo
de RN con documento materno y episodios distintos, y conservación de permutas, cuna a cama
e hidratación `legacy_ep_` a id persistido. Probar que un rechazo del callable no escribe
ni crea historia. La evidencia sintética no acredita datos reales ni el servidor desplegado;
confirmar por separado el rollout automático antes de declarar la protección activa en ambos lados.

Para instrumentación de transacciones clínicas, demostrar que los callbacks
fallidos y reintentados se cuentan sin duplicar etapas, que la telemetría no incorpora
campos ni identificadores clínicos y que el replay exacto mantiene sus escrituras
idempotentes. Los tiempos internos orientan una optimización posterior; no prueban
por sí solos una mejora de velocidad. Conservar orden de lecturas, autoridad y
atomicidad, y ejecutar el pack de confianza de release para cambios del handler.

El rollout regional clínico conserva el endpoint anterior mientras existan clientes
que lo usen. Verificar ambas regiones desplegadas antes de cambiar el cliente;
no confundir una región declarada con un despliegue disponible ni con una mejora medida.

Un cambio del cliente regional requiere demostrar invocación autenticada y rechazo
sin sesión, conservar el timeout y no duplicar solicitudes ante errores. Separar
replays de recibos de escrituras nuevas al medir rendimiento; conservar las muestras
lentas y declarar el tamaño y alcance del experimento. Una mejor mediana no acredita
mejorar la cola de latencia ni el tiempo de la sincronización completa.

Para cambios en inicio de sesión o recarga autenticada, verificar que el eco inicial
del observer no readmita una sesión idéntica, sin saltar la admisión pendiente,
los cambios de permisos ni el cierre de sesión. Los providers diferidos no deben
remontar la interfaz clínica ni borrar estado de controles al completar su carga.

Para exportaciones y respaldos, el vencimiento de la espera de guardado no equivale
a un censo listo. Probar el guardado pendiente, el fallo de guardado y el cambio de
día durante la espera o la confirmación; ninguno debe generar archivos, abrir la
impresión ni marcar un respaldo como archivado. Una copia local válida no exige
confirmación remota. Un getter que devuelve `null` no autoriza reutilizar un registro
anterior. La impresión del DOM vuelve a comprobar el día justo antes de abrirse.

El Excel mensual conserva su rango explícito hasta el día elegido y puede incluir
días anteriores aunque ese día esté vacío. Este permiso no aplica a exportaciones
o respaldos diarios y no evita comprobar guardado, fallo y cambio de fecha.

Los detalles de signos y scores se cargan al activarlos, manteniendo el resumen
del censo disponible. Verificar apertura, cierre durante la carga, respuesta tardía
y fallo del módulo sin remontar el censo ni recargar una edición. Las lecturas,
rangos clínicos e historiales conservan sus contratos. Medir la unión de chunks
estáticos del shell y del censo con la misma configuración: mover código entre
archivos sin reducir esa unión no acredita una mejora del arranque.

El historial completo debe recorrer todas las páginas sin inventar episodios
a partir de un prefijo. Mantener identidad de RN, movimientos borrados y
continuidad entre páginas; diferenciar servidor completo de fallback local.
Probar cancelación, progreso y resultados tardíos contra la selección vigente,
y no persistir una lectura parcial en la caché de historias completas. Una
proyección reducida no autoriza eliminar datos de los censos editables ni acredita
menor uso de memoria del SDK. Documentar los límites de consistencia y latencia.

Para cambios de renderizado del censo, medir con el proveedor real y con JSX nuevo
del padre; una identidad estable aislada no demuestra que se omita el subárbol.
Probar cambios de fecha, ausencia de registro, dotación, movimientos, tombstones
y permisos. Conservar las revisiones del registro en los consumidores que las
necesitan para escribir. Un conteo de renders no acredita una mejora de INP.

Al ampliar la reutilización de dependencias en CI, demostrar que la clave es exacta,
que un miss o fallo conserva `npm ci` y que no aparecen nuevos escritores de caché.
Comparar el YAML estructuralmente para conservar todos los gates, condiciones,
permisos, matrices y presupuestos. Ejecutar los contratos de scheduling/caché y
el CI completo del head final; informar los hits y tiempos observados sin atribuir
el ahorro de un paso a todo el pipeline ni al rendimiento de la aplicación.

### Cuentas RUT: primer ingreso y recuperación

La entrega se valida con `test:accounts:emulator:ci` (Auth/Firestore/Storage y UI
sintéticos) y los gates de runtime crítico. El correo se sustituye en emuladores;
no acredita entrega real. Ver [operación y publicación](RUT_PASSWORD_RECOVERY.md).

El monitor de cuentas RUT debe conservar todos los roles administrables que
confirma el servidor, incluido Administrador. Probar el control inicial y periódico,
revocación, vencimiento, fallo transitorio y desmontaje; una contraseña aceptada
no acredita una sesión utilizable. La aceptación real requiere leer datos básicos
y recargar contra las reglas efectivamente publicadas en el proyecto de pruebas.

### Fallo de publicación al cerrar sesión · 22-10-2026

El cierre no depende del éxito del canal entre pestañas. Para este cambio de
auth runtime se exige `ci:merge-gate`, `test:release-confidence`, revisión
independiente y CI del head definitivo. La regresión del handler real debe
confirmar signOut, limpieza del propietario y conservación de trabajo pendiente
con BroadcastChannel fallido, sin modificar autoridad clínica ni CUDYR.

### Ruta regional de acceso RUT · 22-10-2026

Para cambiar la ruta regional RUT, comprobar el endpoint Gen2
`signInWithRutSantiago`, su identidad de servicio Appspot explícita y la
compatibilidad HTTP con el callable Gen1: datos/respuesta, CORS, autorización,
entrada inválida y errores. Probar que el valor predeterminado Santiago se limita
al proyecto exacto `hhr-pruebas`, que US/East/West se seleccionan sólo mediante la
allowlist y que un flag inválido usa US. Conservar otros callables, recuperación,
sesión y CUDYR; una respuesta incierta no autoriza fallback ni otro envío.

La aceptación de rendimiento debe conservar todas las muestras y distinguir
medianas, primeros accesos observados, región y generación. Los cinco pares de
la prueba regional orientan el rollout de pruebas; no garantizan arranque frío,
p95 ni tiempo de pintura del censo. Verificar disponibilidad del endpoint y
sesión/censo después de recargar por separado del CI o merge.

Al agrupar lecturas del ingreso RUT, demostrar que sólo sale de la transacción el
índice cuyo commit terminó; cubrir reintento, error de lectura/commit y políticas
de IP/cuenta sin reducir límites. La clave personal debe evitar la lectura de
preparación inicial sin omitir verificación de token revocado ni estado de acceso
posterior al proveedor. Probar que una sesión reemplazada mientras espera el lock
no limpia los resultados de rol del nuevo propietario. No añadir cachés de
autorización, ni presentar menos RPC como solución probada a los arranques en frío.
