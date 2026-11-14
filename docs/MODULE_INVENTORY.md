# Inventario Inicial de Módulos del Programa

## Propósito

Este inventario organiza los módulos reales del programa según la estructura del repo y el uso funcional visible.

No todos tienen el mismo peso. Por eso se separan en:

- módulos clínico-operativos principales
- submódulos relevantes
- módulos de soporte transversal

---

## A. Módulos clínico-operativos principales

Estos son los módulos que más sentido tiene evaluar uno por uno primero.

### 1. Documentos clínicos

- **Feature principal:** [src/features/clinical-documents](../src/features/clinical-documents)
- **Application:** [src/application/clinical-documents](../src/application/clinical-documents)
- Incluye:
  - editor rico
  - plantillas
  - autosave
  - sync remoto
  - impresión / PDF
  - anexos
  - IEEH

### 2. Censo diario

- **Feature principal:** [src/features/census](../src/features/census)
- **Application relacionada:** [src/application/census](../src/application/census), [src/application/daily-record](../src/application/daily-record), [src/application/patient-flow](../src/application/patient-flow)
- Incluye:
  - tabla principal
  - ingreso / traslado / egreso
  - edición por cama
  - movimientos
  - día clínico
  - sincronización de daily record

### 3. Entrega de turno médico

- **Feature principal:** [src/features/handoff](../src/features/handoff)
- **Application relacionada:** [src/application/handoff](../src/application/handoff)
- Incluye:
  - handoff médico general
  - observaciones médicas
  - especialidades
  - impresión / compartir
  - integración con CUDYR

### 4. Entrega de turno enfermería

- **Feature principal:** [src/features/handoff](../src/features/handoff)
- Submódulo hermano del handoff médico.
- Incluye:
  - checklist de turno
  - contenido de enfermería
  - persistencia y visibilidad propias

### 5. Gestión de traslados

- **Feature principal:** [src/features/census](../src/features/census) (`TransfersSection` y controllers `censusTransfer*`)
- **Modal:** [src/components/modals/actions/TransferModal.tsx](../src/components/modals/actions/TransferModal.tsx)
- Incluye:
  - solicitudes
  - estados del traslado
  - feedback
  - paquetes documentales

### 6. Solicitud de exámenes de laboratorio

- Parte importante del frente de laboratorio.
- Zonas probables:
  - [src/features/laboratory](../src/features/laboratory)
  - hooks y componentes de request modal
  - integración desde documentos clínicos y/o censo

### 7. Solicitud de imágenes

- Frente relacionado con exámenes / imágenes / MMRAD.
- Suele estar repartido entre:
  - componentes de solicitud
  - documentos clínicos
  - servicios de visualización / copiado

### 8. Visualizador de exámenes de laboratorio

- **Feature principal:** [src/features/laboratory](../src/features/laboratory)
- Incluye:
  - comparación
  - tendencias
  - microbiología
  - fallback PDF

### 9. Visualizador de exámenes MMRAD

- Frente compartido entre documentos clínicos, modal radiológico y servicios de radiología.
- Relevante como módulo por su lógica propia de lectura, copiado y visualización.

### 10. Auditoría

- **Feature principal:** [src/features/admin](../src/features/admin)
- **Application:** [src/application/audit](../src/application/audit)
- **Hooks relacionadas:** `useAudit*`
- Incluye:
  - lectura de eventos
  - estadísticas
  - workers de auditoría

### 11. Sección de búsqueda

- Búsqueda global de pacientes y navegación a censo / episodio / módulos asociados.
- Parte repartida entre census, hooks globales y controladores de navegación.

### 12. CUDYR

- **Feature principal:** [src/features/cudyr](../src/features/cudyr)
- **Dominio:** [src/domain/cudyr](../src/domain/cudyr)
- Módulo suficientemente grande e importante para evaluarse por separado.

---

## B. Submódulos clínico-operativos relevantes

Estos tal vez no ameriten evaluación independiente al principio, pero sí deben mapearse.

### 13. Correo de censo

- **Application:** [src/application/census-email](../src/application/census-email)
- **Hooks:** `useCensusEmail*`

### 14. Copias, backups y archivos compartidos

- **Feature:** [src/features/backup](../src/features/backup)
- **Application:** [src/application/backup-export](../src/application/backup-export)

### 15. Recordatorios

- **Feature:** [src/features/reminders](../src/features/reminders)
- **Application:** [src/application/reminders](../src/application/reminders)

### 16. WhatsApp / compartir

- **Feature:** [src/features/whatsapp](../src/features/whatsapp)
- También se cruza con handoff y entrega de información.

### 17. Analítica y paneles administrativos

- **Feature:** [src/features/analytics](../src/features/analytics)
- Complementa auditoría y monitoreo.

---

## C. Módulos de soporte transversal

Estos no son “módulos de negocio” en sentido estricto, pero sí conviene evaluarlos cuando toque calidad de cimientos.

### 18. Autenticación y sesión

- **Feature:** [src/features/auth](../src/features/auth)
- **Application:** [src/application/auth](../src/application/auth)

### 19. Firestore / persistencia / reglas

- Repositorios, ports, adapters y [firestore.rules](../firestore.rules)
- No es un módulo funcional visible, pero sí un frente crítico transversal.

### 20. Patient flow / episodio clínico

- **Application:** [src/application/patient-flow](../src/application/patient-flow)
- Base conceptual para censo, búsqueda, traslados y continuidad clínica.

---

## D. Correspondencia con tu lista inicial

Tu lista estaba muy bien orientada. Correspondencia rápida:

- **Documentos clínicos** → sí, módulo principal
- **Censo diario** → sí, módulo principal
- **Entrega de turno enfermería** → sí, submódulo principal dentro de handoff
- **Entrega de turno médico** → sí, submódulo principal dentro de handoff
- **Gestión de traslados** → sí, módulo principal
- **Solicitud de exámenes laboratorio** → sí, frente funcional relevante
- **Solicitud de imágenes** → sí, frente funcional relevante
- **Visualizador de exámenes de laboratorio** → sí, módulo principal dentro de laboratory
- **Visualizador de exámenes MMRAD** → sí, frente relevante
- **Auditoría** → sí, módulo principal
- **Sección de búsqueda** → sí, módulo relevante

Lo que yo agregaría a tu mapa principal:

- **CUDYR**
- **Correo de censo**
- **Backups / archivos**
- **Autenticación y sesión**
- **Patient flow / episodio clínico**

---

## E. Orden sugerido de evaluación

Para ir módulo por módulo sin dispersarse, este orden tiene sentido:

1. Documentos clínicos
2. Censo diario
3. Entrega de turno médico
4. Entrega de turno enfermería
5. Gestión de traslados
6. CUDYR
7. Visualizador de laboratorio
8. Solicitud de exámenes de laboratorio
9. Solicitud de imágenes
10. Visualizador MMRAD
11. Sección de búsqueda
12. Auditoría
13. Correo de censo
14. Backups / archivos
15. Autenticación y sesión

---

## F. Criterio práctico

Para decidir si algo es “módulo” o solo “subparte”, usar esta regla:

Un módulo merece evaluación propia si cumple al menos dos:

- tiene carpeta/feature claramente identificable
- tiene reglas de negocio propias
- tiene tests o controllers propios
- tiene UX o flujo operativo reconocible
- una regresión ahí impacta de forma visible al usuario
