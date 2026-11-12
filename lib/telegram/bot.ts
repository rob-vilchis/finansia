import {
  buildFinanceAssistant,
  FINANCE_ASSISTANT_MODEL,
  type StatementImportRequest,
} from "@/lib/ai/financeAssistant";
import {
  processStatement,
  startStatementUpload,
  type StatementImportResult,
} from "@/lib/services/statementImport";
import {
  clearConversation,
  consumeLinkCode,
  getConversationHistory,
  getLinkByChatId,
  normalizeLinkCode,
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
- BANK STATEMENTS (PDF): when the user sends a PDF that is a full bank or credit card statement ("estado de cuenta", many movements over a period), call importStatement instead of createTransaction. Pick the account from the bank name, card name or last digits in the PDF and the user's caption; if more than one account fits and the caption doesn't settle it, ask which one and call importStatement after they answer. statementType is "credit" for credit card statements, "checking" for debit/payroll/checking accounts. After calling it, reply in one line that you're processing it and will report when it's done; don't list or invent the transactions. A PDF of a single receipt, invoice or transfer voucher is NOT a statement: register it with createTransaction.
- RECEIPTS / SCREENSHOTS: when the user sends an image (ticket, receipt, bank app screenshot, transfer voucher), read the merchant, total and date from it and register it as a transaction following the rules above. If the image has no financial information, say so briefly. If it's unreadable, ask for a clearer photo.
`;

const HELP_TEXT = `<b>Así puedes usarme</b>

• <i>"Gasté 180 en el súper con la tarjeta"</i>
• <i>"Uber 95 y café 60"</i>
• <i>"Me cayó la quincena, 12,500"</i>
• <i>"¿Cuánto llevo gastado en restaurantes este mes?"</i>
• <i>"Borra el último gasto"</i>
• 📷 Mándame la foto de un ticket o una captura de tu app del banco
• 📄 Mándame el PDF de tu estado de cuenta y lo importo completo

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
    "Para conectar tu cuenta abre Finansia → <b>Telegram</b> → <b>Conectar</b> y envíame aquí el código de 8 caracteres que aparece (por ejemplo <code>K7M2-Q9XF</code>).",
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
    return {
      fileId: doc.file_id,
      size: doc.file_size,
      kind: "pdf" as const,
      fileName: doc.file_name,
    };
  }
  return null;
}

// PDFs are stored in memory only as a text placeholder. The placeholder keeps
// Telegram's file_id (stable for bots) so a statement can still be imported on
// the next message, e.g. after the bot asks which account it belongs to.
const PDF_REF = /\(ref:([A-Za-z0-9_-]+)\)/;

function pdfPlaceholder(fileId: string, fileName?: string) {
  return `[El usuario envió un PDF${fileName ? ` "${fileName}"` : ""} (ref:${fileId})]`;
}

function messageText(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ");
}

/**
 * The PDF from the previous exchange, if the user sent one and it hasn't been
 * imported yet. Only the immediately preceding turn counts.
 */
function findPendingPdf(history: ModelMessage[]) {
  let lastUser = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser === -1) return null;
  const match = messageText(history[lastUser]).match(PDF_REF);
  if (!match) return null;
  const alreadyImported = history
    .slice(lastUser + 1)
    .some(
      (m) =>
        m.role === "assistant" &&
        Array.isArray(m.content) &&
        m.content.some(
          (part) =>
            part.type === "tool-call" && part.toolName === "importStatement",
        ),
    );
  return alreadyImported ? null : { fileId: match[1] };
}

function formatImportSummary(
  request: StatementImportRequest,
  result: StatementImportResult,
): string {
  const url = appUrl();
  if (result.status === "error") {
    return `😕 No pude procesar el estado de cuenta de <b>${escapeHtml(request.accountName)}</b>. Revisa que sea el PDF original del banco o súbelo desde la app.`;
  }
  const lines = [
    result.created > 0
      ? `✅ Importé <b>${result.created}</b> movimiento${result.created === 1 ? "" : "s"} a <b>${escapeHtml(request.accountName)}</b>.`
      : `ℹ️ No encontré movimientos nuevos para <b>${escapeHtml(request.accountName)}</b>.`,
  ];
  if (result.duplicates > 0) {
    lines.push(
      `${result.duplicates} ya estaba${result.duplicates === 1 ? "" : "n"} registrado${result.duplicates === 1 ? "" : "s"}, no los dupliqué.`,
    );
  }
  if (result.failed > 0) {
    lines.push(`⚠️ ${result.failed} no se pudieron guardar.`);
  }
  if (result.needsReview > 0) {
    lines.push(
      `🔎 ${result.needsReview} necesita${result.needsReview === 1 ? "" : "n"} que elijas categoría${url ? `: ${url}/data/review` : " en Datos → Revisar."}`,
    );
  }
  return lines.join("\n");
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

  const existingLink = await getLinkByChatId(chatKey);

  // Linking. Accept "/start <code>" (deep link) from anyone, and a bare code
  // ("K7M2-Q9XF") from chats that aren't linked yet — some Telegram clients
  // open the deep link but send a plain "/start" without the code.
  const startArg = command?.command === "start" ? command.arg : "";
  const linkCode = startArg
    ? normalizeLinkCode(startArg)
    : !existingLink && !command
      ? normalizeLinkCode(text)
      : null;

  if (command?.command === "start") {
    console.info("[telegram] /start", {
      hasPayload: Boolean(startArg),
      linked: Boolean(existingLink),
    });
  }

  if (startArg || linkCode) {
    const userId = linkCode
      ? await consumeLinkCode(linkCode, chatKey, message.from?.username)
      : null;
    if (!userId) {
      await sendHtml(
        chatId,
        "Ese código ya expiró o no es válido. Genera uno nuevo desde Finansia → <b>Telegram</b> y envíamelo.",
      );
      return;
    }
    await sendHtml(
      chatId,
      `✅ <b>¡Listo! Tu cuenta de Finansia está conectada.</b>\n\nCuéntame tus gastos como se lo dirías a un amigo y yo los registro.\n\n${HELP_TEXT}`,
    );
    return;
  }

  if (command?.command === "start" || !existingLink) {
    await sendHtml(chatId, existingLink ? HELP_TEXT : notLinkedText());
    return;
  }

  const link = existingLink;

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

  // Started by the importStatement tool; awaited after the reply is sent so
  // the statement keeps processing while the user reads the confirmation.
  let pendingImport: Promise<{
    request: StatementImportRequest;
    result: StatementImportResult;
  }> | null = null;

  const reportImport = async () => {
    if (!pendingImport) return;
    const running = pendingImport;
    pendingImport = null;
    const stopWaiting = keepTyping(chatId);
    try {
      const { request, result } = await running;
      stopWaiting();
      await sendHtml(chatId, formatImportSummary(request, result));
    } finally {
      stopWaiting();
    }
  };

  const stopTyping = keepTyping(chatId);
  try {
    // What the model sees this turn vs. what we store (no raw bytes in the DB).
    let content: UserContent = text;
    let storedContent: UserContent = text;

    const history = await getConversationHistory(chatKey);

    // A PDF the statement importer can use: this message's, or one from the
    // previous exchange (downloaded again only if the model asks to import).
    let statementPdf: { load: () => Promise<Uint8Array>; fileName?: string } | null =
      null;

    if (attachment) {
      const file = await downloadTelegramFile(attachment.fileId);
      const prompt =
        text ||
        (attachment.kind === "pdf"
          ? "Te mando este PDF (puede ser un estado de cuenta o un comprobante)."
          : "Registra este ticket/comprobante como transacción.");
      content = [
        attachment.kind === "pdf"
          ? { type: "file", data: file.data, mediaType: "application/pdf" }
          : { type: "image", image: file.data, mediaType: file.mediaType },
        { type: "text", text: prompt },
      ];
      if (attachment.kind === "pdf") {
        storedContent = `${pdfPlaceholder(attachment.fileId, attachment.fileName)} ${prompt}`;
        statementPdf = {
          load: async () => file.data,
          fileName: attachment.fileName,
        };
      } else {
        storedContent = `[El usuario envió una imagen] ${prompt}`;
      }
    } else {
      const pending = findPendingPdf(history);
      if (pending) {
        statementPdf = {
          load: async () => (await downloadTelegramFile(pending.fileId)).data,
        };
      }
    }

    const importStatement = statementPdf
      ? async (request: StatementImportRequest) => {
          if (pendingImport) {
            return { error: "This statement is already being imported." };
          }
          const pdf = await statementPdf.load();
          const statement = await startStatementUpload(
            link.userId,
            statementPdf.fileName ?? `telegram-${message.message_id}.pdf`,
          );
          pendingImport = processStatement(statement.id, {
            userId: link.userId,
            pdf,
            accountId: request.accountId,
            accountName: request.accountName,
            accountType: request.accountType,
            comments: request.comments,
          }).then((result) => ({ request, result }));
          return { status: "started" as const };
        }
      : undefined;

    const { system, tools } = await buildFinanceAssistant(link.userId, {
      extraInstructions: TELEGRAM_INSTRUCTIONS,
      importStatement,
    });

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

    await reportImport();
  } catch (error) {
    stopTyping();
    console.error("Telegram bot error:", error);
    await sendHtml(
      chatId,
      "😕 Algo salió mal procesando tu mensaje. Intenta de nuevo en un momento.",
    ).catch(() => {});
    // An import may already be running; still let the user know how it went.
    await reportImport().catch((e) =>
      console.error("Telegram statement report failed:", e),
    );
  } finally {
    stopTyping();
  }
}
