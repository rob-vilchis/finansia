import {
  buildFinanceAssistant,
  FINANCE_ASSISTANT_MODEL,
} from "@/lib/ai/financeAssistant";
import {
  clearConversation,
  consumeLinkCode,
  getConversationHistory,
  getLinkByChatId,
  saveConversationTurn,
  unlinkUser,
} from "@/lib/services/telegram";
import { generateText, stepCountIs, type ModelMessage, type UserContent } from "ai";
import {
  callTelegram,
  downloadTelegramFile,
  sendChatAction,
  TelegramApiError,
  type TelegramMessage,
  type TelegramUpdate,
} from "./api";
import { chunkMessage, markdownToTelegramHtml } from "./format";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const TELEGRAM_INSTRUCTIONS = `
CHANNEL: You are replying inside Telegram, usually on a phone, often right after the user paid for something.
- Keep replies short: one to four lines for confirmations. No preamble.
- Formatting: only **bold**, _italic_, \`code\` and simple "-" lists. No tables, no headings, no links.
- Format money like $1,234.50 MXN.
- To register a transaction, call createTransaction right away when the amount and what it was for are clear. Don't ask for confirmation for creations; the user can say "corrige" or "borra eso" afterwards.
- If the user doesn't name an account, pick the most likely one from their recent transactions (or their only account) and say which one you used so they can correct it.
- If the user doesn't give a time, use the current Mexico City time. If they say "ayer", "el viernes", etc., resolve it against the current date.
- After creating, confirm in one line: what, amount, category, account. E.g. "✅ Gasolina — $800.00 MXN · Transporte · Tarjeta".
- Several items in one message (e.g. "uber 120, cena 450") → create each one.
- Deletes still need explicit confirmation: ask, and wait for the user's next message.
- RECEIPTS / SCREENSHOTS: when the user sends an image (ticket, receipt, bank app screenshot, transfer voucher), read the merchant, total and date from it and register it as a transaction following the rules above. If the image has no financial information, say so briefly. If it's unreadable, ask for a clearer photo.
`;

const HELP_TEXT = `<b>Así puedes usarme</b>

• <i>"Gasté 180 en el súper con la tarjeta"</i>
• <i>"Uber 95 y café 60"</i>
• <i>"Me cayó la quincena, 12,500"</i>
• <i>"¿Cuánto llevo gastado en restaurantes este mes?"</i>
• <i>"Borra el último gasto"</i>
• 📷 Mándame la foto de un ticket o una captura de tu app del banco

<b>Comandos</b>
/nuevo — empezar una conversación nueva
/ayuda — ver este mensaje
/desvincular — desconectar tu cuenta de Finansia`;

function appUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel}` : null;
}

function notLinkedText(): string {
  const url = appUrl();
  return [
    "👋 Hola, soy el asistente de <b>Finansia</b>.",
    "",
    "Para empezar, conecta tu cuenta: abre Finansia, ve a <b>Telegram</b> en el menú y toca <b>Conectar</b>.",
    url ? `\n${url}/telegram` : "",
  ].join("\n");
}

async function sendHtml(chatId: number, html: string) {
  await callTelegram("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

/** Sends model output (Markdown-ish) as HTML, falling back to plain text. */
async function sendReply(chatId: number, markdown: string) {
  for (const chunk of chunkMessage(markdown)) {
    try {
      await sendHtml(chatId, markdownToTelegramHtml(chunk));
    } catch (error) {
      if (error instanceof TelegramApiError && error.status === 400) {
        await callTelegram("sendMessage", { chat_id: chatId, text: chunk });
      } else {
        throw error;
      }
    }
  }
}

/** Shows "typing…" until `stop` is called (Telegram clears it after ~5s). */
function keepTyping(chatId: number) {
  sendChatAction(chatId).catch(() => {});
  const interval = setInterval(() => {
    sendChatAction(chatId).catch(() => {});
  }, 4500);
  return () => clearInterval(interval);
}

function parseCommand(text: string): { command: string; arg: string } | null {
  const match = text.trim().match(/^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { command: match[1].toLowerCase(), arg: (match[2] ?? "").trim() };
}

/** Finds an image the model can read in the message (photo or image/PDF file). */
function getAttachment(message: TelegramMessage) {
  if (message.photo?.length) {
    // Telegram sends several sizes; the last is the largest.
    const largest = message.photo[message.photo.length - 1];
    return { fileId: largest.file_id, size: largest.file_size, kind: "image" as const };
  }
  const doc = message.document;
  if (doc?.mime_type?.startsWith("image/")) {
    return { fileId: doc.file_id, size: doc.file_size, kind: "image" as const };
  }
  if (doc?.mime_type === "application/pdf") {
    return { fileId: doc.file_id, size: doc.file_size, kind: "pdf" as const };
  }
  return null;
}

export async function handleTelegramUpdate(update: TelegramUpdate) {
  const message = update.message;
  if (!message) return;

  const chatId = message.chat.id;
  const chatKey = String(chatId);

  if (message.chat.type !== "private") {
    await sendHtml(chatId, "Por privacidad, solo funciono en chats privados.");
    return;
  }

  const text = (message.text ?? message.caption ?? "").trim();
  const command = parseCommand(message.text ?? "");

  // /start <code> — link this chat to a Finansia account.
  if (command?.command === "start") {
    if (command.arg) {
      const userId = await consumeLinkCode(
        command.arg,
        chatKey,
        message.from?.username,
      );
      if (!userId) {
        await sendHtml(
          chatId,
          "Ese enlace ya expiró o no es válido. Genera uno nuevo desde Finansia → <b>Telegram</b>.",
        );
        return;
      }
      await sendHtml(
        chatId,
        `✅ <b>¡Listo! Tu cuenta de Finansia está conectada.</b>\n\nCuéntame tus gastos como se lo dirías a un amigo y yo los registro.\n\n${HELP_TEXT}`,
      );
      return;
    }
    const existing = await getLinkByChatId(chatKey);
    await sendHtml(chatId, existing ? HELP_TEXT : notLinkedText());
    return;
  }

  const link = await getLinkByChatId(chatKey);
  if (!link) {
    await sendHtml(chatId, notLinkedText());
    return;
  }

  if (command) {
    switch (command.command) {
      case "ayuda":
      case "help":
        await sendHtml(chatId, HELP_TEXT);
        return;
      case "nuevo":
      case "reset":
        await clearConversation(chatKey);
        await sendHtml(chatId, "🧹 Listo, empezamos de cero. ¿Qué registramos?");
        return;
      case "desvincular":
        await unlinkUser(link.userId);
        await sendHtml(
          chatId,
          "Tu cuenta de Finansia se desconectó de este chat. Puedes volver a conectarla cuando quieras desde la app.",
        );
        return;
      default:
        await sendHtml(chatId, `No conozco ese comando.\n\n${HELP_TEXT}`);
        return;
    }
  }

  if (message.voice || message.audio) {
    await sendHtml(
      chatId,
      "🎙️ Todavía no entiendo notas de voz. Escríbeme el gasto o mándame la foto del ticket.",
    );
    return;
  }

  const attachment = getAttachment(message);
  if (!attachment && !text) {
    await sendHtml(
      chatId,
      "Solo entiendo texto, fotos de tickets y PDFs por ahora.",
    );
    return;
  }
  if (attachment?.size && attachment.size > MAX_FILE_BYTES) {
    await sendHtml(chatId, "Ese archivo es muy grande (máx. 10 MB).");
    return;
  }

  const stopTyping = keepTyping(chatId);
  try {
    // What the model sees this turn vs. what we store (no raw bytes in the DB).
    let content: UserContent = text;
    let storedContent: UserContent = text;

    if (attachment) {
      const file = await downloadTelegramFile(attachment.fileId);
      const prompt =
        text ||
        "Registra este ticket/comprobante como transacción.";
      content = [
        attachment.kind === "pdf"
          ? { type: "file", data: file.data, mediaType: "application/pdf" }
          : { type: "image", image: file.data, mediaType: file.mediaType },
        { type: "text", text: prompt },
      ];
      storedContent = `[El usuario envió ${attachment.kind === "pdf" ? "un PDF" : "una imagen"}] ${prompt}`;
    }

    const [{ system, tools }, history] = await Promise.all([
      buildFinanceAssistant(link.userId, {
        extraInstructions: TELEGRAM_INSTRUCTIONS,
      }),
      getConversationHistory(chatKey),
    ]);

    const result = await generateText({
      model: FINANCE_ASSISTANT_MODEL,
      system,
      tools,
      messages: [...history, { role: "user", content }],
      stopWhen: stepCountIs(10),
    });

    const reply =
      result.text.trim() ||
      (result.steps.some((step) => step.toolCalls.length > 0)
        ? "✅ Listo."
        : "No entendí bien, ¿me lo puedes decir de otra forma?");

    stopTyping();
    await sendReply(chatId, reply);

    const turn: ModelMessage[] = [
      { role: "user", content: storedContent },
      ...result.response.messages,
    ];
    await saveConversationTurn(chatKey, link.userId, turn);
  } catch (error) {
    stopTyping();
    console.error("Telegram bot error:", error);
    await sendHtml(
      chatId,
      "😕 Algo salió mal procesando tu mensaje. Intenta de nuevo en un momento.",
    ).catch(() => {});
  } finally {
    stopTyping();
  }
}
