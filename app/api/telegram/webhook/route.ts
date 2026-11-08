import type { TelegramUpdate } from "@/lib/telegram/api";
import { handleTelegramUpdate } from "@/lib/telegram/bot";
import * as Sentry from "@sentry/nextjs";
import { waitUntil } from "@vercel/functions";
import { timingSafeEqual } from "crypto";

// The model can take a while (tool calls, receipt images).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function isValidSecret(received: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Telegram webhook. Telegram signs each request with the secret token we
 * registered via setWebhook (see scripts/setupTelegram.ts).
 *
 * We acknowledge immediately and process in the background so Telegram never
 * times out and re-delivers the same message (which would duplicate
 * transactions).
 */
export async function POST(req: Request) {
  if (!isValidSecret(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  waitUntil(
    handleTelegramUpdate(update).catch((error) => {
      console.error("Unhandled Telegram update error:", error);
      Sentry.captureException(error);
    }),
  );

  return new Response("ok");
}
