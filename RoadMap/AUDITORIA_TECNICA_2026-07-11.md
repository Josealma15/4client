# Auditoría técnica completa de 4Client

> Fecha: 2026-07-11 · Rama auditada: `main` (commit `4d318d2`)
> Alcance: backend (Fastify + Prisma), frontend (React + Vite), esquema de base de datos, dependencias, seguridad, deployment.

---

## 1. Resumen ejecutivo

El proyecto está en **buen estado general**: TypeScript compila sin errores en `api` y `web`, no hay `console.log` de debug ni `TODO`s pendientes en el código, la autenticación está bien diseñada (rotación de refresh tokens, protección contra timing attacks, rate limiting) y todas las queries están correctamente aisladas por `org_id` (sin IDOR entre organizaciones).

Los problemas reales se concentran en tres frentes:

1. **Dependencias con vulnerabilidades conocidas** - `pnpm audit` reporta **3 críticas y 11 altas**, casi todas resueltas al migrar a Fastify 5 + `@fastify/jwt` 10.
2. **Bugs funcionales confirmados** - 6 bugs de severidad media/baja identificados en código propio (detallados abajo).
3. **Cero tests y cero CI** - no existe ninguna prueba automatizada ni pipeline de verificación antes de merge/deploy.

**Puntuación general: 7.5/10.** Sólido para el tamaño actual, pero necesita el roadmap de abajo antes de escalar a más organizaciones.

---

## 2. Seguridad - lo que está BIEN (no tocar)

| Área | Implementación |
|---|---|
| Access token | JWT HS256 explícito (firma y verificación), expira en 15 min, solo en memoria |
| Refresh token | Cookie HttpOnly + Secure + SameSite=strict, hash SHA-256 en DB, rotación en cada uso, 7 días |
| Login | Rate limit 10/min por IP, `DUMMY_HASH` contra timing attacks (no revela si el email existe) |
| Multi-tenant | `org_id` filtrado en **todas** las queries; verificado ruta por ruta |
| Socket.IO | JWT verificado en handshake; rooms `org:*` y `org:*:date:*` validan pertenencia a la org |
| Cierre de caja | Whitelist de order IDs y ticket IDs de la org antes de aplicar decisiones (anti-IDOR) |
| Cobro | Requiere re-verificación de contraseña con bcrypt; `paid_by` siempre del usuario autenticado |
| Webhook Meta | HMAC-SHA256 con `timingSafeEqual`, anti-replay de 10 min, dedup por `wpp_message_id`, rate limit 300/min |
| CORS | Allowlist de orígenes con credenciales; `*` solo en `/api/v1/public/*` (correcto, es un form público) |
| Rutas dev | Whitelist de tablas, scoped a la propia org, seed bloqueado en producción |
| Errores | Mensajes de error 500 ocultos en producción; Sentry integrado |
| Validación | Zod en variables de entorno y en todos los bodies |

---

## 3. Vulnerabilidades

### 3.1 Dependencias (`pnpm audit --prod`: 3 critical, 11 high, 5 moderate, 1 low)

| Severidad | Paquete | Problema | Vía | Fix |
|---|---|---|---|---|
| **CRITICAL ×3** | `fast-jwt` | Algorithm confusion, bypass con HMAC secret vacío, cache confusion | `@fastify/jwt@8` | Subir a `@fastify/jwt@10` (requiere Fastify 5) |
| **HIGH** | `fastify@4` | Bypass de validación de body vía tab en Content-Type | directo | Fastify `>=5.7.2` |
| **HIGH ×2** | `fast-uri` | Path traversal y host confusion vía percent-encoding | fastify | Se resuelve con Fastify 5 |
| **HIGH** | `ws` | DoS por agotamiento de memoria | socket.io | Subir socket.io / override `ws>=8.21.0` |
| **HIGH ×7** | `tar` | Path traversal / overwrite (solo build-time) | `bcrypt→node-pre-gyp` | Migrar a `bcryptjs` o pnpm override |
| MODERATE | `fast-jwt`, `fastify`, `uuid`, `tar` | Varios | - | Mismos upgrades |

**Contexto de riesgo real:** las 3 críticas de `fast-jwt` están **mitigadas parcialmente** hoy porque el server fuerza `algorithms: ['HS256']` en firma y verificación, y `JWT_SECRET` exige mínimo 32 caracteres. Aun así, el upgrade es obligatorio a mediano plazo - es la librería que sostiene toda la autenticación.

**Acción:** migración planificada `fastify@4 → 5`, `@fastify/jwt@8 → 10`, `@fastify/cors`, `@fastify/cookie`, `@fastify/rate-limit` a sus majors compatibles con v5. Es un cambio mecánico pero hay que probar login/refresh/webhook a fondo.

### 3.2 Código propio

| # | Severidad | Problema | Archivo |
|---|---|---|---|
| S1 | **Media** | `POST /public/submit` sin rate limit propio: un token de formulario es válido 7 días, sin revocación, y permite crear pedidos ilimitados (solo lo frena el rate limit global de 100/min por IP). Alguien con el link puede llenar el tablero de pedidos basura. | `routes/public.ts` |
| S2 | **Media** | Si `META_APP_SECRET` no está configurado, el webhook acepta POSTs **sin verificar firma HMAC** (solo un `log.warn`). Cualquiera que conozca la URL puede inyectar mensajes falsos en los chats. | `routes/webhook.ts:168` |
| S3 | Baja | Verificación del webhook GET: si `META_WEBHOOK_VERIFY_TOKEN` no está definido y la request tampoco lo trae, `undefined === undefined` pasa el handshake. | `routes/webhook.ts:185` |
| S4 | Baja | Un admin puede crear usuarios con rol `dev` (`createUserSchema` acepta `'dev'`), y `dev` es super-rol que pasa todos los `requireRole`. Escalada de privilegios dentro de la org. | `routes/users.ts:10` |
| S5 | Baja | No hay detección de reuso de refresh token: si un token rotado (robado) se reintenta, solo devuelve 401 - lo correcto es revocar toda la familia de tokens del usuario. | `routes/auth.ts:94` |
| S6 | Baja | `wpp_meta_token` (token de Meta API) guardado en texto plano en DB. Si la DB se filtra, el token de WhatsApp queda expuesto. Considerar cifrado at-rest (AES-GCM con key en env). | `schema.prisma:18` |
| S7 | Baja | Contraseñas seed con defaults débiles (`admin123`, `josejose`) definidas en `config.ts`. Si las vars no se setean en Railway y alguien corre el seed standalone, quedan cuentas débiles. | `config.ts:20-21` |
| S8 | Info | PDFs de facturas accesibles sin auth por URL. Mitigado: nombre incluye 12 hex aleatorios (48 bits, no adivinable). Pero las URLs no expiran nunca. | `routes/files.ts:46` |

---

## 4. Bugs confirmados

| # | Severidad | Bug | Detalle | Archivo |
|---|---|---|---|---|
| B1 | **Media** | Falsa advertencia "los datos se perderán" en Nuevo Pedido | `hasDirty = !!(nombre.trim() \|\| telefono.trim() \|\| ...)` - al abrir desde un ticket, `nombre`/`telefono` ya vienen pre-llenados con `preNombre`/`prePhone`, así que `hasDirty` es `true` de inmediato. Cerrar sin tocar nada dispara el confirm. Fix: comparar contra los valores iniciales, no contra vacío. | `NuevoPedidoModal.tsx:75` |
| B2 | **Media** | Subida de factura falla con PDFs > ~750 KB | Fastify tiene `bodyLimit` default de **1 MB** y el endpoint acepta base64 de hasta 28 MB. Un PDF de 1 MB (1.33 MB en base64) devuelve 413. Fix: `bodyLimit: 30_000_000` en la ruta o en el server. | `routes/files.ts:15`, `server.ts:36` |
| B3 | **Media** | Cierre de caja borra las notas del pedido | Al mover un pedido a mañana: `data: { fecha: tomorrow, notes: 'pasado_manana:...' }` **reemplaza** las notas que el pedido ya tenía (indicaciones de entrega, etc.). Fix: concatenar en vez de sobrescribir. | `routes/cierre.ts:61` |
| B4 | Baja | Race condition en número de pedido | `num = count + 1` se calcula fuera de la transacción de creación. Dos pedidos simultáneos (ej. dos encargados, o form + encargado) pueden chocar contra `@@unique([org_id, num, fecha])` → error 500. Fix: retry en P2002 o secuencia en DB. | `routes/orders.ts:93`, `routes/public.ts:106` |
| B5 | Baja | Descarga de factura inexistente devuelve 500 en vez de 404 | `fs.realpathSync(filepath)` lanza ENOENT si el archivo no existe, **antes** del check `existsSync`. Fix: envolver en try/catch o chequear existencia primero. | `routes/files.ts:61` |
| B6 | Baja | Socket con token viejo tras refresh | `getSocket(token)` crea el singleton una vez; si el access token rota (cada 15 min), una reconexión del socket usa el token vencido y falla la auth del handshake → deja de recibir eventos en tiempo real hasta recargar. Fix: `auth` como callback (`auth: (cb) => cb({ token: useAuthStore.getState().accessToken })`). | `lib/socket.ts:6` |
| B7 | Cosmético | "Total estimado" del formulario puede engañar | El precio del ítem es `price_per_unit` sin multiplicar por cantidad (la cantidad es texto libre "2 kg"). Un pedido de "5 kg papa" muestra el precio de 1 unidad. El texto ya dice "estimado", pero conviene ocultar el total si hay cantidades > 1 o etiquetarlo mejor. | `routes/public.ts:143` |
| B8 | Cosmético | Historial por pedido en tab "Activos" del Informe del día sigue con el layout viejo (no la tabla columnar Fecha/Quién/Campo/Antes/Después que ya tienen el detalle del pedido y el tab "Cambios"). | `ResumenTab.tsx` |

---

## 5. Deuda técnica y calidad

| Área | Estado | Observación |
|---|---|---|
| **Tests** | 0 archivos de test | El riesgo más grande del proyecto. Cada deploy es fe ciega. Prioridad: tests de integración de `auth`, `orders` (cobro/lock), `cierre` y `webhook` con vitest + una DB de test. |
| **CI/CD** | No existe | Ni GitHub Actions ni checks pre-merge. Mínimo viable: `tsc --noEmit` + `pnpm audit` + tests en cada PR. |
| **ConfigTab.tsx** | 1.121 líneas | Monolito: gestión de usuarios + productos + WPP + welcome message en un archivo. Dividir en 4 componentes. |
| **DetallePedidoModal.tsx** | 716 líneas | Aceptable pero al límite. El historial-tabla podría extraerse a `HistoryTable.tsx` y reutilizarse en ResumenTab (hoy la tabla está duplicada). |
| **Routing** | Check manual de `pathname` | Funciona para 2 rutas (`/` y `/form`). Si se agrega una tercera pantalla, migrar a react-router o wouter. |
| **Modelo `OrderTrash`** | Sin uso | Ninguna ruta lo escribe (papelera se maneja con `status`). Borrar el modelo o implementarlo. |
| **Campo `wpp_meta_app_secret`** | Sin uso | El webhook valida con el `META_APP_SECRET` global, no el de la org. Para multi-tenant real con múltiples números WPP hay que usar el de la org. Hoy: campo muerto. |
| **`refresh_tokens`** | Crece sin límite | Tokens revocados/expirados nunca se borran. Agregar `deleteMany` de expirados en el login o un cron. |
| **`pasado_manana:` en `notes`** | Frágil | Usar el campo `deferred_to` (ya existe en Ticket) también en Order, o un campo dedicado, en vez de parsear strings en notes. |
| **Ramas git** | 18 ramas locales viejas | `feature/phase-1a...1d`, `fix/*` ya mergeadas. Limpiar con `git branch -d`. |
| **Casts `as any`** | ~10 usos | Concentrados en emits de socket (`order as any`) y `fastify.jwt.sign as any`. Tipar `ServerToClientEvents` correctamente los eliminaría. |
| **Paginación inbox** | `take: 500` | Suficiente hoy; con volumen real necesitará cursor pagination (el frontend ya manda `page` pero el backend lo ignora). |

---

## 6. Arquitectura - evaluación

**Bien:**
- Monorepo pnpm limpio (`api` / `web` / `shared` con tipos compartidos).
- Esquema Prisma correcto: relaciones bien definidas, `onDelete: Cascade` donde toca, uniques compuestos (`org_id+email`, `org_id+phone+fecha`, `org_id+num+fecha`), `Decimal` para dinero (no float).
- Transacciones Prisma en operaciones multi-paso (update de pedido + historial, cierre de caja).
- Auditoría completa en `order_history` con actor, antes/después.
- Manejo de zona horaria Colombia (UTC-5) consistente en el backend.
- Webhook responde 200 inmediato y procesa async (evita reintentos de Meta).

**A vigilar:**
- El "join" fecha↔pedidos-de-mañana vía string en notes (ver arriba).
- `todayStr()` en el frontend usa la hora del navegador; si un usuario tiene el reloj/zona mal configurado verá otro día. Para usuarios en Colombia no es problema hoy.
- Sin backups documentados de la DB de Railway ni estrategia de migración en deploy (verificar que `prisma migrate deploy` corre en el build de Railway).

---

## 7. ROADMAP

### Fase 0 - Esta semana (bugs + seguridad inmediata, ~1 día de trabajo)

- [ ] **B1** Fix falsa advertencia en `NuevoPedidoModal` (comparar contra valores iniciales)
- [ ] **B2** Subir `bodyLimit` para `/files/invoice`
- [ ] **B3** Cierre de caja: concatenar notas en vez de sobrescribir
- [ ] **B5** 404 correcto en factura inexistente
- [ ] **S1** Rate limit dedicado en `/public/submit` (ej. 5/min por IP) + límite de pedidos por token (ej. máx 3)
- [ ] **S2** Hacer `META_APP_SECRET` obligatorio en producción (fallar el arranque, no solo warn)
- [ ] **S4** Quitar `'dev'` de los roles que un admin puede asignar
- [ ] **B6** Socket: leer token del store en cada (re)conexión

### Fase 1 - Próximas 2 semanas (dependencias + robustez)

- [ ] Migrar a **Fastify 5** + `@fastify/jwt@10` + plugins v5 (elimina las 3 críticas y 4 altas)
- [ ] Override o upgrade de `ws` (socket.io) y `tar`/`bcrypt` (o migrar a `bcryptjs`)
- [ ] **B4** Retry en colisión de número de pedido (P2002)
- [ ] **S5** Detección de reuso de refresh token → revocar familia completa
- [ ] Limpieza automática de `refresh_tokens` expirados
- [ ] **B7/B8** Ajustes cosméticos (total estimado del form, historial en tab Activos)

### Fase 2 - Este mes (calidad y confianza en deploys)

- [ ] **Vitest + tests de integración** de las rutas críticas: auth (login/refresh/rotación), orders (crear/editar/cobrar/lock), cierre de caja, webhook (HMAC/dedup/replay)
- [ ] **GitHub Actions**: `tsc --noEmit` + tests + `pnpm audit` en cada PR a `dev`/`main`
- [ ] Verificar/documentar `prisma migrate deploy` en el pipeline de Railway y backups de la DB
- [ ] Limpiar las 18 ramas viejas de git

### Fase 3 - Backlog (cuando haya más de 1 organización o más volumen)

- [ ] Usar `wpp_meta_app_secret` por organización en la validación del webhook (multi-tenant WPP real)
- [ ] Cifrar `wpp_meta_token` at-rest
- [ ] Dividir `ConfigTab.tsx` (1.121 líneas) en componentes; extraer `HistoryTable` compartida
- [ ] Reemplazar `pasado_manana:` en notes por campo dedicado en Order
- [ ] Paginación real (cursor) en inbox
- [ ] Migrar routing a react-router/wouter si se agregan pantallas
- [ ] Borrar modelo `OrderTrash` o implementarlo
- [ ] Expiración de URLs de facturas (signed URLs de R2)

---

## 8. Veredicto

| Dimensión | Nota | Comentario |
|---|---|---|
| Seguridad (diseño propio) | 8.5/10 | Muy por encima del promedio para un proyecto de este tamaño |
| Seguridad (dependencias) | 5/10 | Fastify 4 EOL-bound; upgrade a v5 es el ítem más importante |
| Correctitud / bugs | 7/10 | 6 bugs reales, ninguno de pérdida de dinero; B3 (notas borradas) es el más dañino |
| Calidad de código | 7.5/10 | TS estricto y limpio; archivos grandes y `as any` puntuales |
| Testing / CI | 1/10 | Inexistente - el mayor riesgo del proyecto |
| Arquitectura | 8/10 | Monorepo y esquema sólidos; deuda puntual bien identificada |

**Prioridad #1:** Fase 0 completa (un día de trabajo elimina todos los bugs visibles para el usuario y los dos huecos de seguridad de configuración).
**Prioridad #2:** upgrade Fastify 5.
**Prioridad #3:** tests + CI antes de sumar más features.
