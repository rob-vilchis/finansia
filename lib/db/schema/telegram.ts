import { nanoid } from "@/lib/utils";
import type { ModelMessage } from "ai";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./user";

/** A Telegram private chat linked to a Finansia user (one chat per user). */
export const telegramLinks = pgTable("telegram_links", {
  id: varchar("id", { length: 191 })
    .primaryKey()
    .$defaultFn(() => nanoid()),
  userId: varchar("user_id", { length: 191 })
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  chatId: varchar("chat_id", { length: 64 }).notNull().unique(),
  telegramUsername: text("telegram_username"),
  linkedAt: timestamp("linked_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Short-lived one-time codes used in the `t.me/<bot>?start=<code>` deep link. */
export const telegramLinkCodes = pgTable(
  "telegram_link_codes",
  {
    code: varchar("code", { length: 64 }).primaryKey(),
    userId: varchar("user_id", { length: 191 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("idx_telegram_link_codes_user").on(table.userId)],
);

/**
 * Conversation memory for the bot. Each row is one exchange: the user's
 * message plus every assistant/tool message the model produced in response,
 * so tool calls and their results are never split across rows.
 */
export const telegramTurns = pgTable(
  "telegram_turns",
  {
    id: varchar("id", { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    chatId: varchar("chat_id", { length: 64 }).notNull(),
    userId: varchar("user_id", { length: 191 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    messages: jsonb("messages").$type<ModelMessage[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_telegram_turns_chat_created").on(table.chatId, table.createdAt),
  ],
);
