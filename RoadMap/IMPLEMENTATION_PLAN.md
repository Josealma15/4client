# Plan de Implementación — 4Client
**Versión 1.1 · Junio 2026**

---

## 1. Visión de Producto

4Client es un SaaS multi-tenant de gestión operativa para negocios con pedidos por WhatsApp y domicilios. Fase 1 = un cliente (Fruver San Gabriel). Arquitectura diseñada para 50+ clientes sin refactorizar nada estructural.

**Tres usuarios, tres experiencias:**
- **Administrador (dueño):** Todo — bandeja WPP completa, resumen del día, historial inmutable, cierre de caja, configuración del sistema
- **Encargado:** Swimlane de tickets+pedidos, gestión operativa, sin datos financieros agregados
- **Domiciliario:** Solo sus pedidos asignados (Fase 2)

---

## 2. Decisiones de Arquitectura Críticas (No negociables)

Estas decisiones se toman en semana 1. Cambiarlas después = demoler y reconstruir.

### 2.1 Multi-tenancy desde el día 1
Cada negocio = un tenant. Cada tabla en BD tiene `org_id`. Sin esto, el segundo cliente requiere reescribir la base de datos completa.

### 2.2 WhatsApp: Meta Cloud API oficial para todos los clientes
- **Todos los clientes sin excepción** usan Meta Cloud API (oficial, sin riesgo de ban, soporte de Meta)
- **Número dedicado al negocio:** Cada cliente registra un número nuevo exclusivo para el sistema (chip prepago ~$5,000 COP). Este número NO funciona en la app de WhatsApp — solo via API
- **El dueño monitorea desde 4Client PWA** instalada en su celular — ve la bandeja completa, lee y responde en tiempo real. Su número personal sigue en la app de WPP normal sin cambios
- **Sin Baileys, sin sesiones persistentes, sin riesgo de ban.** Arquitectura stateless y limpia desde el primer día

### 2.3 Bandeja WPP para el dueño
El administrador tiene una vista de bandeja completa dentro de 4Client — todos los chats, historial completo, puede leer y responder. Los encargados no tienen acceso a esta vista. La app es PWA (Progressive Web App) para que el dueño la instale en su celular como app nativa.

### 2.4 Audit log inmutable en base de datos
No en arrays en memoria. Tabla `order_history` append-only con reglas PostgreSQL que rechazan UPDATE y DELETE. Ningún rol puede borrar registros de auditoría — ni el administrador.

### 2.5 Catálogo de productos por tenant
No hardcodeado. Tabla `products` con `org_id`. Cada negocio gestiona su propio catálogo.

---

## 3. Stack Tecnológico

| Capa | Tecnología | Justificación |
|---|---|---|
| **Frontend** | React 18 + Vite + TypeScript | Ya iniciado, TS previene bugs de tipos en runtime |
| **Estilos** | CSS Vanilla + CSS Modules | Roadmap lo especifica. Sin Tailwind |
| **Estado servidor** | TanStack Query v5 | Cache, sync, invalidación automática |
| **Estado cliente** | Zustand | Liviano, sin boilerplate de Redux |
| **Backend** | Node.js + Fastify v4 | Rápido, schema validation nativo, plugins maduros |
| **ORM** | Prisma 5 | Migrations, type-safety, middleware multi-tenancy |
| **Base de datos** | PostgreSQL 16 | ACID, Row-Level Security, JSONB |
| **Real-time** | Socket.io 4 | Namespaces por org, rooms por fecha |
| **Auth** | JWT (access 15min) + Refresh tokens (7 días) + bcrypt | Sin vendor lock-in |
| **WPP Todos los clientes** | Meta Cloud API | Oficial, sin riesgo de ban, número dedicado al negocio |
| **PDF** | PDFKit (server-side) | Control total, no depende del browser |
| **Storage** | Cloudflare R2 | S3-compatible, free tier hasta 10GB ($0/mes) |
| **Hosting** | Railway | Auto-deploy desde GitHub, PostgreSQL incluido |
| **Monorepo** | pnpm workspaces | Comparte tipos TypeScript entre frontend y backend |
| **PWA** | Vite PWA plugin | Dueño instala 4Client en celular como app |
| **Email** | Resend | 3,000 emails/mes gratis, API simple |

---

## 4. Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────────────────┐
│                           USUARIOS                                  │
│  Dueño (celular - PWA)   Trabajador (computador)   Domiciliario    │
└──────────┬───────────────────────┬───────────────────┬─────────────┘
           │        HTTPS + WSS    │                   │
           ▼                       ▼                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   4Client Frontend (React + Vite)                   │
│                                                                     │
│  /login                                                             │
│  /panel          → Swimlane tickets+pedidos (todos los roles)      │
│  /inbox          → Bandeja WPP completa (solo admin)               │
│  /resumen        → Dashboard financiero (solo admin)               │
│  /configuracion  → Usuarios, productos, empleados (solo admin)     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ REST API + WebSocket
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     4Client Backend (Fastify)                       │
│                                                                     │
│  → Auth Middleware (verifica JWT)                                   │
│  → Tenant Middleware (inyecta org_id en cada request)              │
│  → Role Middleware (guards por rol: admin|encargado|domiciliario)  │
│                                                                     │
│  Rutas:                                                             │
│  POST /api/v1/auth/login          GET  /api/v1/orders              │
│  POST /api/v1/auth/refresh        POST /api/v1/orders              │
│  GET  /api/v1/inbox               GET  /api/v1/inbox/:id/messages  │
│  POST /api/v1/inbox/:id/reply     GET  /api/v1/dashboard           │
│  POST /api/v1/cierre                                               │
│                                                                     │
│  WhatsAppService → MetaCloudProvider (todos los clientes)          │
└──────────┬──────────────────────────────────────────────────────────┘
           │
           ├──→ PostgreSQL (datos principales)
           └──→ Cloudflare R2 (PDFs, facturas, reportes)

WhatsApp ──webhook/socket──→ Backend ──WebSocket──→ Frontend (real-time)
```

---

## 5. Base de Datos — Schema Completo

```sql
-- ═══════════════ MULTI-TENANCY ═══════════════
CREATE TABLE organizations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 VARCHAR(200) NOT NULL,
  slug                 VARCHAR(50) UNIQUE NOT NULL,   -- ej: fruver-san-gabriel
  plan                 VARCHAR(20) DEFAULT 'starter', -- starter|pro|enterprise
  wpp_provider         VARCHAR(20) DEFAULT 'baileys', -- baileys|meta_api
  wpp_phone            VARCHAR(20),
  wpp_meta_phone_id    VARCHAR(100),                  -- solo para Meta API
  wpp_meta_token       TEXT,                          -- encriptado en BD
  active               BOOLEAN DEFAULT true,
  created_at           TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════ AUTH ═══════════════
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id),
  email         VARCHAR(200) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  name          VARCHAR(200) NOT NULL,
  role          VARCHAR(20) NOT NULL CHECK (role IN ('admin','encargado','domiciliario')),
  active        BOOLEAN DEFAULT true,
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, email)
);

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(100) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════ CATÁLOGO POR TENANT ═══════════════
CREATE TABLE products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  name            VARCHAR(200) NOT NULL,
  category        VARCHAR(100),
  active          BOOLEAN DEFAULT true,
  sort_order      INT DEFAULT 0,
  -- Campos para balanza (Fase 2) — nullable, no usados en Fase 1
  price_per_unit  NUMERIC(12,2),     -- precio por kg o por unidad
  unit_type       VARCHAR(20),       -- 'kg' | 'und' | 'libra' | 'manojo'
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════ EMPLEADOS (DOMICILIARIOS) ═══════════════
CREATE TABLE employees (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id),
  name        VARCHAR(200) NOT NULL,
  phone       VARCHAR(20),
  role        VARCHAR(20) DEFAULT 'domiciliario',
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════ WHATSAPP — BANDEJA ═══════════════
-- Un ticket = una conversación con un cliente (por número de teléfono)
-- Los tickets son INMUTABLES — solo se agregan mensajes, nunca se borran
CREATE TABLE tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  phone           VARCHAR(20) NOT NULL,
  customer_name   VARCHAR(200),
  wpp_thread_id   VARCHAR(200),          -- ID interno del proveedor WPP
  unread_count    INT DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, phone, fecha)           -- un ticket por cliente por día
);

-- APPEND-ONLY: mensajes nunca se borran ni modifican
CREATE TABLE ticket_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       UUID NOT NULL REFERENCES tickets(id),
  direction       VARCHAR(5) NOT NULL CHECK (direction IN ('in','out')),
  text            TEXT,
  media_url       VARCHAR(500),          -- URL en Cloudflare R2
  media_type      VARCHAR(50),           -- pdf|image|audio|video
  media_caption   VARCHAR(500),
  sent_by         UUID REFERENCES users(id), -- NULL si es mensaje del cliente
  wpp_message_id  VARCHAR(200) UNIQUE,   -- para deduplicación exacta
  sent_at         TIMESTAMPTZ DEFAULT now(),
  delivered       BOOLEAN DEFAULT false,
  read_by_client  BOOLEAN DEFAULT false
);

-- ═══════════════ PEDIDOS ═══════════════
CREATE TABLE orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  ticket_id       UUID REFERENCES tickets(id),    -- NULL si fue por llamada
  num             VARCHAR(10) NOT NULL,            -- 001, 002...
  customer_name   VARCHAR(200) NOT NULL,
  customer_phone  VARCHAR(20),
  address         TEXT NOT NULL,
  channel         VARCHAR(20) DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','call')),
  payment_method  VARCHAR(20) NOT NULL CHECK (payment_method IN ('cash','transfer','cod')),
  -- cash = pagado en tienda | transfer = transferencia | cod = cobra en casa
  status          VARCHAR(20) NOT NULL DEFAULT 'nuevo'
                  CHECK (status IN ('nuevo','preparando','listo','camino','entregado','cerrado','papelera')),
  employee_id     UUID REFERENCES employees(id),  -- domiciliario asignado
  registered_by   UUID NOT NULL REFERENCES users(id),
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  order_hour      TIME NOT NULL DEFAULT CURRENT_TIME,
  paid            BOOLEAN DEFAULT false,
  paid_at         TIMESTAMPTZ,
  paid_by         UUID REFERENCES users(id),
  amount_received NUMERIC(12,2),
  change_amount   NUMERIC(12,2),
  locked          BOOLEAN DEFAULT false,           -- true después de cobro confirmado
  caja_cerrada    BOOLEAN DEFAULT false,           -- true después de cierre de caja
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, num, fecha)
);

CREATE TABLE order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_name    VARCHAR(200) NOT NULL,
  -- Fase 1: quantity_label es el campo usado en la UI (texto libre del mockup: "2 kg", "1 manojo")
  quantity_label  VARCHAR(100),
  price           NUMERIC(12,2) DEFAULT 0,
  sort_order      INT DEFAULT 0,
  -- Campos para balanza (Fase 2) — nullable, no usados en Fase 1
  -- Cuando la balanza esté integrada, se llenan estos y price se calcula automático
  quantity_value  NUMERIC(10,3),    -- 2.500 (el número solo)
  quantity_unit   VARCHAR(20)       -- 'kg' | 'und' | 'libra'
);

-- APPEND-ONLY: inmutable por reglas PostgreSQL
-- Nadie puede hacer UPDATE ni DELETE — ni el admin
CREATE TABLE order_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id),
  order_id     UUID NOT NULL REFERENCES orders(id),
  actor_id     UUID NOT NULL REFERENCES users(id),
  action_type  VARCHAR(20) NOT NULL
               CHECK (action_type IN ('create','edit','estado','cobro','papelera','cierre','nota')),
  field        VARCHAR(100),            -- qué campo cambió
  value_before TEXT,
  value_after  TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Reglas que hacen order_history inmutable a nivel de base de datos
CREATE RULE no_update_order_history AS ON UPDATE TO order_history DO INSTEAD NOTHING;
CREATE RULE no_delete_order_history AS ON DELETE TO order_history DO INSTEAD NOTHING;

-- ═══════════════ PAPELERA ═══════════════
CREATE TABLE order_trash (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id),
  order_id     UUID NOT NULL REFERENCES orders(id),
  deleted_by   UUID NOT NULL REFERENCES users(id),
  reason       TEXT,
  deleted_at   TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════ CIERRE DE CAJA ═══════════════
CREATE TABLE daily_closes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(id),
  fecha            DATE NOT NULL,
  total_cash       NUMERIC(12,2) DEFAULT 0,
  total_transfer   NUMERIC(12,2) DEFAULT 0,
  total_grand      NUMERIC(12,2) DEFAULT 0,
  total_orders     INT DEFAULT 0,
  closed_orders    INT DEFAULT 0,
  decisions        JSONB,               -- {order_id: 'manana'|'forzar'|'cancelar'}
  report_url       VARCHAR(500),        -- CSV en Cloudflare R2
  closed_by        UUID NOT NULL REFERENCES users(id),
  closed_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, fecha)
);

-- ═══════════════ ÍNDICES ═══════════════
CREATE INDEX idx_orders_org_fecha      ON orders(org_id, fecha);
CREATE INDEX idx_orders_status         ON orders(org_id, status);
CREATE INDEX idx_orders_employee       ON orders(org_id, employee_id);
CREATE INDEX idx_tickets_org_fecha     ON tickets(org_id, fecha);
CREATE INDEX idx_tickets_phone         ON tickets(org_id, phone);
CREATE INDEX idx_messages_ticket       ON ticket_messages(ticket_id, sent_at);
CREATE INDEX idx_history_order         ON order_history(order_id, created_at);
CREATE INDEX idx_history_org_fecha     ON order_history(org_id, created_at);
```

---

## 6. Estructura de Archivos del Proyecto

```
4client/
├── package.json                  ← pnpm workspace root
├── pnpm-workspace.yaml
├── .env.example
├── .github/
│   └── workflows/
│       └── deploy.yml            ← CI/CD: test → build → deploy a Railway
│
├── apps/
│   │
│   ├── api/                      ← Backend Fastify
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   └── src/
│   │       ├── server.ts         ← Entry point, registra todos los plugins
│   │       ├── config.ts         ← Variables de entorno tipadas con Zod
│   │       ├── plugins/
│   │       │   ├── cors.ts
│   │       │   ├── jwt.ts
│   │       │   ├── prisma.ts     ← Decorador fastify.prisma
│   │       │   ├── redis.ts      ← Para Baileys session store
│   │       │   └── socket.ts     ← Socket.io setup + namespaces por org
│   │       ├── middleware/
│   │       │   ├── auth.ts       ← Verifica JWT, inyecta req.user
│   │       │   ├── tenant.ts     ← Inyecta req.orgId desde JWT
│   │       │   └── roles.ts      ← requireRole('admin') guard
│   │       ├── routes/
│   │       │   ├── auth.ts       ← POST /login, /refresh, /logout
│   │       │   ├── orders.ts     ← CRUD pedidos
│   │       │   ├── tickets.ts    ← Tickets del swimlane
│   │       │   ├── inbox.ts      ← Bandeja WPP admin (GET lista, GET chat, POST reply)
│   │       │   ├── products.ts   ← Catálogo por org
│   │       │   ├── employees.ts  ← Domiciliarios por org
│   │       │   ├── dashboard.ts  ← Stats resumen del día
│   │       │   ├── cierre.ts     ← Cierre de caja
│   │       │   └── webhooks.ts   ← Webhook Meta Cloud API (POST /webhook/meta)
│   │       └── services/
│   │           ├── whatsapp/
│   │           │   ├── index.ts          ← Interface IWhatsAppProvider + factory
│   │           │   ├── baileys.ts        ← BaileysProvider (cliente 1)
│   │           │   └── meta-cloud.ts     ← MetaCloudProvider (clientes 2+)
│   │           ├── order.service.ts      ← Lógica de negocio de pedidos
│   │           ├── history.service.ts    ← Escritura inmutable de audit log
│   │           ├── pdf.service.ts        ← Genera PDFs con PDFKit
│   │           ├── storage.service.ts    ← Upload/download Cloudflare R2
│   │           └── cierre.service.ts     ← Lógica de cierre de caja
│   │
│   └── web/                      ← Frontend React + Vite
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts        ← PWA plugin configurado
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx           ← Router + providers
│           ├── styles/
│           │   ├── globals.css   ← Variables CSS del mockup (--v, --r, etc.)
│           │   └── reset.css
│           ├── lib/
│           │   ├── api.ts        ← Cliente HTTP (fetch wrapper con JWT auto-refresh)
│           │   ├── socket.ts     ← Socket.io cliente
│           │   └── queryClient.ts
│           ├── stores/
│           │   ├── auth.store.ts    ← Zustand: user, org, tokens
│           │   └── ui.store.ts      ← Zustand: toasts, modales activos
│           ├── hooks/
│           │   ├── useOrders.ts
│           │   ├── useTickets.ts
│           │   ├── useInbox.ts
│           │   └── useSocket.ts     ← Escucha eventos WS → invalida React Query
│           ├── components/
│           │   ├── ui/              ← Componentes base reutilizables
│           │   │   ├── Button/
│           │   │   ├── Modal/
│           │   │   ├── Toast/
│           │   │   ├── Badge/
│           │   │   └── Input/
│           │   ├── Layout/
│           │   │   ├── Header.tsx
│           │   │   └── AppLayout.tsx
│           │   ├── Swimlane/
│           │   │   ├── SwimlaneView.tsx
│           │   │   ├── TicketCell.tsx
│           │   │   ├── OrderCard.tsx
│           │   │   └── UrgencyStrip.tsx
│           │   ├── Inbox/               ← BANDEJA WPP (solo admin)
│           │   │   ├── InboxView.tsx    ← Layout dos columnas
│           │   │   ├── ChatList.tsx     ← Lista de conversaciones
│           │   │   ├── ChatWindow.tsx   ← Mensajes + input reply
│           │   │   ├── ChatBubble.tsx
│           │   │   └── MediaMessage.tsx ← PDF/imagen en chat
│           │   ├── Orders/
│           │   │   ├── NewOrderModal.tsx
│           │   │   ├── OrderDetailModal.tsx
│           │   │   ├── ProductList.tsx
│           │   │   └── ConfirmCobroModal.tsx
│           │   ├── Dashboard/
│           │   │   ├── ResumenView.tsx
│           │   │   └── StatsCards.tsx
│           │   └── Cierre/
│           │       └── CierreModal.tsx
│           └── pages/
│               ├── Login.tsx
│               ├── Panel.tsx        ← Swimlane (todos los roles)
│               ├── Inbox.tsx        ← Bandeja WPP (admin only)
│               ├── Resumen.tsx      ← Dashboard (admin only)
│               └── Configuracion.tsx ← Settings (admin only)
│
└── packages/
    └── shared/                   ← Tipos TypeScript compartidos
        ├── package.json
        └── src/
            ├── types/
            │   ├── order.types.ts
            │   ├── ticket.types.ts
            │   ├── user.types.ts
            │   └── socket.types.ts   ← Eventos WS tipados
            └── index.ts
```

---

## 7. Interfaz WhatsApp — Abstracción del Proveedor

```typescript
// apps/api/src/services/whatsapp/index.ts

export interface IWhatsAppProvider {
  sendText(phone: string, text: string): Promise<{ messageId: string }>;
  sendMedia(phone: string, mediaUrl: string, caption?: string): Promise<{ messageId: string }>;
  markAsRead(messageId: string): Promise<void>;
  getStatus(): Promise<'connected' | 'disconnected' | 'qr_required'>;
}

export function createWhatsAppProvider(org: Organization): IWhatsAppProvider {
  return new MetaCloudProvider(org.wpp_meta_phone_id!, org.wpp_meta_token!);
}
```

### Flujo Meta Cloud API (todos los clientes)

```
SETUP (una sola vez por cliente):
1. Negocio compra chip prepago nuevo (~$5,000 COP) — número dedicado al negocio
2. Se registra ese número en Meta Business Manager
3. Meta verifica el número via SMS/llamada
4. Se configura webhook: POST https://api.4client.shop/webhook/meta
5. Meta entrega phone_number_id + access_token → se guardan en org (encriptados)

OPERACIÓN DIARIA:
1. Cliente escribe al número del negocio por WhatsApp
2. Meta envía POST al webhook con el mensaje
3. Backend valida firma HMAC-SHA256 del request
4. Guarda mensaje en ticket_messages (BD)
5. WebSocket emite evento → 4Client actualiza en tiempo real
6. Trabajador ve el ticket en swimlane, dueño ve en bandeja + swimlane
7. Trabajador o dueño responde desde 4Client
8. Backend llama a Meta Graph API → mensaje sale por WPP al cliente
9. Stateless, sin conexión persistente, sin QR, sin sesiones
```

### Setup inicial para cada cliente nuevo

```
Dueño:
├── Número personal → WhatsApp app en su celular (sin cambios)
└── 4Client PWA instalada en su celular → bandeja del negocio

Número del negocio (nuevo chip):
└── Meta Cloud API → solo funciona via 4Client
    ├── Dueño lo ve en bandeja 4Client (PWA en celular)
    └── Trabajadores lo ven en swimlane (computador)
```

---

## 8. Bandeja WhatsApp — Vista del Administrador

Solo visible para rol `admin`. Replica experiencia de la app de WhatsApp dentro de 4Client.

```
┌─────────────────────────────────────────────────────────────┐
│  💬 Bandeja WhatsApp                        [Solo Admin]    │
├──────────────────────┬──────────────────────────────────────┤
│ CONVERSACIONES       │  María González  📱 3001234567       │
│                      │  Hoy 09:15 · 12 mensajes             │
│ 🔴 María González    ├──────────────────────────────────────┤
│ Quiero hacer un pe.. │                                      │
│ 09:15 · 2 sin leer   │  ┌─────────────────────────┐        │
├──────────────────────┤  │ Hola buenos días 🌞      │ 09:10 │
│ ✅ Carlos Ruiz       │  └─────────────────────────┘        │
│ Gracias! Espero el.. │       ┌────────────────────────────┐ │
│ 08:45                │       │ Quiero hacer un pedido     │ │
├──────────────────────│       └────────────────────────────┘ │
│ 🟡 Fermín Vargas     │  ┌─────────────────────────────────┐ │
│ ¿Ya salió mi pedi.. │  │ Claro, ¿qué desea pedir?  09:11│ │
│ 08:20                │  └─────────────────────────────────┘ │
├──────────────────────│       ┌────────────────────────────┐ │
│ 📎 Laura Gómez       │       │ Papa pastusa 2 kg y...     │ │
│ [PDF Factura_003]    │       └────────────────────────────┘ │
│ 07:55                │  ┌─────────────────────────────────┐ │
└──────────────────────┤  │ 📄 Factura_003.pdf   [Abrir]   │ │
                       │  └─────────────────────────────────┘ │
                       │                                      │
                       │  [Escribe un mensaje...] [📎] [➤]  │
                       └──────────────────────────────────────┘
```

**Características:**
- Lista de chats ordenados por último mensaje
- Indicador de mensajes sin leer (punto rojo + contador)
- Búsqueda por nombre o número de teléfono
- Burbujas de chat estilo WhatsApp
- Soporte para PDFs e imágenes (se renderizan en el chat)
- Input para responder + adjuntar PDF de factura
- Filtro por fecha (historial de días anteriores)
- Badge en el header de 4Client cuando llegan mensajes nuevos
- En móvil (PWA): vista de una columna, navega entre lista y chat

---

## 9. Eventos WebSocket (Tiempo Real)

```typescript
// packages/shared/src/types/socket.types.ts

export interface ServerToClientEvents {
  'order:created':   (order: Order) => void;
  'order:updated':   (order: Order) => void;
  'order:moved':     (data: { orderId: string; newStatus: string }) => void;
  'ticket:message':  (data: { ticketId: string; message: TicketMessage }) => void;
  'ticket:unread':   (data: { ticketId: string; count: number }) => void;
  'order:paid':      (data: { orderId: string }) => void;
}

export interface ClientToServerEvents {
  'join:org':   (orgId: string) => void;
  'join:date':  (fecha: string) => void;
}
```

El hook `useSocket` escucha estos eventos e invalida las queries de React Query automáticamente. Sin polling. Sin delays. Sin datos desincronizados entre usuarios.

---

## 10. Seguridad

| Capa | Mecanismo |
|---|---|
| Contraseñas | bcrypt salt factor 12 |
| Auth | JWT access (15min) + refresh token (7 días, rotado en cada uso) |
| Multi-tenancy | Middleware inyecta `org_id` en CADA query de Prisma — imposible acceder a datos de otro tenant |
| Roles | Guard en rutas sensibles — admin-only retorna 403 si rol != admin |
| Audit log | Reglas PostgreSQL que rechazan UPDATE/DELETE en `order_history` |
| Pedidos cerrados | `locked: true` post-cobro — backend rechaza cualquier modificación |
| Webhooks Meta | Validación de firma HMAC-SHA256 en cada request entrante |
| Rate limiting | Fastify rate-limit — max 10 intentos/min en /auth/login por IP |
| Env vars | Nunca en código — .env excluido de git, variables en Railway dashboard |
| Tokens WPP Meta | Encriptados con AES-256 antes de guardar en BD |

---

## 11. Fases de Implementación

### FASE 1A — Fundamentos del Backend (Semanas 1–2)
**Objetivo:** Backend funcionando con auth y multi-tenancy. Sin WPP aún.

| # | Tarea |
|---|---|
| 1 | Setup monorepo: pnpm workspaces, TypeScript base, estructura de carpetas |
| 2 | Fastify + Prisma + PostgreSQL: server básico, conexión BD, primer migration |
| 3 | Schema BD completo: todas las tablas del plan |
| 4 | Auth completo: login, JWT, refresh tokens, logout |
| 5 | Middleware multi-tenancy: org_id automático en cada request |
| 6 | Middleware de roles: guards admin / encargado / domiciliario |
| 7 | CRUD productos: catálogo editable por org |
| 8 | CRUD empleados: domiciliarios por org |
| 9 | CRUD pedidos: crear, leer, actualizar estado, historial inmutable |
| 10 | Socket.io: namespaces por org, broadcast de cambios en tiempo real |
| 11 | Seed inicial: org Fruver San Gabriel + admin + productos del mockup |

**Entregable:** API REST + BD completa + auth + WebSocket funcionando.

---

### FASE 1B — Frontend Conectado (Semanas 3–4)
**Objetivo:** UI del mockup migrada a React con datos reales del backend.

| # | Tarea |
|---|---|
| 12 | Setup React + Vite + TypeScript + PWA config |
| 13 | Sistema de diseño base: variables CSS del mockup, componentes UI reutilizables |
| 14 | Auth flow: login, JWT storage, rutas protegidas, redirect por rol |
| 15 | Swimlane view: tickets + columnas de estados con datos reales via React Query |
| 16 | Modal nuevo pedido: form conectado al API, chat preview del ticket |
| 17 | Modal detalle pedido: edición, mover estados, historial (admin), PDF |
| 18 | Modal confirmar cobro: flujo completo de pago |
| 19 | Dashboard resumen: stats del día para admin |
| 20 | Cierre de caja: modal con decisiones + generación CSV |
| 21 | useSocket hook: eventos WS → invalida React Query → UI actualiza sola |
| 22 | PWA: manifest, service worker, instalable en celular del dueño |

**Entregable:** App completa con backend real. Tickets creados manualmente aún (sin WPP).

---

### FASE 1C — Integración WhatsApp (Semanas 5–6)
**Objetivo:** Mensajes de WhatsApp entrando y saliendo en tiempo real.

| # | Tarea |
|---|---|
| 23 | Interface IWhatsAppProvider + MetaCloudProvider implementación completa |
| 24 | Webhook endpoint: POST /webhook/meta con validación HMAC-SHA256 |
| 25 | Pipeline mensaje entrante: webhook → BD ticket_messages → WebSocket → UI |
| 26 | Envío de respuestas: Meta Graph API con manejo de errores y retry |
| 27 | Rutas backend bandeja: GET /inbox, GET /inbox/:id/messages, POST /inbox/:id/reply |
| 28 | Bandeja WPP frontend: InboxView, ChatList, ChatWindow, ChatBubble, MediaMessage |
| 29 | Notificaciones tiempo real: badge contador en header, toast de mensaje nuevo |
| 30 | PDF server-side: PDFKit genera → sube a R2 → envía por WPP como adjunto via Meta API |
| 31 | Urgency system: lógica de tiempo de espera, zona roja en swimlane |
| 32 | Crear pedido desde inbox: botón en bandeja → modal nuevo pedido con datos prellenados |
| 33 | Endpoint GET /wpp/status → verifica que la conexión Meta API esté activa |

**Entregable:** Sistema completo con WhatsApp real. Listo para producción cliente 1.

---

### FASE 1D — Producción y Estabilización (Semana 7)

| # | Tarea |
|---|---|
| 34 | Deploy Railway: backend + BD en producción, dominio configurado |
| 35 | Deploy frontend: build optimizado, variables de entorno de prod |
| 36 | CI/CD GitHub Actions: push a main → tests → build → deploy automático |
| 37 | Cloudflare R2: bucket PDFs, políticas de acceso público para media |
| 38 | Monitoreo básico: Railway logs, alerta de error por email |
| 39 | Onboarding Fruver San Gabriel: registrar número nuevo en Meta Business, configurar webhook, capacitación equipo, datos iniciales, primer día |

**Entregable:** Sistema en producción con primer cliente pagando.

---

### FASE 2 — Hardware: Balanza + Impresora de Etiquetas (Futuro)

Convierte el PC del negocio en una estación de despacho completamente automatizada.

#### 2A — Balanza digital conectada al PC

| Módulo | Detalle |
|---|---|
| **Protocolo** | Web Serial API (Chrome/Edge) — sin instalar drivers, el browser lee el puerto USB directamente |
| **Flujo** | Seleccionas producto en 4Client → pones producto en balanza → 4Client lee el peso automático → multiplica `quantity_value × price_per_unit` de la BD → llena precio solo |
| **Cambios en BD** | Cero — los campos `quantity_value`, `quantity_unit` y `price_per_unit` ya están en el schema desde Fase 1 |
| **Cambios en backend** | Cero — la lectura de la balanza es 100% frontend via Web Serial API |
| **Cambios en frontend** | Nuevo componente `BalanzaReader` en el modal de nuevo pedido/detalle |
| **Requisito** | PC del negocio debe usar Chrome o Edge (no Firefox, no Safari) |
| **Gestión de precios** | El dueño actualiza precios por producto en la sección Configuración → el sistema multiplica automáticamente |

#### 2B — Impresora de etiquetas térmica (stickers para bolsas)

| Módulo | Detalle |
|---|---|
| **Tipo de impresora** | Zebra, Brother QL, TSC u otras impresoras de etiquetas térmicas |
| **Arquitectura** | Agente local Node.js corriendo en el PC del negocio (`localhost:3001`) — más robusto que Web Serial para impresoras |
| **Flujo** | Trabajador confirma pedido en 4Client → clic "Imprimir etiqueta" → 4Client POST al agente local → agente formatea en ZPL/TSPL → impresora imprime sticker |
| **Contenido etiqueta** | Número pedido, nombre cliente, dirección, teléfono, productos, total, método de pago, hora |
| **Cambios en BD** | Cero — todos los datos ya están en `orders` + `order_items` |
| **Cambios en backend** | Cero — el agente local es independiente del servidor |
| **Entregable** | Sticker listo para pegar en la bolsa del pedido antes de salir con el domiciliario |

---

### FASE 3 — Multi-Cliente, Tienda Online y Pagos (Futuro)

| Módulo | Descripción |
|---|---|
| **Onboarding de orgs** | UI para registrar nuevos negocios, configurar número Meta API, setup inicial automatizado |
| **Billing** | Stripe para cobrar suscripciones automáticamente |
| **Subdominios** | `fruver.4client.shop`, `negocio2.4client.shop` |
| **App móvil nativa** | React Native — comparte lógica y tipos del monorepo |
| **Vista domiciliario** | App simplificada para domiciliarios en celular |
| **Tienda online pública** | Página donde clientes hacen pedidos directamente → se crea automático en 4Client |
| **Pasarela de pagos** | Wompi, Nequi, Daviplata integrados en la tienda online |
| **Reportes avanzados** | Histórico multi-día, exportes, análisis de ventas |

---

## 12. Costos de Infraestructura

### Lo que paga 4Client (el desarrollador) por cliente

| Componente | Servicio | Costo/mes |
|---|---|---|
| Backend + PostgreSQL | Railway Starter | $5 USD |
| Frontend | Vercel / Railway | $0 (free tier) |
| Storage PDFs | Cloudflare R2 | $0 (hasta 10GB) |
| Dominio .shop | Cloudflare Registrar | ~$1 USD |
| WhatsApp Meta Cloud API | Meta (1,000 conv/mes gratis) | $0–$3 USD |
| Email transaccional | Resend | $0 (3,000/mes) |
| **TOTAL** | | **~$6–9 USD/mes** |

**Setup único por cliente:** Chip prepago número negocio ~$5,000 COP (pago del cliente, no tuyo).
**En COP:** ~$25,000–37,000/mes de infraestructura por cliente.
**Se cobra al cliente:** $200,000 COP/mes.
**Margen neto por cliente:** ~$163,000–175,000 COP/mes.
**Con 5 clientes activos:** ~$815,000–875,000 COP/mes margen infraestructura.

### Conversaciones Meta API — ¿Cuándo se paga?
- Primeras **1,000 conversaciones de servicio/mes: GRATIS**
- Un fruver con 200 clientes activos/mes → dentro del free tier
- Si supera 1,000: ~$0.015 USD por conversación (~$60 COP) — se le cobra al cliente como extra

---

## 13. Variables de Entorno

```env
# Base de datos
DATABASE_URL="postgresql://user:pass@host:5432/4client"

# Auth
JWT_SECRET="[min 32 chars aleatorios]"
JWT_REFRESH_SECRET="[min 32 chars aleatorios, diferente al anterior]"

# Cloudflare R2
R2_ACCOUNT_ID=""
R2_ACCESS_KEY_ID=""
R2_SECRET_ACCESS_KEY=""
R2_BUCKET_NAME="4client-files"
R2_PUBLIC_URL="https://files.4client.shop"

# WhatsApp Meta Cloud API (clientes con este proveedor)
META_WEBHOOK_VERIFY_TOKEN="[token aleatorio para verificar webhook]"

# App
NODE_ENV="production"
PORT=3000
FRONTEND_URL="https://app.4client.shop"
```

---

## 14. Convenciones del Proyecto

- **TypeScript estricto** (`strict: true`) — sin `any` implícito
- **Rutas del API:** `/api/v1/[recurso]` — versionadas desde el inicio
- **Respuestas del API:** `{ data: T }` en éxito, `{ error: string, code: string }` en error
- **Eventos WebSocket:** `recurso:acción` — ej: `order:updated`, `ticket:message`
- **Commits:** Conventional Commits — `feat:`, `fix:`, `chore:`, `docs:`
- **Branch principal:** `main` → producción. Features en `feature/nombre`
- **Sin comentarios obvios** — nombres de variables/funciones autodescriptivos
- **Sin Tailwind CSS** — CSS Modules + variables globales del mockup

---

## 15. Referencia Visual — El Mockup

El mockup en `/mockup/` es la fuente de verdad visual. Revisar antes de implementar cualquier componente. Las variables CSS (`--v`, `--r`, `--a`, `--az`, etc.) se migran a `globals.css` y se usan en toda la app.

**Se mantiene igual del mockup:**
- Flujo swimlane: tickets WPP columna izquierda + 6 columnas de estado
- Estados: nuevo → preparando → listo → camino → entregado → cerrado
- Dirty state tracking (warn modal al cerrar con cambios sin guardar)
- Separación ticket (conversación WPP) vs pedido (despacho físico)
- Urgency system (zona roja > 15 min sin atención)
- Drag & drop de pedidos entre columnas
- Cierre de caja con decisiones individuales por pedido pendiente
- Toggle collapse de tickets en swimlane

**Cambia en producción:**
- `PRODS` hardcodeado → tabla `products` en BD por org
- `USERS` hardcodeado → tabla `users` con bcrypt en BD
- Arrays en RAM → PostgreSQL + React Query
- Domiciliarios como strings → entidad `employees` en BD con FK
- `p.hist` array → tabla `order_history` append-only en BD
- `html2pdf()` en browser → PDFKit en servidor + Cloudflare R2
- `simulateIncomingMessage()` → webhook WPP real (Baileys o Meta)
