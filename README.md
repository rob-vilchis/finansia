# Finansia

**Finansia** es una aplicación de gestión de finanzas personales que combina un asistente de chat con IA, lectura automática de estados de cuenta y análisis visual de gastos para que llevar el control de tu dinero sea sencillo.

> Administra tus transacciones conversando en lenguaje natural, sube un estado de cuenta en PDF y deja que la IA lo categorice, define metas de ahorro y visualiza a dónde se va tu dinero, todo en una sola interfaz oscura y glassmorphic.

---

## Características

- **Asistente de chat con IA** — Crea, consulta y elimina transacciones de forma conversacional. El asistente usa tool-calling y valida contra tus categorías y cuentas reales.
- **Importación de estados de cuenta** — Sube un estado de cuenta en PDF; se procesa con IA y se convierte en transacciones automáticamente. Los movimientos que la IA no puede clasificar con confianza quedan marcados para revisión.
- **Cuentas y saldos** — Gestiona múltiples cuentas con saldos calculados dinámicamente a partir de las transacciones.
- **Categorías** — Organiza ingresos, gastos y transferencias; las categorías están tipadas para coincidir con el tipo de transacción.
- **Metas financieras** — Define objetivos de ahorro vinculados a cuentas, con progreso calculado automáticamente.
- **Transacciones recurrentes** — Administra ingresos y gastos que se repiten.
- **Análisis de gastos** — Gráficas y desgloses de en qué se va el dinero.
- **Consejos financieros con IA** — Consejos personalizados generados de forma programada.
- **Bot de Telegram** — Registra gastos con un mensaje o la foto de un ticket, con las mismas capacidades que el chat de la app.

## Stack Tecnológico

| Área | Tecnología |
|---|---|
| Framework | Next.js 15 (App Router), React 19 |
| Lenguaje | TypeScript |
| Autenticación | [Clerk](https://clerk.com) |
| Base de datos | PostgreSQL ([Neon](https://neon.tech), driver serverless) |
| ORM | [Drizzle](https://orm.drizzle.team) |
| IA | [Vercel AI SDK v5](https://sdk.vercel.ai) vía AI Gateway — GPT-5 (chat) y Claude Sonnet 4.5 (lectura de estados de cuenta) |
| UI | Tailwind CSS v4, Radix UI Themes, MUI date pickers, Recharts, Vaul, Lucide icons |
| Formularios | react-hook-form + Zod |
| Monitoreo | Sentry |
| Lectura de PDF | pdf2json / pdf-parse |

## Primeros Pasos

### Requisitos

- Node.js 20+
- Una base de datos PostgreSQL (por ejemplo, un proyecto de [Neon](https://neon.tech))
- Una aplicación de [Clerk](https://clerk.com)
- Una clave de proveedor de IA (Vercel AI Gateway / OpenAI)

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar el entorno

Crea un archivo `.env` en la raíz del proyecto:

```bash
# Base de datos (Neon / PostgreSQL)
DATABASE_URL=postgres://...

# Autenticación con Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...

# IA — Vercel AI Gateway (enruta modelos openai/* y anthropic/*)
AI_GATEWAY_API_KEY=...
# o, si llamas a OpenAI directamente
OPENAI_API_KEY=sk-...

# Tareas programadas (generación de consejos financieros)
CRON_SECRET=...

# Sentry (opcional)
SENTRY_AUTH_TOKEN=...

# Bot de Telegram (opcional)
TELEGRAM_BOT_TOKEN=123456:ABC...       # de @BotFather
TELEGRAM_WEBHOOK_SECRET=...            # openssl rand -hex 32
TELEGRAM_BOT_USERNAME=finansia_bot     # opcional, evita una llamada a getMe
NEXT_PUBLIC_APP_URL=https://tu-app.vercel.app
```

### 3. Configurar la base de datos

```bash
npm run db:push      # aplica el esquema a tu base de datos
```

### 4. Levantar el servidor de desarrollo

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

### 5. Bot de Telegram (opcional)

1. Crea un bot con [@BotFather](https://t.me/BotFather) (`/newbot`) y copia el token.
2. Configura las variables `TELEGRAM_*` de arriba (en `.env` y en Vercel).
3. Aplica la migración (`npm run db:migrate`) para crear las tablas `telegram_*`.
4. Despliega y registra el webhook: `npm run telegram:setup -- https://tu-app.vercel.app`
5. En la app, ve a **Telegram** en el menú y toca **Conectar**.

El webhook necesita una URL HTTPS pública; para probar en local usa un túnel (por ejemplo `cloudflared tunnel --url http://localhost:3000`) y vuelve a correr `telegram:setup` con esa URL.

## Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` | Inicia el servidor de desarrollo de Next.js |
| `npm run build` | Build de producción |
| `npm run start` | Inicia el servidor de producción |
| `npm run lint` | Ejecuta ESLint |
| `npm run db:generate` | Genera archivos de migración de Drizzle |
| `npm run db:push` | Aplica el esquema a la base de datos (sin archivos de migración) |
| `npm run db:migrate` | Ejecuta las migraciones |
| `npm run telegram:setup -- <url>` | Registra el webhook y los comandos del bot de Telegram |

## Estructura del Proyecto

```
app/
  (landing)/        Página de inicio / splash
  (auth)/           Inicio y registro de sesión con Clerk
  (main)/
    home/           Dashboard — cuentas, metas, consejos
    data/           Lista de transacciones (y /data/review para importaciones)
    categories/     Gestión y detalle de categorías
    analysis/       Gráficas de análisis de gastos
    recurring/      Transacciones recurrentes
  api/
    chat/           Chat con IA y tool-calling
    transactions/   CRUD de transacciones
    upload-statement/  Subida de PDF y lectura con IA (en background)
    accounts/  categories/  goals/  tips/  summary/  pie-chart/  cron/
  actions/          Server actions (metas, cuentas)
  components/        UI, incluyendo los primitivos del design system glass

lib/
  db/
    index.ts        Cliente de Drizzle
    schema/         Definiciones de tablas
  services/         Lógica de negocio (transacciones, estados de cuenta, metas)
  utils.ts          nanoid, helper cn()
```

## Notas de Arquitectura

- **Tipos de transacción**: `income`, `expense` y `transfer`, cada uno con su propia semántica de cuenta origen/destino. Las categorías llevan un `type` correspondiente; las transferencias no tienen categoría.
- **Saldos y progreso de metas** se calculan dinámicamente vía SQL en lugar de almacenarse, manteniéndolos siempre consistentes con las transacciones subyacentes.
- **Procesamiento de estados de cuenta**: corre como trabajo en background tipo fire-and-forget: parsear el PDF → enviar a Claude Sonnet vía `generateObject` → crear transacciones. Los movimientos no clasificables se marcan como `isUnverified` para revisión manual.
- **El chat con IA** construye dinámicamente esquemas Zod `z.enum()` a partir de las categorías y cuentas reales del usuario, de modo que el modelo solo pueda referenciar cosas que existen.
- Todas las páginas se renderizan en el servidor en cada request (`force-dynamic` en el layout raíz).

## Design System

La aplicación usa una estética **glassmorphism exclusivamente en modo oscuro**. Los design tokens viven en `app/globals.css` (expuestos como utilidades de Tailwind vía `@theme inline`), y los primitivos glass compartidos —inputs, botones, diálogos, cards— viven en `app/components/ui/glass.tsx`. Usa los tokens semánticos (`bg-surface`, `text-ink`, `border-edge`, los sets de color accent/income/expense) en lugar de valores de color crudos. Consulta [CLAUDE.md](./CLAUDE.md) para la referencia completa de tokens y los patrones de diálogo/página.

## Despliegue

Optimizada para [Vercel](https://vercel.com). Configura las variables de entorno anteriores en los ajustes de tu proyecto, conecta una base de datos Neon y despliega. Las tareas programadas (consejos financieros) corren mediante Vercel Cron apuntando a `api/cron`, protegidas por `CRON_SECRET`.
