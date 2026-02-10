# 🏥 Hospital Hanga Roa - Sistema de Gestión Clínica

[![CI Status](https://img.shields.io/badge/Tests-1345%20passing-brightgreen)](./tests)
[![React](https://img.shields.io/badge/React-19.2-61DAFB?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![Firebase](https://img.shields.io/badge/Firebase-12.6-FFCA28?logo=firebase)](https://firebase.google.com)
[![TanStack Query](https://img.shields.io/badge/TanStack_Query-5.x-FF4154)](https://tanstack.com/query)

Sistema integral de gestión hospitalaria para el **Hospital Hanga Roa** de Isla de Pascua, Chile. Desarrollado con React, TypeScript, Firebase y TanStack Query.

---

## 🚀 Características Principales

| Módulo | Descripción |
|--------|-------------|
| **📋 Censo Diario** | Registro en tiempo real de pacientes con 26 camas + extras. Automatización de envío de reportes. |
| **🏥 CUDYR** | Categorización de dependencia con scoring automático (Turno Noche). |
| **🔄 Entrega de Turno** | Handoff digital de enfermería y médico con firmas y respaldo automático. |
| **📊 Reportes** | Ventanilla única de exportación con sincronización inmediata a la nube. |
| **📱 Modo Offline** | Sincronización híbrida via TanStack Query e IndexedDB (Dexie). |
| **📝 Auditoría** | Trazabilidad completa de acciones clínicas inmutables. |
| **💬 WhatsApp** | Bot de notificaciones automáticas para comunicación de turno. |
| **🧬 HL7 FHIR** | Soporte nativo para interoperabilidad vía recursos FHIR (Core-CL). |
| **☁️ Backup** | Respaldo automático de documentos críticos en Firebase Storage. |

---

## 🏗️ Arquitectura

```mermaid
flowchart TB
    subgraph Cliente["🖥️ Cliente React"]
        UI[Vistas & Componentes]
        TQ[TanStack Query Cache]
        CTX[React Contexts]
        IDB[(IndexedDB / Dexie)]
    end
    
    subgraph Firebase["☁️ Firebase"]
        FS[(Firestore)]
        AUTH[Firebase Auth]
        STORAGE[Cloud Storage]
    end
    
    subgraph Serverless["⚡ Netlify Functions"]
        EMAIL[Gmail API]
        WA[WhatsApp Proxy]
    end
    
    UI --> CTX --> TQ
    TQ <--> IDB
    TQ <-->|Real-time Sync| FS
    UI --> AUTH
    UI --> EMAIL
    UI --> WA
    UI --> STORAGE
```

### Flujo de Datos
```
Usuario → View → Context → TanStack Query → Repository → Firebase/IndexedDB
                    ↓              ↓              ↓
                 Estado      Optimistic      Validación Zod
                 Global        Updates
```

---

## 📁 Estructura del Proyecto (src/)

```
├── components/              # Componentes React (Censo, Layout, Modales)
├── features/                # Módulos por funcionalidad (CUDYR, Handoff, Analytics)
├── core/                    # Núcleo del sistema (@core/ui, Auth)
├── domain/                  # Lógica de negocio pura (CensusManager)
├── hooks/                   # Hooks transversales (Query, UI, Validation)
├── services/                # Infraestructura y repositorios
├── context/                 # Estado global compartido
├── constants/               # Configuración estática y mapas
├── schemas/                 # Esquemas de validación Zod
├── types/                   # Definiciones TypeScript
├── utils/                   # Utilidades puras y helpers
└── tests/                   # 1350+ tests (Vitest + Playwright)
```

---

## 🛠️ Stack Tecnológico

| Categoría | Tecnología | Propósito |
|-----------|------------|-----------|
| **Frontend** | React 19.2 | UI declarativa |
| **State Management** | TanStack Query 5 | Cache, sync, optimistic updates |
| **Language** | TypeScript 5.8 | Type safety |
| **Build** | Vite 6.4 | Fast bundling, HMR |
| **Database** | Firestore + IndexedDB | Cloud + Offline persistence |
| **Auth** | Firebase Auth | Google Sign-In |
| **Storage** | Firebase Storage | PDFs y Excels de backup |
| **Validation** | Zod 3.25 | Runtime type checking |
| **Testing** | Vitest + Playwright | Unit, Integration, E2E |
| **Styling** | Vanilla CSS + Tailwind | Design tokens system |
| **Deployment** | Netlify | Auto-deploy + Serverless Functions |

---

## 🏃‍♂️ Inicio Rápido

### Requisitos
- Node.js **20.x** o superior
- npm **9.x** o superior

### Instalación

```bash
# Clonar repositorio
git clone https://github.com/DanielOpazoD/HHR-entornodeprueba.git
cd HHR-entornodeprueba

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales de Firebase
```

### Desarrollo

```bash
npm run dev          # Servidor de desarrollo (http://localhost:3000)
npm run build        # Build de producción
npm run preview      # Preview del build
```

### Testing

```bash
npm test             # Ejecutar todos los tests (1350+)
npm test -- --watch  # Modo watch
npm run test:e2e     # Tests E2E con Playwright
```

---

## 🔐 Roles y Permisos

| Rol | Acceso |
|-----|--------|
| **Admin** | Acceso total, configuración, auditoría, gestión de personal |
| **Enfermera Hospital** | Editar Censo, CUDYR, Entrega de Enfermería |
| **Médico** | Entrega Médica, Vista de Censo (solo lectura) |
| **Viewer** | Solo lectura del Censo |

---

## 📊 Estado del Proyecto

| Métrica | Valor |
|---------|-------|
| Tests Pasando | **1340** |
| Cobertura de Código | ~72% |
| Lighthouse Performance | 92 |
| Build Size (Gzip) | ~450kb |

---

## 📚 Documentación Adicional

- [Arquitectura Detallada](./ARCHITECTURE.md)
- [Guía de Contribución](./CONTRIBUTING.md)
- [Changelog](./CHANGELOG.md)
- [Estado del Proyecto](./PROJECT_STATUS.md)
- [Testing Guide](./docs/testing/README.md)
- [WhatsApp Deployment](./docs/whatsapp-deployment.md)

---

## 📝 Variables de Entorno

```env
# Firebase (requerido)
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

# Gmail API (opcional, para envío de censo)
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...

# WhatsApp Bot (opcional)
VITE_WHATSAPP_BOT_URL=...
```

---

## 👥 Equipo

**Desarrollador Principal**: Dr. Daniel Opazo  
**Email**: daniel.opazo@hospitalhangaroa.cl  
**Ubicación**: Hospital Hanga Roa, Isla de Pascua, Chile

---

## 📝 Licencia

Propiedad del Hospital Hanga Roa. Uso privado e institucional.

---

*Última actualización: 08 de Febrero 2026*
