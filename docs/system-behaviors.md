# Comportamientos del Sistema

Documentación de comportamientos automáticos y esperados del sistema HHR.

---

## 1. Auto-Detección de Versión

### Descripción

El sistema detecta automáticamente cuando hay una nueva versión desplegada y actualiza el navegador del usuario sin intervención manual.

### Comportamiento Esperado

1. Al abrir la aplicación, se consulta `/version.json` del servidor
2. Si la versión del servidor es diferente a la versión local guardada:
   - Se eliminan los Service Workers legacy o desalineados
   - Se limpian los cachés del Service Worker
   - Se invalida la caché local de configuración Firebase
   - Se deja una marca persistente para refrescar solo los registros diarios recientes (hoy y ayer) después de que Firebase esté listo
   - En el siguiente arranque, auth intenta rehidratar una sesión Firebase ya existente antes de depender del observer continuo
   - La página se recarga automáticamente
3. Durante sesiones largas, la app vuelve a verificar el runtime desplegado:
   - al recuperar foco;
   - al volver la pestaña a estado visible;
   - y en un polling liviano periódico.
4. Si el deploy es compatible, la reconciliación sigue siendo silenciosa.
5. Si el contrato runtime o el schema remoto quedan por delante del cliente:
   - se bloquea escritura sensible;
   - la UI marca al cliente como desactualizado;
   - y se exige recarga/actualización para evitar corrupción.
6. El usuario ve la nueva versión sin necesidad de "borrar datos del sitio"
7. Tras la recarga por deploy, la limpieza selectiva de registros diarios locales ocurre solo si la cola de sincronización está legible y sin trabajo pendiente, fallido, en conflicto o reintentando. Si hay trabajo local no resuelto, no se borran registros locales.

### Archivos Relacionados

- `src/services/config/clientBootstrapRecovery.ts` - Reconciliación temprana de deploy y cleanup de SW legacy
- `src/services/config/postDeployRecentRecordRefresh.ts` - Refresco selectivo post-deploy de registros diarios recientes
- `src/hooks/useVersionCheck.ts` - Revisión secundaria, polling y re-check por foco/visibilidad
- `src/context/VersionContext.tsx` - Validación de schema y contrato runtime
- `src/services/config/runtimeContractClient.ts` - Lectura del contrato runtime publicado
- `netlify/functions/runtime-contract.js` - Endpoint runtime publicado por Netlify/Functions
- `vite.config.ts` - Plugin que genera `version.json` en cada build
- `public/version.json` - Archivo con timestamp del build

### Cuándo Ocurre la Recarga

- Solo cuando hay diferencia de versión detectada
- Puede ocurrir antes de inicializar Firebase si se detecta un deploy nuevo o un `sw.js` legacy
- No ocurre en la primera visita (solo guarda la versión)
- Si el contrato runtime es incompatible, la prioridad es seguridad de datos, no continuidad silenciosa.

---

## 2. Sincronización de Datos al Iniciar

### Descripción

Al abrir la aplicación, el sistema sincroniza automáticamente los datos del día actual y del día anterior desde Firebase.

### Comportamiento Esperado

1. **Día Actual:**
   - Primero intenta cargar desde IndexedDB (local, rápido)
   - Si no hay datos locales → consulta Firestore (remoto)
   - Guarda en IndexedDB para próximas visitas

2. **Día Anterior (Prefetch):**
   - Se carga en segundo plano automáticamente
   - Disponible inmediatamente al hacer "Copiar del día anterior"
   - Considerado "fresco" por 5 minutos

### Modo Offline

- Si no hay conexión a internet, solo se usan datos locales
- No hay errores visibles, el sistema funciona silenciosamente

### Comportamiento Esperado de Login al Iniciar

1. El bootstrap del cliente reconcilia deploy, Service Worker y config runtime.
2. Auth revisa primero el retorno pendiente de Google redirect.
3. Si no hay redirect, intenta rehidratar una sesión Firebase ya persistida.
4. Recién después queda suscripto al observer continuo de `onAuthStateChanged`.

Esto reduce los casos donde una sesión válida tarda en materializarse después de un deploy nuevo.

### Verdad Operativa de Sync

El estado remoto ya no se interpreta solo como "Firebase conectado/no conectado". El shell distingue:

- `bootstrapping`: auth o runtime remoto aún se están materializando.
- `ready`: auth válida, red disponible y runtime remoto listo.
- `local_only`: degradación a modo local por falta de sesión válida, offline o runtime no disponible.

Además, el estado operativo conserva una `reason` interna para diagnóstico fino, por ejemplo:

- `auth_loading`
- `auth_connecting`
- `auth_unavailable`
- `offline`
- `runtime_unavailable`
- `ready`

### Archivos Relacionados

- `services/repositories/DailyRecordRepository.ts` - Función `getForDate()`
- `hooks/useDailyRecordQuery.ts` - Prefetch del día anterior

---

## 3. Sincronización en Tiempo Real

### Descripción

Los cambios realizados en un navegador se sincronizan automáticamente a otros navegadores conectados.

### Comportamiento Esperado

- Cambios guardados → enviados a Firestore → recibidos por otros clientes
- Latencia típica: < 2 segundos
- Funciona entre pestañas del mismo navegador y diferentes dispositivos

### Aislamiento por sesión local

- La cola de sincronización persistente conserva ownership por usuario/sesión autorizada.
- Un cambio de usuario en el mismo navegador invalida el outbox sensible heredado de la sesión previa.
- El objetivo es evitar que un segundo usuario reintente escrituras pendientes del anterior.

---

## 4. Modo Offline (Passport)

### Descripción

Usuarios con "passport" pueden trabajar sin conexión a internet.

### Comportamiento Esperado

- Datos se guardan en IndexedDB local
- Al recuperar conexión, se sincronizan automáticamente
- El passport tiene validez de 7 días

## 4.1. Refresh (`F5`) y restauración funcional

### Comportamiento Esperado

- Si la sesión sigue válida, `F5` debe volver al mismo contexto funcional mínimo:
  - módulo;
  - fecha seleccionada.
- Si la sesión expiró o quedó inválida, debe mostrarse login.
- Si el cliente quedó desactualizado frente a runtime/schema incompatible, debe exigirse actualización segura.

### Límites deliberados

- Se restaura navegación funcional mínima, no modales efímeros ni estado interno transitorio.
- La URL actúa como contrato mínimo de restauración usando `module` y `date`.

### Archivos Relacionados

- `src/hooks/useAppState.ts`
- `src/hooks/useDateNavigation.ts`
- `src/hooks/useAuthState.ts`
- `src/context/VersionContext.tsx`

### Comportamiento Esperado de loaders iniciales por ruta

- `"/"` y `"/login"`:
  - muestran una pantalla inicial propia del login;
  - conservan el fondo visual del módulo de inicio;
  - y usan un ícono clínico especial mientras auth/bootstrap todavía no resuelven sesión.
- `"/census"`:
  - no debe mostrar un loader inicial full-screen previo;
  - el primer estado de carga visible debe ser el loader interno del shell de censo;
  - ese loader es el que conserva barra superior, títulos y contexto visual del módulo.
- rutas distintas de login/censo:
  - no deben usar un loader inicial genérico full-screen;
  - deben mantener el chrome real del módulo origen si la ruta corresponde a un módulo autenticado;
  - el `Suspense` de `AppRouter` puede mostrar solo el loader interno del área de contenido;
  - ese loader no debe ocupar pantalla completa ni reemplazar `Navbar`/`DateStrip`.

### Fases visibles del bootstrap de app

El shell ya no debe tratar el bootstrap como una caja negra de solo `loading/no loading`.
La fase visible esperada es:

- `bootstrapping`:
  - arranque pre-auth sin señales suficientes de sesión recuperable;
  - puede mantenerse visualmente silencioso en `"/"` y `"/login"`;
  - si la ruta ya corresponde a un módulo autenticado, debe conservar el chrome de ese módulo.
- `rehydrating`:
  - existe sesión/reconexión/auth runtime en materialización;
  - no debe pintar login ni fondo de login en refreshes autenticados.
- `authenticated`:
  - shell autenticado listo.
- `unauthenticated`:
  - login real confirmado.
- `local_only`:
  - modo no autenticado o degradado sin runtime remoto utilizable.

La UI no debe reinterpretar estos casos con heurísticas paralelas repartidas entre `index.tsx` y `App.tsx`; la política de presentación debe salir de helpers del app shell.

### Contrato anti-regresión para refresh autenticado por módulo

El contrato ya no es “solo censo”; aplica al módulo origen desde el que el usuario recarga:

1. Al recargar con `F5`, no debe aparecer ningún loader global full-screen antes del shell real del módulo actual.
2. Tampoco debe aparecer una transición intermedia fija que fuerce siempre `Censo Diario`.
3. Si auth cae brevemente a `unauthenticated` mientras una sesión reciente de la misma pestaña todavía se está rehidratando, la UI no debe volver al login ni a un fondo blanco: debe mantener el chrome real del módulo origen hasta que:
   - vuelva el shell autenticado completo; o
   - se confirme de verdad que debe mostrarse login.
4. El contenido inferior del módulo puede seguir cargando por separado, pero `Navbar` y `DateStrip` deben conservar continuidad visual cuando ese módulo los usa.
5. Si el módulo origen no usa `DateStrip` real, el bootstrap tampoco debe inventarlo.
6. Si el chunk lazy del módulo todavía no cargó, el router debe mostrar un loader interno bajo el chrome, no una pantalla blanca ni un spinner full-screen.

### Contrato visual preboot actual para refresh autenticado

- Antes de que React monte, `index.html` solo debe aportar continuidad de fondo, no reconstruir la barra de la app.
- El chrome visible del refresh autenticado debe venir desde React bootstrap usando los componentes reales del repo.
- Ese chrome debe respetar la ruta de origen:
  - `"/"` y `"/census"`: chrome de `Censo Diario`;
  - `"/nursing-handoff"`: chrome de entrega de enfermería;
  - `"/medical-handoff"`: chrome de entrega médica;
  - `"/transfer-management"`: navbar de traslados, sin `DateStrip` inventado;
  - y así para cualquier ruta que el shell resuelva como módulo real.
- El objetivo es separar `chrome` y `contenido`: el chrome puede mantenerse estable mientras el cuerpo del módulo termina de hidratar.
- Queda prohibido volver a una barra estática hecha a mano en `index.html`.

### Contrato visual preboot actual para login

- Login no debe mostrar spinner de arranque.
- Login no debe mostrar un frame blanco antes de que aparezca la pantalla real.
- El fondo inicial debe alinearse con la composición visual real del login, sin sustituirla por un loader de pantalla completa.
- Si el usuario está en modo noche o lo dejó seleccionado, el refresh no debe volver transitoriamente al fondo de día.

### Qué NO se debe hacer en refresh autenticado

- No renderizar `InitialLoadingScreen`.
- No renderizar `DefaultLoadingScreen`.
- No reutilizar suppressions visuales pensadas para login si introducen un spinner full-screen adicional.
- No agregar nuevos `Suspense fallback` full-screen delante ni dentro del router autenticado del módulo.
- No forzar siempre el chrome de `Censo Diario` si la ruta de origen es otra.
- No volver a usar una barra azul/blanca estática como “imagen estable de transición”.

### Intención de diseño

- Evitar dos transiciones full-screen consecutivas al recargar cualquier módulo autenticado.
- Mantener continuidad visual del login durante bootstrap previo a autenticación.
- Permitir que `chrome` y `contenido` carguen con ritmos distintos sin cambiar de módulo en la transición.
- Reemplazar el antiguo “flash blanco” por continuidad visual mínima y reconocible del módulo origen mientras el shell real monta.
- Tratar cualquier nuevo loader global visible o cualquier chrome de módulo equivocado como regresión.

### Archivos Relacionados

- `src/index.tsx`
- `src/App.tsx`
- `src/app-shell/bootstrap/BootstrapCensusChrome.tsx`
- `src/hooks/useAppState.ts`
- `src/components/ui/InitialLoadingScreen.tsx`
- `src/app-shell/runtime/AuthenticatedAppShell.tsx`
- `src/tests/app-shell/BootstrapRouteChrome.test.tsx`
- `src/tests/components/InitialLoadingScreen.test.tsx`
- `src/tests/components/AppLoadingBehavior.test.tsx`

### Recuperación tras borrar datos locales del navegador

#### Problema histórico

- Si el usuario borraba los datos locales del sitio y luego recargaba con `F5`, la app podía quedar varios segundos en pantalla blanca antes de mostrar login.
- El síntoma típico era un stack de `Dexie`/`IndexedDB` en consola durante bootstrap.
- La percepción era que el cliente "seguía intentando" validar una sesión ya inexistente antes de aceptar que debía volver a inicio de sesión.

#### Causa técnica

- El bootstrap de auth esperaba el flujo completo de rehidratación incluso cuando ya no quedaban pistas reales de sesión local.
- En paralelo, el singleton de feature flags intentaba leer overrides desde IndexedDB apenas se importaba.

### Exportación desde snapshot persistido

#### Contrato esperado

- Exportar PDF, Excel o respaldo no debe leer estado visual transitorio.
- Antes de exportar, el runtime debe:
  1. forzar `blur` del editor activo;
  2. esperar cualquier guardado pendiente;
  3. resolver el registro estable más reciente;
  4. recién entonces generar el documento.

#### Consecuencia operativa

- Si la pantalla muestra un cambio que ya disparó persistencia, el documento debe reflejarlo sin requerir una segunda edición “de confirmación”.
- Queda prohibido que el exportador recomponga reglas clínicas por fuera de las policies compartidas del dominio.

### Historial clínico reconciliado

#### Contrato esperado

- `patientHistoryService` es el dueño de la mezcla `IndexedDB + Firebase` para cierres de episodio.
- El timeline del buscador no debe inventar cierres clínicos en JSX ni depender de interacción del usuario para que aparezca un egreso remoto.
- Las pistas de hospitalización (`Ingreso`, `Egreso`, `Traslado`, `Fallecimiento`) deben servir para acotar el rango remoto relevante incluso si el cache local está incompleto.
- Si el navegador acababa de perder su backing store local, `ensureDbReady()` entraba en la política de recuperación de IndexedDB y consumía los delays de retry (`500ms`, `1500ms`, `4000ms`) antes de caer a fallback.

#### Comportamiento esperado actual

1. Si no hay redirect pendiente, no hay hint persistido de Firebase y tampoco hay usuario Firebase activo, auth debe resolver `unauthenticated` de forma inmediata.
2. Los feature flags no deben participar del bootstrap crítico de login vía IndexedDB.
3. Borrar datos locales y recargar debe devolver rápidamente a la pantalla de login, sin una pausa larga en blanco.

#### Decisión de diseño

- La persistencia de feature flags quedó en `localStorage`, no en IndexedDB.
- Auth conserva el observer continuo para futuros cambios de sesión, pero el estado inicial ya no espera innecesariamente cuando no hay evidencia de sesión vigente.

#### Archivos Relacionados

- `src/hooks/useAuthStateSupport.ts`
- `src/hooks/controllers/authBootstrapController.ts`
- `src/services/utils/featureFlags.ts`
- `src/tests/hooks/useAuthStateSupport.sessionResolution.test.tsx`
- `src/tests/services/featureFlags.test.ts`

## 4.2. Bloqueo rápido local (PIN)

### Descripción

El PIN local funciona como una barrera de privacidad visual del puesto de trabajo en el navegador actual.

### Comportamiento Esperado

1. La configuración se guarda solo en el navegador/dispositivo actual.
2. Puede pedir el PIN local al abrir la app o tras un período de inactividad.
3. El bloqueo solo oculta la pantalla hasta que el mismo PIN local sea ingresado.
4. No reemplaza:
   - autenticación Firebase;
   - logout;
   - permisos por rol;
   - reglas de Firestore o controles server-side.

### Archivos Relacionados

- `src/context/SecurityContext.tsx`
- `src/components/modals/SecuritySettings.tsx`
- `src/components/security/PinLockScreen.tsx`

---

## 5. Respaldo Automático en la Nube

### Descripción

El sistema asegura la persistencia de documentos críticos (PDF de Handoff y Excel de Censo) respaldándolos automáticamente en Firebase Storage durante el proceso de exportación.

### Comportamiento Esperado

1. **Gatillos de Respaldo:**
   - Al descargar el PDF local de Entrega de Turno.
   - Al enviar el Censo por correo electrónico.
   - Al descargar manualmente el Excel maestro del Censo.
2. **Validación de Existencia:**
   - El sistema verifica si ya existe un archivo para la fecha y turno actual.
   - Si el archivo ya existe, el botón de "Guardar en Nube" cambia a color **Verde** y muestra el estado **Archivado**.
3. **Flujo de Usuario:**
   - La descarga local y el respaldo en la nube ocurren de forma concurrente para minimizar la espera del usuario.

### Archivos Relacionados

- `hooks/useExportManager.ts` - Orquestador central de exportaciones.
- `services/backup/pdfStorageService.ts` - Manejo de archivos PDF.
- `services/backup/censusStorageService.ts` - Manejo de archivos Excel.

---

## 6. Visibilidad Dinámica de Módulos (RBAC)

### Descripción

La interfaz se adapta dinámicamente según el rol del usuario y el contexto clínico.

### Comportamiento Esperado (CUDYR)

- El módulo CUDYR solo es accesible desde la **Entrega de Turno de Enfermería**.
- Solo es visible cuando se selecciona el **Turno Noche**, ya que es el momento normativo de categorización.
- Al activarse, mantiene el contexto de navegación del módulo padre (Handoff) resaltado en el Navbar.

---

## Troubleshooting

### "La página se recarga sola al abrirla"

**Causa:** Se detectó una nueva versión desplegada o se retiró un Service Worker legacy.
**Acción:** Comportamiento normal, no requiere intervención.

### "Los datos aparecen vacíos al inicio"

**Causa posible:** Primera vez que se abre ese día sin datos previos.
**Acción:** Usar "Copiar del día anterior" o "Registro en blanco".

### "El botón de respaldo aparece en verde"

**Causa:** El sistema ya realizó un respaldo automático exitoso para esa fecha.
**Acción:** Ninguna, el dato ya está seguro en la nube.

### "Los cambios no se sincronizan"

**Causa posible:** Sin conexión a internet o Firebase desconectado.
**Acción:** Verificar conexión. Los datos se guardan localmente y se sincronizarán al reconectar.

### "Después de cerrar sesión otro usuario no debería ver tareas pendientes anteriores"

**Causa esperada:** El logout manual ahora limpia estado sensible de sesión y ownership del outbox.
**Acción:** Si esto no ocurre, tratarlo como incidente de aislamiento de sesión, no como comportamiento normal.

---

_Última actualización: 4 de Abril 2026_
