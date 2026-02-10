# Arquitectura del Sistema HHR

Sistema de gestión de censo diario de pacientes hospitalizados para el Hospital Hanga Roa.

---

## 🏗️ Diagrama de Alto Nivel

```mermaid
flowchart TB
    subgraph Browser["🌐 Navegador"]
        direction TB
        UI["React Views<br/>(Census, Handoff, CUDYR)"]
        CTX["React Contexts<br/>(Auth, UI, DailyRecord)"]
        TQ["TanStack Query<br/>(Cache & Sync)"]
        IDB[("IndexedDB<br/>(Dexie.js)")]
    end
    
    subgraph Firebase["☁️ Firebase"]
        FS[("Firestore<br/>Real-time DB")]
        AUTH["Firebase Auth"]
        STORAGE["Cloud Storage<br/>(PDFs, Excels)"]
    end
    
    subgraph Serverless["⚡ Netlify Functions"]
        GMAIL["Gmail API<br/>(Censo Email)"]
        WAPROXY["WhatsApp Proxy"]
    end
    
    subgraph External["🔗 Externos"]
        WABOT["WhatsApp Bot<br/>(Railway)"]
    end
    
    UI --> CTX --> TQ
    TQ <-->|Optimistic Updates| IDB
    TQ <-->|Real-time Subscriptions| FS
    UI --> AUTH
    UI --> STORAGE
    UI --> GMAIL
    GMAIL --> |SMTP| Email((📧 Destinatarios))
    UI --> WAPROXY --> WABOT --> WA((💬 WhatsApp))
```

---

## ✅ Enfoque de Estabilidad

- **Offline-first:** IndexedDB como almacenamiento primario y Firestore como sync remoto.
- **Integridad clínica:** validación estricta con Zod + guardas de regresión.
- **Concurrencia segura:** control optimista y updates parciales por celda (LWW).
- **Recuperación:** auto-repair de IndexedDB y fallback controlado.
- **Observabilidad local:** métricas y logs guardados localmente para diagnóstico offline.
- **Cola de sync:** cambios encolados con deduplicación y backoff.

Para más detalle de flujos y decisiones, ver `docs/architecture.md`.
Para resumen ejecutivo y stack, ver este documento.

---

## 📦 Stack Tecnológico

| Capa | Tecnología | Versión |
|------|------------|---------|
| **UI** | React | 19.2.1 |
| **Language** | TypeScript | 5.8.2 |
| **Build** | Vite | 6.2.0 |
| **State Management** | TanStack Query | 5.90.12 |
| **Styling** | Vanilla CSS | - |
| **Database** | Firestore | 12.6.0 |
| **Local Storage** | IndexedDB (Dexie.js) | 4.2.1 |
| **Auth** | Firebase Auth | 12.6.0 |
| **Validation** | Zod | 3.25.76 |
| **Testing** | Vitest + Playwright | 4.0.15 / 1.57.0 |
| **Hosting** | Netlify | - |

---

## 🗂️ Estructura de Directorios (src/)

```
src/
├── components/                 # Componentes UI (Layout, Census, Shared)
├── features/                   # Módulos por funcionalidad
│   ├── admin/                  # Auditoría, Configuración, Salud del Sistema
│   ├── analytics/              # Estadísticas MINSAL, gráficos
│   ├── census/                 # Gestión de camas y pacientes
│   ├── cudyr/                  # Scoring de dependencia y categorización
│   ├── handoff/                # Entrega de Turno (Enfermería/Médica)
│   ├── whatsapp/               # Integración con bot de notificaciones
│   └── errors/                 # Monitoreo de errores en runtime
│
├── core/                       # Núcleo técnico
│   ├── ui/                     # Sistema de Diseño (@core/ui) - Botones, Modales, Inputs
│   └── auth/                   # Lógica de Autenticación
│
├── domain/                     # Lógica de Negocio Pura (Agnóstica de Framework)
│   └── CensusManager.ts        # Reglas de movimiento, alta y egreso
│
├── services/                   # Infraestructura y Persistencia
│   ├── repositories/           # Patrón Repository para Firestore/IDB
│   ├── storage/                # Implementación de persistencia física
│   ├── backup/                 # Gestión de respaldos en la nube
│   └── pdf/                    # Generación dinámica de documentos
│
├── context/                    # Estado Global (Shared Contexts)
├── hooks/                      # Hooks transversales (Query, UI, Validation)
├── schemas/                    # Validación Zod (Seguridad en runtime)
├── types/                      # Definiciones de tipos del dominio
├── utils/                      # Helpers y utilidades técnicas
└── tests/                      # Suite de tests automatizados (>1350)
```

---

## 🔄 Flujo de Datos

```mermaid
sequenceDiagram
    participant U as Usuario
    participant V as View
    participant C as Context
    participant TQ as TanStack Query
    participant R as Repository
    participant IDB as IndexedDB
    participant FS as Firestore

    U->>V: Acción (ej: Editar paciente)
    V->>C: Dispatch action
    C->>TQ: mutate()
    
    Note over TQ: Optimistic Update
    TQ->>IDB: Guardar local (inmediato)
    TQ-->>V: UI actualizada
    
    TQ->>R: Sync remoto
    R->>FS: setDoc()
    FS-->>R: Confirmación
    R-->>TQ: onSettled()
    
    alt Error de red
        TQ->>TQ: Rollback
        TQ-->>V: Restaurar estado previo
    end
```

---

## ⚡ Flujos Críticos (Resumen)

### Guardado completo (online/offline)

```mermaid
sequenceDiagram
    participant UI
    participant Hook
    participant Repo
    participant IDB
    participant SyncQ
    participant FS

    UI->>Hook: save(record)
    Hook->>Repo: save()
    Repo->>IDB: saveRecord()
    Repo->>SyncQ: queueSyncTask(save)
    alt Online
        SyncQ->>FS: saveToFirestore()
        FS-->>SyncQ: ok
    else Offline
        SyncQ-->>Repo: scheduled retry
    end
```

### Patch parcial (LWW)

```mermaid
sequenceDiagram
    participant UI
    participant Hook
    participant Repo
    participant IDB
    participant SyncQ
    participant FS

    UI->>Hook: patch(path, value)
    Hook->>Repo: updatePartial()
    Repo->>IDB: applyPatchLocal()
    Repo->>SyncQ: queueSyncTask(patch)
    SyncQ->>FS: applyPatchRemote()
```

### Lectura (con migración suave)

```mermaid
sequenceDiagram
    participant UI
    participant Hook
    participant Repo
    participant IDB
    participant FS

    UI->>Hook: load(date)
    Hook->>Repo: getForDate()
    Repo->>IDB: readRecord()
    alt No local
        Repo->>FS: fetchRecord()
    end
    Repo-->>Hook: migrated + validated
```

---

## 🧩 Contratos de Datos (Resumen)

- **DailyRecord:** `date` ISO, `beds` fijo por catálogo, `activeExtraBeds` coherente, `patients` con `id` único.
- **Patch parcial:** `path` en dot-notation, `value` serializable, `lastUpdated` para LWW.
- **SyncTask:** `type`, `key`, `status`, `attempts`, `nextAttemptAt`.

---

## 🧭 Cómo leer esta arquitectura (para novatos)

1) **Empieza por el flujo de datos**: mira “Flujo de Datos” y “Flujos Críticos” para entender qué pasa cuando el usuario guarda o edita.
2) **Ubica la capa donde ocurre cada cosa**: UI/Views dispara acciones, Hooks coordinan, Repositories persisten, Storage escribe/lee.
3) **Aprende los contratos de datos**: estos “acuerdos” evitan errores al mover datos entre capas.
4) **Revisa estabilidad y seguridad**: mira “Enfoque de Estabilidad” y “Seguridad” para entender por qué el sistema no se cae y protege datos.
5) **Si algo falla**: busca en “Observabilidad” y “Flujos Críticos” para ubicar el punto de diagnóstico.

---

## ✅ Checklist de Consistencia (ARCHITECTURE vs docs/architecture)

- **Principios**: offline-first, integridad clínica, concurrencia, recuperación.
- **Capas**: UI → Contexts/Hooks → Repos → Storage.
- **Flujos críticos**: save completo, patch parcial, lectura con migración suave.
- **Contratos**: DailyRecord, Patch, SyncTask alineados.
- **Observabilidad**: logs/health/pending sync reflejados en ambos documentos.
- **Stack**: versiones en `ARCHITECTURE.md` coinciden con `package.json`.

---

## 🧱 Patrones de Diseño

### 1. Repository Pattern
Abstrae la complejidad de elegir entre almacenamiento local (IDB) o remoto (Firestore).
```typescript
import { DailyRecordRepository } from '@/services/repositories/DailyRecordRepository';
const record = await DailyRecordRepository.getForDate('2026-01-08');
```

### 2. Export & Backup Manager
Manejador centralizado para la generación de documentos y su respaldo automático en la nube.
```typescript
const { handleBackupHandoff } = useExportManager();
// Gatilla PDF local + Backup Cloud automáticamente
```

### 3. TanStack Query Hooks
Gestiona el ciclo de vida de los datos, revalidación y estados de carga.
```typescript
const { data } = useDailyRecordQuery(dateString);
const mutation = useSaveDailyRecordMutation();
```

### 4. Interoperabilidad (HL7 FHIR)
Utiliza transformadores para convertir datos del dominio HHR a recursos estándar FHIR R4 (Core-CL).
```typescript
import { mapPatientToFhir } from '@/services/utils/fhirMappers';
const fhirPatient = mapPatientToFhir(localPatient);
```

---

## 🔐 Seguridad

- **RBAC:** Control de acceso en `utils/permissions.ts`.
- **Validation:** Validación estricta con Zod antes de persistir cualquier dato.
- **Auditoría:** Registro inmutable de cada cambio crítico en el sistema.

---

*Última actualización: 08 de Febrero 2026*
