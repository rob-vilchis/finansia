# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Finansia** — A personal finance management app built for Mexico (Spanish-language UI, Mexican Pesos). Features AI-powered chat for managing transactions, bank statement PDF parsing, financial tips generation, expense tracking with categories, financial goals, and spending analysis charts.

## Commands

- `npm run dev` — Start Next.js dev server
- `npm run build` — Production build
- `npm run lint` — ESLint
- `npm run db:generate` — Generate Drizzle migrations
- `npm run db:push` — Push schema to database (no migration files)
- `npm run db:migrate` — Run migrations
- `npm run telegram:setup -- <https-url>` — Register the Telegram webhook + bot commands

## Tech Stack

- **Framework**: Next.js 15 (App Router, React 19)
- **Auth**: Clerk (`@clerk/nextjs`)
- **Database**: PostgreSQL via Neon (`@neondatabase/serverless`), ORM is Drizzle
- **AI**: Vercel AI SDK v5 (`ai` package) via AI Gateway — Claude Sonnet for chat, the Telegram bot and statement parsing; GPT-5 for tips
- **UI**: Tailwind CSS v4, Radix UI Themes, MUI (date pickers), Recharts, Vaul (drawers), Lucide icons
- **Forms**: react-hook-form + zod + @hookform/resolvers
- **Styling**: `clsx` + `tailwind-merge` via `lib/utils.ts`

## Architecture

### Routing (App Router)

- `/` — Landing/redirect page
- `/home` — Dashboard with accounts, goals, tips
- `/data` — Transaction list with DataDashboard
- `/data/review` — Review unverified transactions (from PDF imports)
- `/categories` — Category management
- `/categories/[id]` — Category detail
- `/analysis` — Spending analysis with charts
- `/telegram` — Connect/disconnect the Telegram bot

### API Routes (`app/api/`)

All API routes authenticate via `currentUser()` from Clerk. Key routes:
- `chat/` — AI chat with tool-calling (create/retrieve/delete transactions)
- `transactions/` — CRUD for transactions (GET, POST, PATCH, DELETE)
- `upload-statement/` — PDF bank statement upload and AI-powered parsing (background processing)
- `tips/` — Financial tips
- `cron/` — Scheduled tasks (tips generation)
- `accounts/`, `categories/`, `goals/`, `expenses/`, `pie-chart/`

### Server Actions (`app/actions/`)

Used for goals and accounts CRUD. Return `{ success, message, data? }` pattern. Error messages are in Spanish.

### Database (`lib/db/`)

- `lib/db/index.ts` — Drizzle client, uses `DATABASE_URL` env var
- `lib/db/schema/` — Table definitions (transactions, accounts, categories, financial_goals, financial_tips, users, statementUploads, resources, expenses)
- IDs use `nanoid()` from `lib/utils.ts`
- Account balances are computed dynamically via SQL (sum of incoming minus outgoing transactions)
- Goal progress is computed similarly from linked account transactions

### Services (`lib/services/`)

Business logic layer between API routes and database:
- `transactions.ts` — Create, query, delete transactions; resolves names to IDs for accounts/categories
- `statements.ts` — Statement upload management
- `goals.ts` — Goal operations

### Client State

- `TransactionsContext` — Provides `refreshTransactions()` trigger (counter-based) for re-fetching after mutations
- `ChatContext` — Wraps Vercel AI SDK's `useChat`, provides shared chat state across the app; auto-refreshes transactions on tool calls

### AI Chat System (`lib/ai/financeAssistant.ts`)

`buildFinanceAssistant(userId, { extraInstructions })` returns the system prompt and the full tool set scoped to one user. It is shared by the web chat (`app/api/chat/route.ts`, `streamText`) and the Telegram bot (`generateText`), so **add or change tools there, not in a route**. Tools include:
- `createTransaction` — Creates transactions with zod validation (category-type cross-validation via `superRefine`)
- `retrieveTransactions` — Query transactions by any combination of filters
- `deleteTransactions` — Delete matching transactions

Tool input schemas dynamically build `z.enum()` arrays from the user's actual categories and accounts.

### Telegram Bot (`lib/telegram/`, `app/api/telegram/webhook/route.ts`)

- Webhook is public in `middleware.ts` and authenticated by the `X-Telegram-Bot-Api-Secret-Token` header (`TELEGRAM_WEBHOOK_SECRET`). It returns 200 immediately and processes the update in `waitUntil` so Telegram never re-delivers (which would duplicate transactions).
- Linking: `/telegram` page → `createTelegramLinkAction` creates a 15-min one-time code → deep link `t.me/<bot>?start=<code>` → bot consumes it (`lib/services/telegram.ts`). One chat per user.
- Memory: each exchange (user message + `response.messages`, including tool calls/results) is one `telegram_turns` row; the last 10 turns from the past 12h are replayed. Images/PDFs are passed to the model but stored only as a text placeholder.
- Replies: model Markdown → Telegram HTML (`lib/telegram/format.ts`), chunked under 4096 chars, plain-text fallback on 400.
- Commands: `/start`, `/ayuda`, `/nuevo`, `/desvincular`. Voice notes are not supported yet.

### Statement Processing (`app/api/upload-statement/route.ts`)

PDF upload flow: upload file → parse with pdf2json → send to Claude Sonnet via `generateObject` → create transactions. Runs as fire-and-forget background processing. Unverified transactions (where AI couldn't classify) are flagged with `isUnverified: true` for user review.

## Key Patterns

- Path alias: `@/*` maps to project root
- Transaction types: `"income"`, `"expense"`, `"transfer"` — each has different source/target account semantics
- Categories have a `type` field matching transaction types; transfers have no category
- All user-facing error messages and UI text are in **Spanish**
- `force-dynamic` is set on the root layout — all pages are server-rendered on every request

## Design System — Glassmorphism OS

The app uses a dark-only glassmorphism aesthetic. All design tokens live in `app/globals.css` under `:root` and are exposed as Tailwind utilities via `@theme inline`. **Never use raw color values like `bg-white/6`, `text-white/40`, `border-white/10`, `bg-gray-950`, etc. — always use the semantic tokens below.**

### Tailwind Utilities (generated from tokens)

| Category | Utilities |
|---|---|
| Page background | `bg-app`, `bg-app-elevated` |
| Surfaces | `bg-surface`, `bg-surface-strong`, `bg-surface-hover` |
| Borders | `border-edge`, `border-edge-strong`, `border-edge-soft` |
| Text | `text-ink`, `text-ink-muted`, `text-ink-subtle`, `text-ink-faint` |
| Accent (cyan) | `bg-accent-soft`, `border-accent-border`, `text-accent`, `text-accent-fg` |
| Income (emerald) | `text-income`, `bg-income-soft`, `border-income-border` |
| Expense (rose) | `text-expense`, `bg-expense-soft`, `border-expense-border` |
| Warning (amber) | `text-warn`, `bg-warn-soft`, `border-warn-border` |
| Transfer (cyan) | `text-transfer`, `bg-transfer-soft`, `border-transfer-border` |

### Glass Primitives — `app/components/ui/glass.tsx`

Shared components used across all dialogs and pages. Always prefer these over re-inventing inline styles:

- `GlassInput` — text input with optional `leadingIcon`
- `GlassTextarea` — resizable textarea
- `GlassSelect` — native `<select>` with chevron; add `scheme-dark` so the option popup is dark
- `GlassButton` — variants: `primary` (cyan), `secondary` (neutral), `danger` (rose), `ghost`
- `GlassSegmented` — pill-style toggle group
- `GlassCard` — `bg-surface backdrop-blur-md border border-edge rounded-xl`
- `GlassDialogShell` — standard dialog header: icon medallion + title + subtitle + divider
- `glassDialogContent` — className string for Radix `Dialog.Content` to style the dialog chrome
- `FieldLabel` / `FieldError` — form field label and validation error
- `SectionHeading` — small uppercase section title

### Dialog Pattern

All dialogs use Radix `Dialog.Root` / `Dialog.Content` (kept as chrome, restyled) with:

```tsx
import { Dialog, VisuallyHidden } from "@radix-ui/themes";
import { GlassDialogShell, glassDialogContent } from "@/app/components/ui/glass";

<Dialog.Content maxWidth="420px" className={glassDialogContent}>
  <VisuallyHidden><Dialog.Title>…</Dialog.Title></VisuallyHidden>
  <GlassDialogShell icon={<Icon size={16} />} title="…" subtitle="…">
    {/* form content */}
    <div className="flex justify-end gap-2 pt-4 border-t border-edge-soft mt-2">
      <GlassButton variant="secondary" …>Cancelar</GlassButton>
      <GlassButton variant="primary" …>Guardar</GlassButton>
    </div>
  </GlassDialogShell>
</Dialog.Content>
```

### Page Layout Pattern

Every client page wraps its content in:

```tsx
<div className="min-h-screen bg-app font-(family-name:--font-outfit) w-full px-5 md:px-10 py-8">
  <div className="w-full max-w-[…] mx-auto">
    …
  </div>
</div>
```

### Tailwind v4 Notes

- Important modifier suffix: `p-2!` not `!p-2`
- Font family: `font-(family-name:--font-outfit)`
- Color scheme: `scheme-dark` class (sets `color-scheme: dark` — required on `<select>` so native option popups render dark)
- Native `<option>` elements have a global base style in `globals.css` that sets `background-color: var(--app-elevated)` and `color: var(--ink)` for consistent dark popup rendering across browsers
