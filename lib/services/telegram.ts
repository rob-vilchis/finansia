import { db } from "@/lib/db";
import {
  telegramLinkCodes,
  telegramLinks,
  telegramTurns,
} from "@/lib/db/schema/telegram";
import { and, desc, eq, gt, lt, or } from "drizzle-orm";
import type { ModelMessage } from "ai";
import { randomInt } from "crypto";

const LINK_CODE_TTL_MS = 15 * 60 * 1000;

// No 0/O or 1/I so the code is easy to read and type. 32^8 ≈ 1.1e12 options.
const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LINK_CODE_LENGTH = 8;
const LINK_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

/**
 * Extracts a link code from whatever the user sent: "/start K7M2Q9XF",
 * "k7m2-q9xf", " K7M2 Q9XF ". Returns null if it doesn't look like a code.
 */
export function normalizeLinkCode(input: string): string | null {
  const candidate = input
    .trim()
    .replace(/^\/start(@\w+)?/i, "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
  return LINK_CODE_PATTERN.test(candidate) ? candidate : null;
}

/** "K7M2Q9XF" → "K7M2-Q9XF" for display. */
export function formatLinkCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Creates a one-time code for the `/start <code>` deep link. */
export async function createLinkCode(userId: string) {
  // Clean up this user's old codes and any expired codes.
  await db
    .delete(telegramLinkCodes)
    .where(
      or(
        eq(telegramLinkCodes.userId, userId),
        lt(telegramLinkCodes.expiresAt, new Date()),
      ),
    );

  // Short and typeable: used both as the deep-link start param and as a code
  // the user can send to the bot by hand if their client drops the param.
  const code = Array.from(
    { length: LINK_CODE_LENGTH },
    () => LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)],
  ).join("");
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
  await db.insert(telegramLinkCodes).values({ code, userId, expiresAt });
  return { code, expiresAt };
}

/**
 * Consumes a link code and links the chat to its user. Returns the user id,
 * or null if the code is unknown or expired. A chat can only belong to one
 * user and a user to one chat, so any previous link on either side is replaced.
 */
export async function consumeLinkCode(
  code: string,
  chatId: string,
  telegramUsername?: string,
): Promise<string | null> {
  const [row] = await db
    .delete(telegramLinkCodes)
    .where(
      and(
        eq(telegramLinkCodes.code, code),
        gt(telegramLinkCodes.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!row) return null;

  await db
    .delete(telegramLinks)
    .where(
      or(eq(telegramLinks.userId, row.userId), eq(telegramLinks.chatId, chatId)),
    );
  await db.delete(telegramTurns).where(eq(telegramTurns.chatId, chatId));
  await db.insert(telegramLinks).values({
    userId: row.userId,
    chatId,
    telegramUsername: telegramUsername ?? null,
  });
  return row.userId;
}

export async function getLinkByChatId(chatId: string) {
  const [link] = await db
    .select()
    .from(telegramLinks)
    .where(eq(telegramLinks.chatId, chatId));
  return link ?? null;
}

export async function getLinkByUserId(userId: string) {
  const [link] = await db
    .select()
    .from(telegramLinks)
    .where(eq(telegramLinks.userId, userId));
  return link ?? null;
}

/** Removes the user's link and the bot's conversation memory. */
export async function unlinkUser(userId: string) {
  await db.delete(telegramTurns).where(eq(telegramTurns.userId, userId));
  const deleted = await db
    .delete(telegramLinks)
    .where(eq(telegramLinks.userId, userId))
    .returning();
  return deleted.length > 0;
}

export async function clearConversation(chatId: string) {
  await db.delete(telegramTurns).where(eq(telegramTurns.chatId, chatId));
}

/** Recent turns (oldest first) flattened into model messages. */
export async function getConversationHistory(
  chatId: string,
  { maxTurns = 10, maxAgeMs = 12 * 60 * 60 * 1000 } = {},
): Promise<ModelMessage[]> {
  const rows = await db
    .select({ messages: telegramTurns.messages })
    .from(telegramTurns)
    .where(
      and(
        eq(telegramTurns.chatId, chatId),
        gt(telegramTurns.createdAt, new Date(Date.now() - maxAgeMs)),
      ),
    )
    .orderBy(desc(telegramTurns.createdAt))
    .limit(maxTurns);
  return rows.reverse().flatMap((row) => row.messages);
}

export async function saveConversationTurn(
  chatId: string,
  userId: string,
  messages: ModelMessage[],
) {
  await db.insert(telegramTurns).values({ chatId, userId, messages });

  // Keep the table small: drop turns older than a week for this chat.
  await db
    .delete(telegramTurns)
    .where(
      and(
        eq(telegramTurns.chatId, chatId),
        lt(
          telegramTurns.createdAt,
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        ),
      ),
    );
}
