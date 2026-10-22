# Protocolo de Auditoría y Cumplimiento MINSAL

## Sistema Hospital Hanga Roa (HHR)

Este documento detalla el enfoque técnico y clínico del sistema de auditoría implementado, diseñado para cumplir con los estándares de seguridad, trazabilidad e integridad de datos exigidos por el Ministerio de Salud de Chile (MINSAL).

## Protocolo de evidencia viva

Los reportes versionados en `reports/` sirven como snapshots útiles, pero no reemplazan la verificación del estado actual del repo.

Antes de usar `reports/system-confidence.md`, `reports/release-readiness-scorecard.md` o `reports/critical-coverage.md` como evidencia de una auditoría técnica, validar siempre:

```bash
git status --short
npm run check:report-freshness
```

Si el árbol está sucio o `check:report-freshness` muestra drift, esos artefactos deben tratarse como contexto histórico y no como fotografía fiel del checkout en revisión. Para un veredicto de release, usa `npm run check:report-freshness:strict` o `npm run check:release-evidence`.

### 1. Marco legal

La auditoría responde a la **Ley 20.584** (derechos y deberes de los pacientes) y a la norma de
ficha clínica electrónica:

- **Trazabilidad**: quién hizo qué, a qué paciente, cuándo y desde dónde.
- **Integridad**: `hospitals/{id}/auditLogs` es de solo agregar; nadie edita ni borra eventos
  desde la aplicación (`firestore.rules`).
- **Autoría**: cada evento lo escribe la sesión del funcionario que hizo la acción, y solo a su
  nombre. La aplicación toma uid, correo y nombre de la sesión de Firebase y no escribe un evento
  cuyo autor ya no es quien está conectado (sesión terminada o reemplazada). El servidor lo exige
  (`canCreateOwnAuditLogEntry`): `userUid` debe ser el uid de la sesión y `userId` su correo (o su
  uid). Ningún usuario puede registrar ni recibir acciones de otro.
- **Confidencialidad**: solo administración lee la bitácora.

### 2. Qué se registra (modelo v2, 2026-10-22)

Cada evento nuevo lleva `schemaVersion: 2`, el funcionario (correo, UID y nombre), la hora, la
conexión (`sessionId`), el dispositivo (`Chrome · Windows`), la IP cuando se conoce y, si toca a un
paciente, su nombre, documento (tal cual: un pasaporte no se convierte en RUT), cama y día de censo.
Los detalles se acotan al escribir (`auditDetailsCompaction.ts`): textos hasta 1.000 caracteres,
listas hasta 20 elementos y nunca pilas de error.

| Categoría  | Qué es                                                             | Cómo se registra                                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cambios    | Ingresos, altas, traslados, ediciones, entregas, CUDYR, documentos | Una ráfaga de edición es un evento con el primer «antes» y el último «después» de cada campo (60 s sin cambios, pestaña oculta o cierre de sesión). Día y noche son campos distintos. Un campo que termina como empezó queda como «Revertido». |
| Accesos    | Ver ficha, entregas, CUDYR; imprimir o exportar documentos         | Uno por paciente y pantalla cada 15 min (antes era uno por pantalla, sin importar el paciente). Las cuentas institucionales compartidas no registran lecturas.                                                                                 |
| Conexiones | Inicio de sesión, reconexión, cierre, cierre automático, sin red   | Una conexión por equipo, compartida por sus pestañas. Ver §3.                                                                                                                                                                                  |
| Sistema    | Importaciones, conflictos conciliados, versiones restauradas       | Como antes. Los errores técnicos ya no entran a la auditoría clínica: quedan en «Errores locales».                                                                                                                                             |

Con Firestore disponible, el equipo ya no guarda una segunda copia local de cada evento (la caché
offline de Firestore encola la escritura). Solo el modo sin Firestore usa la tabla local
`auditLogs` de IndexedDB.

### 3. Conexiones (inicio, fin y cortes)

`auditConnectionTracker.ts` mantiene una conexión por equipo en `localStorage`, compartida por las
pestañas de ese usuario:

- **Inicio de sesión** al autenticarse sin conexión abierta; **Reconexión** si el mismo usuario
  vuelve tras cerrar el navegador.
- Un latido local por minuto (sin escrituras de red) guarda la última señal. Si el equipo vuelve
  después de más de 15 min de silencio, la conexión anterior se cierra **con la hora de su última
  señal** como «Desconexión» (ventana cerrada).
- **Cierre de sesión** (manual) y **Cierre automático** (8 h sin actividad, fin de turno de la
  cuenta de enfermería o acceso revocado) se registran una sola vez aunque haya varias pestañas.
- **Sin red**: cortes de 1 min o más, con su duración.

Los eventos de conexión usan ids deterministas (`conn_<id>_start|end|net_*`), así que un duplicado
desde otra pestaña es rechazado por la regla de solo agregar. Pasan por una bandeja local con una
clave por evento (`hhr_audit_connection_outbox_v1:<id>`, así las pestañas no se pisan) que sobrevive
al cierre de sesión: el cierre se envía antes de cerrar Firebase (espera máxima de 2 s; el cierre de
Firebase nunca queda esperando) y, si no alcanza, en el siguiente ingreso de esa misma persona en
ese equipo: cada sesión entrega solo sus propios eventos. Un ingreso
en la misma pestaña espera a que ese cierre termine (máximo 5 s), para no usar la sesión que sale.
Una pestaña cerrada por otra escribe antes sus ediciones pendientes. Solo Firestore vacía la bandeja:
sin red los eventos esperan, una sola pestaña entrega a la vez y nunca se descarta un evento por
antigüedad (con 500 pendientes, el nuevo se escribe directo). Al leer la bandeja solo se aceptan
eventos de conexión bien formados, reconstruidos campo a campo: lo que alguien edite en el equipo
no se escribe con la sesión de la persona que entre después.

### 4. Pantalla Auditoría (Observabilidad)

- **Período**: día, 7 días, 30 días o rango, en hora de Rapa Nui; fechas DD-MM-AAAA. Consulta
  `timestamp` por rango (hasta 3.000 eventos por período, con aviso si se alcanza).
- **Resumen**: Cambios, Accesos, Conexiones y Sistema son a la vez totales e interruptores;
  «Revisar» muestra solo lo que pide atención (cama liberada, eliminaciones, versiones restauradas,
  sincronizaciones bloqueadas).
- **Agrupar por** paciente (interacciones por paciente), funcionario, conexión (con línea de tiempo
  del día; una conexión que empezó antes del período o terminó después se completa leyendo su
  inicio o su cierre por id, así un turno de noche muestra su hora y duración reales) o cronológico. Las lecturas repetidas se juntan («Vio ficha ×3») y una ráfaga de cambios
  de una persona sobre un paciente se lee en una sola línea.
- **Buscar** por paciente, RUT (con o sin puntos), cama o funcionario; filtros de funcionario y área.
- **Vista** personalizable (densidad, columnas de documento, cama, dispositivo/IP y grupos abiertos);
  se guarda en el equipo (`hhr_audit_trail_view_v1`).
- Cada línea dice qué pasó y muestra «antes → después»; el detalle técnico (acción, ids, conexión,
  dispositivo, IP y el documento guardado) queda detrás del botón `{ }`.
- **Exportar** genera un Excel con dos hojas: Eventos (una fila por cambio) y Conexiones. Exportar
  queda registrado como acceso.

Los textos largos (notas de entrega) se guardan y se muestran recortados alrededor de la parte que
cambió, para que el «antes → después» siempre muestre la diferencia; la pantalla abrevia las listas
largas, el Excel lleva todos los cambios. Si el servidor rechaza un evento, quien lo escribió recibe
el error: una eliminación que exige su auditoría (un día, una receta) no sigue sin ella. Sin red el
evento queda solo en el equipo (como antes) y la eliminación sigue. La bandeja
de conexión solo
descarta un evento rechazado si un envío anterior pudo haber llegado (la colección no acepta un
segundo documento con el mismo id); si no, lo conserva para quien inicie sesión después en ese
equipo.

### 5. Registros anteriores

Los eventos previos al modelo v2 siguen en la misma colección y la pantalla los lee (sin conexión
asociada). Si se decide respaldarlos y empezar de cero, el respaldo y un eventual borrado se hacen
fuera de la aplicación, con Admin SDK y autorización del responsable del proyecto: las reglas no
permiten borrar desde el cliente.

Límites conocidos: los ajustes administrativos de CUDYR anteriores a v2 guardaron `timestamp` como
Timestamp de Firestore y no aparecen en la consulta por período (desde v2 se guardan como texto
ISO, como el resto). La exportación a PDF se retiró; el Excel incluye el documento completo del
paciente, igual que la pantalla (solo administración puede leer la auditoría). Una ráfaga de
edición espera en la pestaña hasta 60 s después del último cambio: si el navegador se cae (cuelgue
o corte de luz) antes de ocultarse, esa ráfaga no queda en la auditoría, aunque el cambio clínico sí
se guarda. Si la sesión termina sin cerrar sesión (token vencido o revocado), las ediciones aún
agrupadas no se registran: ya no pueden escribirse a nombre de quien las hizo, y nunca se escriben a
nombre de otra persona. La desconexión de alguien que cerró la ventana sin cerrar sesión se registra
cuando esa persona vuelve a ingresar en ese equipo; mientras, su conexión figura «Sin cierre
registrado». Los eventos anteriores a la regla de autoría no tienen esa verificación del servidor.

---

_Este sistema de auditoría es un componente crítico para la acreditación institucional y la seguridad del paciente en el Hospital Hanga Roa._
