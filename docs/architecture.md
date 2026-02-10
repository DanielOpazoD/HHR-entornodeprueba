# Arquitectura del Sistema - Diagrama de Flujo de Datos

Resumen ejecutivo: ver `ARCHITECTURE.md`.

## Stack Tecnologico (resumen)

| Capa | Tecnologia | Version |
|------|------------|---------|
| **UI** | React | 19.2.1 |
| **Language** | TypeScript | 5.8.2 |
| **Build** | Vite | 6.2.0 |
| **State Management** | TanStack Query | 5.90.12 |
| **Local Storage** | IndexedDB (Dexie.js) | 4.2.1 |
| **Validation** | Zod | 3.25.76 |

## Principios y Objetivos

- **Offline-first**: la aplicación debe funcionar sin red; IndexedDB es el almacenamiento primario local.
- **Integridad clínica**: validación estricta con Zod antes de persistir y guardas contra regresión masiva.
- **Sincronización segura**: actualizaciones parciales con LWW por celda y control de concurrencia optimista.
- **Recuperación automática**: tolerancia a fallas de IndexedDB y Firestore con degradación controlada.
- **Observabilidad local**: métricas y logs almacenados localmente para diagnóstico sin internet.

## Modelo de Consistencia y Concurrencia

- **Fuente primaria local**: la UI lee/escribe primero en IndexedDB.
- **Sincronización remota**: Firestore se actualiza en segundo plano.
- **Concurrencia optimista**: en guardado completo se usa `expectedLastUpdated` para evitar pisar cambios remotos recientes.
- **LWW por celda**: los updates parciales se aplanan a dot-notation y se aplican de forma granular.
- **Cola de sincronización**: cambios locales se encolan con backoff y deduplicación para evitar sobrecarga.

## Modos de Falla y Recuperación

- **Firestore offline**: la app continúa en modo local; se reintenta la sincronización al recuperar red.
- **IndexedDB corrupto/bloqueado**: se intenta auto-recuperación y, si falla, se cae a modo memoria (con pérdida al recargar).
- **Datos heredados**: al leer se ejecuta migración suave + defaults; al guardar, validación estricta.
- **Storage inconsistente**: lecturas de localStorage se validan/parsean con fallback para evitar crashes por JSON corrupto.

## Versionado y Migraciones

- **Schema versioning**: cada registro incluye `schemaVersion`.
- **Migración de legacy**: se aplican ajustes de compatibilidad antes de usar un registro antiguo.
- **Bloqueo por versión**: si el remoto usa una versión mayor, se aborta el guardado local.

## Observabilidad

- **Logs de error**: guardados localmente para diagnóstico offline.
- **Auditoría**: cambios críticos se registran de forma inmutable y con trazabilidad por usuario.
- **Salud del sistema**: métricas de pendientes (incluye cola de sync) expuestas al panel admin.

Ejemplos:
- Log de error: `{ level: "error", scope: "storage", message: "IndexedDB blocked", at: "2026-01-31T10:12:03Z" }`
- Metrica de salud: `{ pendingMutations: 3, pendingSyncTasks: 2, lastSyncAt: "2026-01-31T10:15:00Z" }`

```mermaid
flowchart LR
    subgraph Runtime["Runtime"]
        Err[Error Logs]
        Sync[Sync Queue Stats]
    end

    subgraph Storage["Local Storage"]
        IDB[(IndexedDB)]
    end

    subgraph Admin["Admin UI"]
        Health[System Health Panel]
    end

    Err --> IDB
    Sync --> IDB
    IDB --> Health
```

## Como leer esta arquitectura (para novatos)

1) Empieza por "Flujos Criticos" para entender que pasa cuando se guarda o edita.
2) Ubica la capa donde ocurre cada cosa (UI, Hooks, Repos, Storage).
3) Aprende los contratos de datos para evitar errores al mover datos.
4) Revisa "Principios y Objetivos" para estabilidad y seguridad.
5) Si algo falla, revisa "Observabilidad" para diagnostico.

---

## Mapa de Módulos (Nivel Alto)

```mermaid
flowchart TB
    subgraph UI["UI / Views"]
        CensusView
        HandoffView
        AnalyticsView
    end

    subgraph State["State Layer"]
        Contexts
        Hooks
    end

    subgraph Domain["Domain / Reglas Puras"]
        CensusManager["CensusManager (Class)"]
        Validators["Zod Schemas"]
        Invariants["Record Invariants"]
    end

    subgraph Data["Data Access"]
        Repos["Repositories"]
        Services["Storage Services"]
        SyncQ["Sync Queue"]
    end

    subgraph Persistence["Persistence"]
        IDB[(IndexedDB)]
        FS[(Firestore)]
        LS[(localStorage)]
    end

    UI --> Contexts --> Hooks
    Hooks --> Validators
    Hooks --> Invariants
    Hooks --> Calculators
    Hooks --> Repos
    Repos --> Services
    Services --> SyncQ
    Services --> IDB
    Services --> FS
    Services --> LS
```

---

## Flujos Críticos

### Guardado completo de DailyRecord (online/offline)

```mermaid
sequenceDiagram
    participant UI
    participant Hook
    participant Repo
    participant Invariants
    participant IDB
    participant SyncQ
    participant FS

    UI->>Hook: save(record)
    Hook->>Invariants: normalize(record)
    Invariants-->>Hook: normalizedRecord
    Hook->>Repo: save(normalizedRecord)
    Repo->>IDB: saveRecord()
    Repo->>SyncQ: queueSyncTask(save)
    alt Online
        SyncQ->>FS: saveToFirestore()
        FS-->>SyncQ: ok
    else Offline
        SyncQ-->>Repo: scheduled for retry
    end
```

### Update parcial (LWW por celda)

```mermaid
sequenceDiagram
    participant UI
    participant Hook
    participant Repo
    participant IDB
    participant SyncQ
    participant FS

    UI->>Hook: patch(path, value)
    Hook->>Repo: updatePartial(patch)
    Repo->>IDB: applyPatchLocal()
    Repo->>SyncQ: queueSyncTask(patch)
    SyncQ->>FS: applyPatchRemote()
```

### Lectura de record (con migración suave)

```mermaid
sequenceDiagram
    participant UI
    participant Hook
    participant Repo
    participant IDB
    participant FS

    UI->>Hook: load(date)
    Hook->>Repo: getForDate(date)
    Repo->>IDB: readRecord()
    alt No record local
        Repo->>FS: fetchRecord()
    end
    Repo-->>Hook: migrated + validated record
```

## Flujo General de Datos

```mermaid
flowchart TB
    subgraph UI["🖥️ UI Components"]
        CV[CensusView]
        CT[CensusTable]
        NS[NurseSelector]
        TS[TensSelector]
        DS[DischargesSection]
    end

    subgraph Contexts["📦 Context Providers"]
        DRC[DailyRecordContext]
        SC[StaffContext]
        CAC[CensusActionsContext]
    end

    subgraph Hooks["🪝 Custom Hooks"]
        UDR[useDailyRecord]
        UDRS[useDailyRecordSync]
        UNM[useNurseManagement]
    end

    subgraph Repository["📚 Repository Layer"]
        DRR[DailyRecordRepository]
        CR[CatalogRepository]
    end

    subgraph Storage["💾 Storage Layer"]
        IDB[(IndexedDB)]
        FS[(Firestore)]
    end

    CV --> DRC
    CV --> SC
    CT --> CAC
    NS --> SC
    TS --> SC

    DRC --> UDR
    SC --> CR

    UDR --> UDRS
    UDR --> UNM

    UDRS --> DRR
    UNM --> DRR

    DRR --> IDB
    DRR --> FS
    CR --> IDB
    CR --> FS
```

---

## Flujo de Sincronización en Tiempo Real

```mermaid
sequenceDiagram
    participant UI as UI Component
    participant Hook as useDailyRecordQuery
    participant Repo as DailyRecordRepository
    participant IDB as IndexedDB
    participant SyncQ as SyncQueue
    participant FS as Firestore

    Note over UI,FS: Guardar Cambios
    UI->>Hook: mutation.mutate(data)
    Hook->>Repo: save(record)
    Repo->>IDB: saveRecordLocal()
    Repo->>SyncQ: queueSyncTask(save)
    SyncQ->>FS: saveToFirestore()
    FS-->>SyncQ: ✅ Saved

    Note over UI,FS: Recibir Cambios (Otro Browser)
    FS-->>Repo: onSnapshot(newData)
    Repo-->>Hook: callback(record)
    Hook-->>UI: setRecord(record)
```

---

## Estructura de Capas

```mermaid
graph TB
    subgraph Presentation["Presentación"]
        V1[Views]
        C1[Components]
    end

    subgraph State["Estado"]
        CTX[Contexts]
        HK[Hooks]
    end

    subgraph Data["Acceso a Datos"]
        RP[Repositories]
        SVC[Services]
    end

    subgraph Persistence["Persistencia"]
        LOCAL[localStorage/IndexedDB]
        REMOTE[Firestore]
    end

    V1 --> CTX
    C1 --> CTX
    CTX --> HK
    HK --> RP
    RP --> SVC
    SVC --> LOCAL
    SVC --> REMOTE

    style Presentation fill:#e1f5fe
    style State fill:#fff3e0
    style Data fill:#e8f5e9
    style Persistence fill:#fce4ec
```

---

## Interfaces entre Capas (Reglas de Dependencia)

- **UI/Views**: solo usa Hooks y Contexts (sin acceso directo a storage).
- **Hooks**: coordinan lógica y llaman Repos/Services, no a IndexedDB/Firestore directo.
- **Repositorios**: encapsulan persistencia y reglas de dominio (invariantes + validación).
- **Storage Services**: únicos responsables de IndexedDB/Firestore/localStorage.
- **Infraestructura DB**: acceso abstracto a base de datos (FirestoreProvider).

---

## Flujo de Catálogos (Enfermeras/TENS)

```mermaid
flowchart LR
    subgraph UI["UI"]
        NM[NurseManagerModal]
        TM[TensManagerModal]
    end

    subgraph Context["StaffContext"]
        NL[nursesList]
        TL[tensList]
    end

    subgraph Repo["CatalogRepository"]
        GN[getNurses]
        SN[saveNurses]
        SUN[subscribeNurses]
    end

    subgraph Storage["Storage"]
        LS[localStorage]
        FS[(Firestore)]
    end

    NM -->|setNursesList| NL
    TM -->|setTensList| TL

    NL -->|save| SN
    TL -->|save| Repo

    SN --> LS
    SN --> FS

    FS -->|realtime| SUN
    SUN -->|callback| NL
    SUN -->|callback| TL
```

---

## Error Boundaries

```mermaid
flowchart TB
    subgraph CensusView["CensusView"]
        EB1[SectionErrorBoundary]
        EB2[SectionErrorBoundary]
        EB3[SectionErrorBoundary]
        EB4[SectionErrorBoundary]

        CT[CensusTable]
        DS[DischargesSection]
        TS[TransfersSection]
        CMA[CMASection]
    end

    EB1 --> CT
    EB2 --> DS
    EB3 --> TS
    EB4 --> CMA

    CT -->|error| EB1
    EB1 -->|catch| ERR1[/"Error aislado"/]

    style ERR1 fill:#ffcdd2
```

---

## Archivos Clave por Capa

| Capa | Archivos |
|------|----------|
| **Views** | `CensusView.tsx`, `AnalyticsView.tsx`, `HandoffView.tsx` |
| **Contexts** | `DailyRecordContext.tsx`, `StaffContext.tsx`, `AuthContext.tsx` |
| **Hooks** | `useDailyRecord.ts`, `useMinsalStats.ts`, `useHandoffLogic.ts` |
| **Repositories** | `DailyRecordRepository.ts`, `PatientHistoryRepository.ts` |
| **Services** | `firestoreService.ts`, `indexedDBService.ts`, `pdfStorageService.ts` |
| **Storage** | IndexedDB (Dexie), Firestore, Cloud Storage |

---

## Contratos de Datos (Resumen)

### DailyRecord (resumen)

- `date`: ISO `YYYY-MM-DD` (único por día).
- `beds`: mapa fijo de camas definidas en catálogo.
- `activeExtraBeds`: subconjunto de beds válidas.
- `patients`: lista de pacientes con `id` único y campos validados.
- `lastUpdated`/`schemaVersion`: metadatos para control de concurrencia y migraciones.

### Patch de actualización parcial

- `path`: dot-notation sobre DailyRecord (ej: `beds.C1.patient.name`).
- `value`: valor serializable.
- `lastUpdated`: timestamp local para LWW por celda.

### SyncTask (cola de sync)

- `type`: `save` | `patch` | `delete`.
- `key`: clave lógica (ej: `dailyRecord:2025-01-01`).
- `status`: `pending` | `processing` | `failed`.
- `attempts`/`nextAttemptAt`: control de reintentos con backoff.

---

## Checklist de Consistencia (con ARCHITECTURE.md)

- Principios: offline-first, integridad clinica, concurrencia, recuperacion.
- Capas: UI -> Contexts/Hooks -> Repos -> Storage.
- Flujos criticos: save completo, patch parcial, lectura con migracion suave.
- Contratos: DailyRecord, Patch, SyncTask.
- Observabilidad: logs/health/pending sync.
- Stack: versiones en `ARCHITECTURE.md` coinciden con `package.json`.
