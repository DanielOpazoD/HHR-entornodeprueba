# 🔥 Política de Entornos Firebase

## ⚠️ DECLARACIÓN DE PRINCIPIOS

Este proyecto (**HHR-entornoprueba**) es un **entorno beta/staging** que opera bajo las siguientes reglas estrictas:

---

## 🧪 ENTORNO BETA: `hhr-pruebas`

| Atributo | Valor |
|----------|-------|
| **Project ID** | `hhr-pruebas` |
| **Lectura** | ✅ Permitido |
| **Escritura** | ✅ Permitido |
| **Eliminación** | ✅ Permitido |

Este es el entorno donde se guardan todos los cambios realizados desde este proyecto.
Es seguro experimentar, probar nuevas funcionalidades y modificar datos.

---

## 🏥 ENTORNO PRODUCCIÓN: `hospital-hanga-roa`

| Atributo | Valor |
|----------|-------|
| **Project ID** | `hospital-hanga-roa` |
| **Lectura** | ✅ Permitido |
| **Escritura** | ⛔ **PROHIBIDO** |
| **Eliminación** | ⛔ **PROHIBIDO** |

Este es el entorno oficial con datos reales del Hospital Hanga Roa.
Desde este modo beta, **solo se puede leer y copiar información**, nunca modificar.

---

## 📊 Flujo de Datos

```
┌─────────────────────────────────────┐
│   hospital-hanga-roa (PRODUCCIÓN)   │
│   ─────────────────────────────     │
│   Datos oficiales del hospital      │
│   ⛔ Solo lectura desde beta        │
└──────────────┬──────────────────────┘
               │
               │ SOLO LECTURA
               │ (copiar datos)
               ▼
┌─────────────────────────────────────┐
│      hhr-pruebas (BETA)             │
│   ─────────────────────────────     │
│   Entorno de desarrollo/pruebas     │
│   ✅ Lectura y escritura            │
└──────────────┬──────────────────────┘
               │
               │ SINCRONIZACIÓN
               ▼
┌─────────────────────────────────────┐
│   IndexedDB (Base de datos local)   │
│   ─────────────────────────────     │
│   Almacenamiento offline            │
└─────────────────────────────────────┘
```

---

## 🛡️ Validación en Código

El archivo `constants/firebaseEnvironments.ts` contiene:

- Constantes de configuración para cada entorno
- Funciones de validación (`canWriteTo`, `canReadFrom`)
- Función de protección (`validateWriteOperation`)

### Uso:

```typescript
import { validateWriteOperation, BETA_ENVIRONMENT } from './constants/firebaseEnvironments';

// Antes de cualquier operación de escritura:
validateWriteOperation(currentProjectId);
// Lanza error si se intenta escribir en producción
```

---

## 📁 Archivos de Configuración

| Archivo | Entorno | Uso |
|---------|---------|-----|
| `.env` | Beta (`hhr-pruebas`) | Desarrollo local |
| `.env.staging` | Beta (`hhr-pruebas`) | Referencia |
| `.env.production` | ⚠️ Producción | **NO USAR en este proyecto** |

---

## ⚠️ Advertencias

1. **NUNCA** cambies el `.env` para apuntar a `hospital-hanga-roa`
2. **NUNCA** modifiques `.env.production` para usarlo en desarrollo
3. Si necesitas datos de producción, **cópialos** a `hhr-pruebas`
4. Cualquier escritura a producción desde este proyecto es un **BUG**

---

*Última actualización: Enero 2026*
