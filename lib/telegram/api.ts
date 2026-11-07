/**
 * Minimal Telegram Bot API client (just the methods Finansia needs).
 * Docs: https://core.telegram.org/bots/api
 */

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  voice?: { file_id: string };
  audio?: { file_id: string };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export class TelegramApiError extends Error {
  constructor(
    public method: string,
    public status: number,
    public description: string,
  ) {
    super(`Telegram ${method} failed (${status}): ${description}`);
  }
}

function token(): string {
  const value = process.env.TELEGRAM_BOT_TOKEN;
  if (!value) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return value;
}

export async function callTelegram<T = unknown>(
  method: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as {
    ok: boolean;
    result?: T;
    description?: string;
  } | null;
  if (!res.ok || !data?.ok) {
    throw new TelegramApiError(
      method,
      res.status,
      data?.description ?? res.statusText,
    );
  }
  return data.result as T;
}

export function sendChatAction(chatId: number | string, action = "typing") {
  return callTelegram("sendChatAction", { chat_id: chatId, action });
}

/** Downloads a file sent by the user. Returns its bytes and best-guess MIME type. */
export async function downloadTelegramFile(
  fileId: string,
): Promise<{ data: Uint8Array; mediaType: string }> {
  const file = await callTelegram<{ file_path?: string }>("getFile", {
    file_id: fileId,
  });
  if (!file.file_path) throw new Error("Telegram file has no path");
  const res = await fetch(
    `https://api.telegram.org/file/bot${token()}/${file.file_path}`,
  );
  if (!res.ok) throw new Error(`File download failed (${res.status})`);
  const data = new Uint8Array(await res.arrayBuffer());
  const ext = file.file_path.split(".").pop()?.toLowerCase();
  const mediaType =
    ext === "png"
      ? "image/png"
      : ext === "webp"
        ? "image/webp"
        : ext === "pdf"
          ? "application/pdf"
          : "image/jpeg";
  return { data, mediaType };
}

let cachedBotUsername: string | undefined;

/** Bot username, from TELEGRAM_BOT_USERNAME or (once per instance) getMe. */
export async function getBotUsername(): Promise<string> {
  if (process.env.TELEGRAM_BOT_USERNAME) {
    return process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, "");
  }
  if (!cachedBotUsername) {
    const me = await callTelegram<TelegramUser>("getMe");
    cachedBotUsername = me.username ?? "";
  }
  return cachedBotUsername;
}
