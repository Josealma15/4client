# 🗺️ RoadMap del Proyecto: 4Client - Fruver San Gabriel

Bienvenido al Roadmap oficial del proyecto **4Client** para el negocio **Fruver San Gabriel**. Este documento es la brújula para todos los agentes y desarrolladores que trabajen en este proyecto. Todo el desarrollo debe estar alineado con lo que se especifica aquí.

---

## 1. 🎯 Visión General
4Client es un sistema de gestión operativa enfocado en resolver el desorden en la recepción de pedidos, despacho de domicilios y recaudo de dinero para Fruver San Gabriel. El objetivo es eliminar la dependencia de procesos manuales (papel, memoria, WhatsApp sin restricciones) para dar paso a un flujo digital organizado, inmutable y seguro.

**Meta Principal:** Proveer orden, trazabilidad y control absoluto, brindando visibilidad en tiempo real al propietario sobre lo que sucede en el negocio.

---

## 2. 🚨 Problemas a Resolver (El "Por Qué")
Cualquier funcionalidad nueva debe apuntar a resolver o mitigar estos problemas actuales:
1. **Pérdida de orden de llegada:** WhatsApp mezcla los mensajes. El sistema debe ordenar los pedidos estrictamente por hora de ingreso.
2. **Falta de inmutabilidad y seguridad:** Los trabajadores no pueden borrar registros, conversaciones ni historiales. La información debe ser segura.
3. **Pérdida de planillas y trazabilidad:** Reemplazar planillas de papel por un panel digital de pedidos y domicilios.
4. **Riesgo en recaudos:** Control estricto de cuánto cobra cada domiciliario y de qué forma (efectivo, transferencia).
5. **Cero visibilidad remota:** El dueño debe poder ver todo lo que pasa sin estar físicamente en el local.

---

## 3. 👥 Roles y Permisos
El sistema debe estar construido sobre una arquitectura estricta de roles:
* **Propietario / Administrador:** Acceso total. Ve todos los pedidos, cobros, historial, resumen del día y puede gestionar usuarios.
* **Encargado de pedidos:** Registra pedidos, actualiza el estado de los mismos, asigna domiciliarios. **NO puede** borrar registros ni alterar el historial.
* **Domiciliario:** Visualiza los pedidos que le han sido asignados, confirma la entrega y registra el recaudo o método de pago.

---

## 4. 🚀 Fase 1: Entregables Principales (MVP)
El desarrollo actual debe centrarse exclusivamente en completar la Fase 1. No agregar funcionalidades como pasarelas de pago (Wompi, Nequi directo) o tiendas públicas e-commerce hasta finalizar esta fase.

*   **Panel de Pedidos (Kanban / Lista Unificada):** 
    *   Flujo de estados: `Nuevo` → `Preparando` → `Listo` → `En camino` → `Entregado`.
    *   Ordenado obligatoriamente por hora de llegada.
*   **Módulo de Registro de Pedidos:** 
    *   Ingreso rápido (Nombre, Dirección, Productos, Método de pago).
*   **Control de Domicilios:** 
    *   Asignación de pedidos a domiciliarios específicos.
    *   Visibilidad clara de dirección y forma de cobro (Contra entrega, transferencia, pagado).
*   **Módulo de Cierre de Cobros:** 
    *   Registro del dinero entregado por el domiciliario, con trazabilidad exacta.
*   **Resumen Diario (Dashboard):** 
    *   Métricas en tiempo real (Total de pedidos, Entregados, Pendientes, Recaudo total).
*   **Historial Inmutable:**
    *   Registro permanente de cada pedido para futuras auditorías.

---

## 5. 💻 Pila Tecnológica (Tech Stack) y Estética
*   **Frontend (Web App):** HTML, CSS (Vanilla), y JavaScript. Si la complejidad lo requiere, se puede inicializar un framework moderno (Next.js o Vite). 
*   **Estilos:** **No usar Tailwind CSS** a menos que se autorice explícitamente. Priorizar CSS Vanilla.
*   **Diseño UI/UX (CRÍTICO):** El diseño debe ser moderno, de calidad "Premium", estéticamente vibrante e interactivo.
    *   Usar micro-animaciones, sombras (glassmorphism si aplica) y esquemas de color bien pensados (modos oscuros elegantes, colores HSL).
    *   Evitar un aspecto de "MVP básico". Debe sorprender al usuario visualmente.
*   **SEO & Semántica:** Aunque es una herramienta interna, mantener el uso de HTML5 semántico, IDs únicos, estructura de headings adecuada y optimización de carga rápida.

---

## 6. 🚦 Directrices de Trabajo para Agentes
1.  **Revisión Constante:** Antes de iniciar cualquier tarea grande, revisa este Roadmap para asegurar que tu código aporta a los objetivos de la Fase 1.
2.  **Seguridad por Diseño:** Asume siempre que el usuario trabajador tiene acceso limitado. Ninguna acción destructiva (DELETE) de registros contables/operativos debe estar expuesta a usuarios que no sean administradores.
3.  **Progreso Evolutivo:** Comienza construyendo una buena base de UI/UX y un sistema de diseño robusto (`index.css` con variables). Luego implementa los componentes y ensambla las páginas.
4.  **No Inventar Requerimientos:** Cíñete a lo especificado en la Propuesta. Si hay duda sobre si incluir una nueva función, consulta con el usuario.
