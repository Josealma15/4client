<div align="center">

# 🟢 4Client

### La plataforma SaaS que convierte WhatsApp en tu sistema de pedidos

*Gestión de pedidos en tiempo real · WhatsApp Business API · Multi-tenant · PWA*

---

[![CI](https://github.com/Josealma15/4Client/actions/workflows/ci.yml/badge.svg)](https://github.com/Josealma15/4Client/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-336791?logo=postgresql&logoColor=white)

</div>

---

## ¿Qué es 4Client?

4Client es un SaaS multi-tenant que transforma el WhatsApp Business de un negocio en un sistema completo de gestión de pedidos. Los clientes escriben por WhatsApp → el sistema crea tickets automáticamente → los empleados gestionan pedidos desde un tablero kanban en tiempo real → se generan facturas PDF automáticamente.

**Primer cliente:** Fruver San Gabriel (Bogotá, Colombia 🇨🇴)

---

## ✨ Funcionalidades Phase 1

| Módulo | Estado |
|--------|--------|
| 🗂️ Kanban de pedidos (Swimlane) | ✅ Producción |
| 💬 WhatsApp Meta Cloud API (webhook) | ✅ Producción |
| 📬 Bandeja de entrada WPP | ✅ Producción |
| 🧾 Generación de facturas PDF | ✅ Producción |
| 📊 Informe del día / Cierre de caja | ✅ Producción |
| ⚙️ Configuración (productos, empleados, usuarios) | ✅ Producción |
| 🔐 Auth JWT + refresh token con rotación | ✅ Producción |
| 📱 PWA instalable en móvil | ✅ Producción |
| ☁️ Cloudflare R2 para PDFs | ✅ Producción |
| 🚀 Deploy automático Railway + Vercel | ✅ Producción |

---

## 🏗️ Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│                        INTERNET                         │
│                                                         │
│  WhatsApp ──▶ Meta Cloud API ──webhook──▶ API (Railway) │
│                                               │          │
│  Empleados ──── PWA (Vercel) ──REST/WS──▶ API (Railway) │
│                                               │          │
│                                  ┌────────────▼───────┐ │
│                                  │  PostgreSQL         │ │
│                                  │  (Railway managed)  │ │
│                                  └────────────────────┘ │
│                                               │          │
│                                  ┌────────────▼───────┐ │
│                                  │  Cloudflare R2      │ │
│                                  │  (PDFs — gratis)    │ │
│                                  └────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Stack técnico

```
apps/
├── api/          Fastify 4 · Prisma 5 · PostgreSQL · Socket.io · TypeScript
└── web/          React 18 · Vite · TanStack Query v5 · Zustand · PWA

packages/
└── shared/       Tipos TypeScript compartidos (orders, tickets, users, socket)
```

| Capa | Tecnología |
|------|-----------|
| API REST | Fastify 4 + TypeScript |
| ORM | Prisma 5 (PostgreSQL) |
| Tiempo real | Socket.io |
| Frontend | React 18 + Vite + TanStack Query v5 |
| Auth | JWT (15min) + Refresh tokens (7d, rotación) |
| WhatsApp | Meta Cloud API (stateless, webhooks) |
| Storage | Cloudflare R2 (S3-compatible) |
| Deploy API | Railway (auto-deploy desde `main`) |
| Deploy Web | Vercel (auto-deploy desde `main`) |
| CI | GitHub Actions (type check + build) |
| Monorepo | pnpm workspaces |

---

## 🚀 Inicio rápido

### Requisitos

- Node.js 20+
- pnpm 10+
- PostgreSQL 15+

### Setup local

```bash
# 1. Clonar
git clone https://github.com/Josealma15/4Client.git
cd 4Client

# 2. Instalar dependencias
pnpm install

# 3. Configurar entorno (API)
cp apps/api/.env.example apps/api/.env
# Editar apps/api/.env con tus valores

# 4. Migrar base de datos
pnpm --filter api exec prisma migrate dev

# 5. Seed inicial (crea org + admin)
pnpm --filter api db:seed

# 6. Levantar todo
pnpm dev:api    # Puerto 3000
pnpm dev:web    # Puerto 5173
```

**Login por defecto (seed):** `admin@fruversangabriel.com` / `admin123`

---

## 🌿 Flujo de ramas

```
feature/* ──▶ dev ──▶ test ──▶ main
                                │
                                └──▶ Railway + Vercel (auto-deploy)
```

| Rama | Propósito |
|------|-----------|
| `main` | **Producción.** Solo merge desde `test`. Auto-deploy Railway + Vercel |
| `test` | **Staging.** Validación pre-producción. Mirror de lo que irá a `main` |
| `dev` | **Integración.** Todas las features se mergean aquí primero |
| `feature/*` | Trabajo activo. Siempre se ramifica desde `dev` |

> ⚠️ **Regla de oro:** Nunca hacer commit directo a `main` ni a `test`. Todo pasa por `dev`.

---

## 🗄️ Modelo de datos

```
Organization ──┬── User (admin | encargado | domiciliario)
               ├── Product (catálogo por org)
               ├── Employee (domiciliarios)
               ├── Ticket (conversación WhatsApp del día)
               │    ├── Message (mensajes WPP)
               │    └── Order[]
               │         ├── OrderItem[] (product_name como VARCHAR, no FK)
               │         └── OrderHistory[] (append-only — INMUTABLE a nivel DB)
               └── RefreshToken
```

**Invariantes de integridad:**
- `order_history` protegido con PostgreSQL RULEs `no_update` + `no_delete`
- Todos los queries scopeados por `org_id` — aislamiento multi-tenant garantizado
- Fechas de negocio en zona Colombia (UTC-5, sin DST)
- Eliminar un producto no rompe pedidos históricos (nombre guardado como texto)

---

## 🔌 API Reference

### Auth
| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/v1/auth/login` | Login (rate limit: 10/min) |
| `POST` | `/api/v1/auth/refresh` | Rotar refresh token |
| `POST` | `/api/v1/auth/logout` | Revocar refresh token |
| `GET` | `/api/v1/auth/me` | Usuario autenticado |

### Pedidos
| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/v1/orders?fecha=YYYY-MM-DD` | Pedidos del día |
| `POST` | `/api/v1/orders` | Crear pedido |
| `PATCH` | `/api/v1/orders/:id` | Actualizar estado/items |
| `PATCH` | `/api/v1/orders/:id/pay` | Marcar como pagado |
| `POST` | `/api/v1/orders/:id/move` | Mover a papelera |

### Configuración
| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET/POST` | `/api/v1/products` | Catálogo de productos |
| `DELETE` | `/api/v1/products/:id` | Desactivar producto |
| `GET/POST` | `/api/v1/employees` | Empleados / domiciliarios |
| `DELETE` | `/api/v1/employees/:id` | Desactivar empleado |
| `GET/POST` | `/api/v1/users` | Usuarios del sistema |
| `PATCH` | `/api/v1/users/:id` | Editar nombre, email, rol |
| `POST` | `/api/v1/users/:id/reset-password` | Restablecer contraseña |

### WhatsApp
| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/v1/webhook` | Verificación Meta |
| `POST` | `/api/v1/webhook` | Recibir mensajes WPP |
| `GET` | `/api/v1/wpp/status` | Estado de conexión WPP |

### Socket.io Events
| Evento | Dirección | Descripción |
|--------|-----------|-------------|
| `join:org` | cliente → server | Unirse a sala de la org |
| `join:date` | cliente → server | Unirse a sala de fecha |
| `order:created` | server → cliente | Nuevo pedido creado |
| `order:updated` | server → cliente | Pedido actualizado |
| `order:moved` | server → cliente | Pedido movido |
| `order:paid` | server → cliente | Pedido pagado |
| `ticket:message` | server → cliente | Nuevo mensaje WPP |
| `ticket:unread` | server → cliente | Cambio en no leídos |

---

## 🏗️ Deploy en producción

### Variables de entorno — Railway (API)

```env
DATABASE_URL=postgresql://...        # Auto-provisto por Railway PostgreSQL
JWT_SECRET=<64 bytes hex>
JWT_REFRESH_SECRET=<64 bytes hex>
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://tu-dominio.com

# WhatsApp (agregar cuando el cliente apruebe el número)
META_WEBHOOK_VERIFY_TOKEN=...
META_PHONE_NUMBER_ID=...
META_ACCESS_TOKEN=...
META_APP_SECRET=...

# Cloudflare R2 (PDFs)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=4client-files
```

### Variables de entorno — Vercel (Web)

```env
VITE_API_URL=https://tu-api.up.railway.app
```

### Costos de infraestructura

| Servicio | Descripción | Costo |
|----------|-------------|-------|
| Railway | API Node.js + PostgreSQL | ~$5 USD/mes |
| Vercel | Frontend React | Gratis |
| Cloudflare R2 | PDFs (hasta 10 GB) | Gratis |
| **Total** | Para todos los clientes | **~$5 USD/mes** |

---

## 🧪 CI/CD

GitHub Actions corre en cada push a `main` y `dev`:

```
push/PR → typecheck (API + Web) → build (API + Web) → ✅
                                                        │
                                          Railway + Vercel auto-deploy
```

---

## 📁 Estructura del proyecto

```
4Client/
├── apps/
│   ├── api/
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   └── src/
│   │       ├── config.ts
│   │       ├── server.ts
│   │       ├── middleware/auth.ts
│   │       ├── plugins/           (prisma, socket)
│   │       ├── routes/            (auth, orders, products, employees,
│   │       │                       tickets, inbox, cierre, files,
│   │       │                       users, webhook)
│   │       └── services/
│   │           ├── storage.ts     (Cloudflare R2)
│   │           └── whatsapp/meta-cloud.ts
│   └── web/
│       ├── public/                (icons PWA)
│       └── src/
│           ├── components/
│           │   ├── config/        (ConfigTab — productos, empleados, usuarios)
│           │   ├── dashboard/     (ResumenTab)
│           │   ├── inbox/         (InboxPanel — chats WPP)
│           │   ├── modals/        (NuevoPedido, DetallePedido, Ticket, Cierre)
│           │   ├── orders/        (Swimlane, ProductSearch)
│           │   └── ui/            (Toast, ConfirmModal)
│           ├── hooks/
│           ├── lib/               (api, socket, format)
│           ├── pages/             (LoginPage, MainPage)
│           └── store/             (Zustand auth)
├── packages/
│   └── shared/                    (tipos TypeScript compartidos)
├── .github/workflows/ci.yml
├── railway.json
├── nixpacks.toml
├── vercel.json
└── RoadMap/IMPLEMENTATION_PLAN.md
```

---

## 🗺️ Roadmap

### ✅ Phase 1 — Core + WhatsApp (COMPLETO)
- Kanban de pedidos por día
- WhatsApp Business API integración completa
- Facturas PDF con descarga
- Informe del día y cierre de caja
- Panel de Configuración (productos, empleados, usuarios)
- PWA instalable en Android/iOS
- Deploy Railway + Vercel + Cloudflare R2
- Multi-tenant desde el día 1

### 🔄 Phase 2 — Escalabilidad Multi-cliente
- [ ] Panel super-admin para gestionar orgs
- [ ] Onboarding automático de nuevos negocios
- [ ] Landing page pública de 4Client
- [ ] Facturación a clientes (Stripe / PSE)
- [ ] Dominio personalizado por cliente (`app.sunegocio.com`)

### 🔮 Phase 3 — Inteligencia de negocio
- [ ] Historial de clientes frecuentes
- [ ] Notificaciones de demora al cliente por WPP
- [ ] Catálogo automático por WhatsApp
- [ ] Métricas avanzadas y exportación a Excel
- [ ] Asistente IA para respuestas automáticas

---

## 👥 Roles de usuario

| Rol | Acceso |
|-----|--------|
| `admin` | Todo — Configuración, Informe del día, Chats WPP, gestión de usuarios |
| `encargado` | Gestionar pedidos, crear pedidos, ver swimlane |
| `domiciliario` | Ver y mover pedidos propios |

---

<div align="center">

Hecho con ❤️ en Colombia 🇨🇴

**4Client** — *Tecnología para negocios que crecen*

</div>
