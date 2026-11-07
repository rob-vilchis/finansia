/**
 * Telegram rejects messages over 4096 chars and is strict about formatting.
 * We send HTML (the most forgiving parse mode) converted from the light
 * Markdown the model tends to produce, and fall back to plain text if
 * Telegram still refuses it.
 */

const TELEGRAM_LIMIT = 4000; // a little headroom under 4096 for HTML tags

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Converts a small, safe subset of Markdown to Telegram HTML. */
export function markdownToTelegramHtml(markdown: string): string {
  const codeSpans: string[] = [];
  let text = markdown.replace(/`([^`\n]+)`/g, (_, code: string) => {
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });

  text = escapeHtml(text);

  text = text
    // headings → bold line
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
    // bullets → •
    .replace(/^(\s*)[-*]\s+/gm, "$1• ")
    // bold
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/__([^_\n]+)__/g, "<b>$1</b>")
    // italics (single * or _ not inside words)
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<i>$2</i>")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, "$1<i>$2</i>")
    // horizontal rules add noise in chat
    .replace(/^\s*(-{3,}|\*{3,})\s*$/gm, "");

  return text.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codeSpans[Number(i)]);
}

/** Splits text into Telegram-sized chunks, preferring paragraph/line breaks. */
export function chunkMessage(text: string, limit = TELEGRAM_LIMIT): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < limit / 2) cut = rest.lastIndexOf("\n", limit);
    if (cut < limit / 2) cut = rest.lastIndexOf(" ", limit);
    if (cut <= 0) cut = limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
