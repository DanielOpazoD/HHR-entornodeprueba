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
