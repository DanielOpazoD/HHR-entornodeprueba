# Arquitectura del Sistema - Diagrama de Flujo de Datos

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
        LS[localStorage]
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

    DRR --> LS
    DRR --> FS
    CR --> LS
    CR --> FS

    LS -.->|migration| IDB
```

---

## Flujo de Sincronización en Tiempo Real

```mermaid
sequenceDiagram
    participant UI as UI Component
    participant Hook as useDailyRecordSync
    participant Repo as DailyRecordRepository
    participant LS as localStorage
    participant FS as Firestore

    Note over UI,FS: Guardar Cambios
    UI->>Hook: updatePatient(data)
    Hook->>Repo: save(record)
    Repo->>LS: saveRecordLocal()
    Repo->>FS: saveToFirestore()
    FS-->>Repo: ✅ Saved

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
