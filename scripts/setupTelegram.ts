/**
 * Registers the Telegram webhook and the bot's command menu.
 *
 *   npm run telegram:setup -- https://your-app.vercel.app
 *
 * Needs TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in the environment
 * (or .env). Run it again whenever the production URL or secret changes.
 */
import "dotenv/config";

async function call(method: string, body: Record<string, unknown> = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
}

async function main() {
  const baseUrl = (process.argv[2] ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (!/^https:\/\//.test(baseUrl)) {
    throw new Error(
      "Pass your public HTTPS app URL: npm run telegram:setup -- https://your-app.vercel.app",
    );
  }
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !/^[A-Za-z0-9_-]{16,256}$/.test(secret)) {
    throw new Error(
      "TELEGRAM_WEBHOOK_SECRET must be 16-256 chars of A-Z, a-z, 0-9, _ or -. Try: openssl rand -hex 32",
    );
  }

  const me = await call("getMe");
  console.log(`Bot: @${me.username}`);

  await call("setWebhook", {
    url: `${baseUrl}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });

  await call("setMyCommands", {
    commands: [
      { command: "ayuda", description: "Qué puedo hacer" },
      { command: "nuevo", description: "Empezar una conversación nueva" },
      { command: "desvincular", description: "Desconectar tu cuenta de Finansia" },
    ],
  });

  await call("setMyDescription", {
    description:
      "Tu asistente de Finansia. Registra gastos e ingresos con un mensaje o la foto de un ticket, y pregúntame cómo van tus finanzas.",
  });

  const info = await call("getWebhookInfo");
  console.log("Webhook:", info.url);
  if (info.last_error_message) {
    console.log("Last delivery error:", info.last_error_message);
  }
  console.log(`\nSet TELEGRAM_BOT_USERNAME=${me.username} in your env to skip a getMe call when linking.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
