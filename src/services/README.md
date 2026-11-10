# `src/services`

## Propósito

Capa de datos e integración: repositorios, persistencia, exportadores, integraciones externas y servicios de dominio técnico.

## Mapa por subdirectorio

| Subdirectorio                                                 | Rol                                                             |
| ------------------------------------------------------------- | --------------------------------------------------------------- |
| `repositories/`                                               | Repository Pattern para `DailyRecord` y catálogos               |
| `storage/`                                                    | IndexedDB, fallback local legacy mínimo, Firestore sync y colas |
| `integrations/`                                               | Conectores a servicios externos (email, IA, etc.)               |
| `exporters/`                                                  | Exportación Excel/reportes                                      |
| `admin/`                                                      | Servicios de auditoría, mantenimiento y salud                   |
| `transfers/`                                                  | Generación documental y soporte de traslados                    |
| `auth/`                                                       | Servicios de autenticación y políticas de acceso                |
| `backup/`                                                     | Respaldo y restauración                                         |
| `observability/`                                              | Telemetria operacional y adapters de dominio                    |
| `terminology/`                                                | Normalización y búsquedas semánticas clínicas                   |
| `utils/`                                                      | Utilidades de servicio (logging, feature flags, etc.)           |
| `pdf/`                                                        | Generadores PDF                                                 |
| `security/`                                                   | Helpers de contraseña/export seguro                             |
| `calculations/`                                               | Cálculos estadísticos                                           |
| `bookmarks/`, `census/`, `config/`, `email/`, `google/`, etc. | Servicios especializados por dominio                            |

## Archivos raíz relevantes

| Archivo                  | Propósito                            |
| ------------------------ | ------------------------------------ |
| `RepositoryContext.tsx`  | Inyección de repositorios en runtime |
| `ExcelParsingService.ts` | Parsing Excel de soporte             |

## Patrones clave

- **Repository Pattern** con entrypoints concretos (`dailyRecordRepositoryReadService`, `dailyRecordRepositoryWriteService`, `CatalogRepository`, etc.).
- **Repository provider desacoplado**:
  - `DefaultRepositoryProvider` compone el wiring por defecto del runtime.
  - `createRepositoryContainer` y `createTestRepositoryContainer` quedan para composición explícita e inyección en tests.
- **Service split por responsabilidad** (`read/write/sync/init` en repositorio diario).
- **Storage abstraction** con estrategia offline-first y fallback.
- **Ownership explícito del acceso Firestore concreto**:
  - `storage/firestore/firestoreServiceRuntime.ts` define el runtime canónico.
  - `storage/firestore/firestoreDatabaseProvider.ts` expone el provider Firestore-backed soportado.
  - `services/infrastructure/db` conserva implementación y tipos del provider, pero no es el
    entrypoint recomendado para nuevos consumers del singleton concreto.
- **Domain observability**:
  - `observability/domainObservability.ts` crea adapters pequenos por dominio
  - `operationalTelemetryRecorder.ts` queda como sink/base compartida
  - los contextos nuevos deben preferir wrappers (`authOperationalTelemetry`, `reminderObservability`, etc.) antes que importar el servicio generico
- **Auth por flujo y resolución**:
  - `authFlow.ts` como fachada pública del login
  - `authCredentialFlow.ts` para email/password y creación de usuario
  - `authGoogleFlow.ts` para popup, lock multi-tab y ramas E2E
  - `authFallback.ts` para redirect/bootstrap
  - `firebaseAuthConfigPolicy.ts` y `authRedirectRuntime.ts` para validar si el acceso alternativo está realmente disponible según entorno y configuración
  - `firebaseStartupUiPolicy.ts` para mensajes de arranque cuando la configuración de Firebase es inválida o incompleta
  - `firebaseAuthConfigPolicy.ts` también expone diagnósticos de configuración para distinguir bloqueos reales de advertencias operativas
  - `authUiCopy.ts` para centralizar textos visibles de login y fallback sin mezclar copy en varios módulos
  - `authSession.ts` para suscripción de sesión activa
  - `authAccessResolution.ts` para autorización y resolución de rol
  - `authPolicy.ts` como fachada de acceso general basada en `config/roles`, caché y lookup backend
  - el modelo canónico de login general está en [docs/AUTH_ACCESS_MODEL.md](../../docs/AUTH_ACCESS_MODEL.md)
  - el runbook corto de soporte está en [docs/RUNBOOK_AUTH_ACCESS_INCIDENTS.md](../../docs/RUNBOOK_AUTH_ACCESS_INCIDENTS.md)
- **Excel runtime centralizado** en `exporters/excelUtils.ts` para cargar primero el build browser-min (`exceljs/dist/exceljs.min.js`) y evitar crecimiento innecesario del bundle principal.

## Ejemplo

```ts
import { getForDate } from '@/services/repositories/dailyRecordRepositoryReadService';
import { saveDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';

const record = await getForDate(date);
await saveDetailed(record);
```

## Convención de capa

- No importar componentes ni hooks de UI desde `services`.
- Mantener contratos de entrada/salida tipados (preferir `types`/`schemas`).
- `src/services/repositories/index.ts` fue retirado; código nuevo debe entrar por módulos dueños o ports explícitos.
- En integraciones externas complejas, usar una fachada pública pequeña y mover auth, payload builders y folder/file helpers a módulos internos específicos.
- Consumir auth desde entrypoints canónicos (`authFlow.ts`, `authSession.ts`, `authFallback.ts`, `authPolicy.ts`) en vez de reintroducir una fachada única.
- Mantener `authPolicy.ts` estable y preferir módulos dueños específicos cuando el flujo requiera login, sesión o fallback.
