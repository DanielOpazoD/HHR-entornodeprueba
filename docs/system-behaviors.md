# Comportamientos del Sistema

Documentación de comportamientos automáticos y esperados del sistema HHR.

---

## 1. Auto-Detección de Versión

### Descripción
El sistema detecta automáticamente cuando hay una nueva versión desplegada y actualiza el navegador del usuario sin intervención manual.

### Comportamiento Esperado
1. Al abrir la aplicación, se consulta `/version.json` del servidor
2. Si la versión del servidor es diferente a la versión local guardada:
   - Se limpian los cachés del Service Worker
   - Se limpia localStorage (preservando credenciales offline)
   - La página se recarga automáticamente
3. El usuario ve la nueva versión sin necesidad de "borrar datos del sitio"

### Datos Preservados Durante Actualización
| Clave | Descripción |
|-------|-------------|
| `hhr_offline_user` | Datos del usuario para modo offline |
| `hhr_passport_token` | Token de passport para autenticación offline |

### Archivos Relacionados
- `hooks/useVersionCheck.ts` - Hook que implementa la detección
- `vite.config.ts` - Plugin que genera `version.json` en cada build
- `public/version.json` - Archivo con timestamp del build

### Cuándo Ocurre la Recarga
- Solo cuando hay diferencia de versión detectada
- ~1 segundo después de que la app termine de cargar
- No ocurre en la primera visita (solo guarda la versión)

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

---

## 4. Modo Offline (Passport)

### Descripción
Usuarios con "passport" pueden trabajar sin conexión a internet.

### Comportamiento Esperado
- Datos se guardan en IndexedDB local
- Al recuperar conexión, se sincronizan automáticamente
- El passport tiene validez de 7 días

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
**Causa:** Se detectó una nueva versión desplegada.
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

---

*Última actualización: 25 de Enero 2026*
