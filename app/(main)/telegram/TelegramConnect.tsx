"use client";

import {
  createTelegramLinkAction,
  getTelegramStatusAction,
  unlinkTelegramAction,
} from "@/app/actions/telegram";
import { useToast } from "@/app/components/GenericToast";
import { GlassButton, GlassCard, SectionHeading } from "@/app/components/ui/glass";
import {
  Camera,
  CheckCircle2,
  Copy,
  ExternalLink,
  MessageCircle,
  Send,
  Unlink,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface LinkInfo {
  telegramUsername: string | null;
  linkedAt: string;
}

interface PendingLink {
  url: string;
  code: string;
  displayCode: string;
  botUsername: string;
  expiresAt: string;
}

const POLL_INTERVAL_MS = 3000;

const examples = [
  { icon: MessageCircle, text: "“Gasté 180 en el súper con la tarjeta”" },
  { icon: Zap, text: "“Uber 95 y café 60”" },
  { icon: Camera, text: "Foto del ticket o captura de tu app del banco" },
  { icon: MessageCircle, text: "“¿Cuánto llevo en restaurantes este mes?”" },
];

export default function TelegramConnect({
  initialLink,
  botConfigured,
}: {
  initialLink: LinkInfo | null;
  botConfigured: boolean;
}) {
  const { showToast } = useToast();
  const [link, setLink] = useState<LinkInfo | null>(initialLink);
  const [pending, setPending] = useState<PendingLink | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  // While a link is pending, poll until the bot reports the chat as linked.
  useEffect(() => {
    if (!pending) return;
    stopPolling();
    pollRef.current = setInterval(async () => {
      if (new Date(pending.expiresAt) < new Date()) {
        stopPolling();
        setPending(null);
        return;
      }
      const status = await getTelegramStatusAction();
      if (status.success && status.data?.linked) {
        stopPolling();
        setPending(null);
        setLink({
          telegramUsername: status.data.telegramUsername,
          linkedAt: status.data.linkedAt,
        });
        showToast({
          title: "Telegram conectado",
          message: "Ya puedes registrar gastos desde Telegram.",
          variant: "success",
        });
      }
    }, POLL_INTERVAL_MS);
    return stopPolling;
  }, [pending, showToast, stopPolling]);

  const handleConnect = async () => {
    setBusy(true);
    const result = await createTelegramLinkAction();
    setBusy(false);
    if (!result.success || !result.data) {
      showToast({
        title: "No se pudo conectar",
        message: result.message,
        variant: "error",
      });
      return;
    }
    setPending(result.data);
  };

  const handleUnlink = async () => {
    setBusy(true);
    const result = await unlinkTelegramAction();
    setBusy(false);
    if (result.success) setLink(null);
    showToast({
      title: result.success ? "Telegram desconectado" : "Error",
      message: result.message,
      variant: result.success ? "success" : "error",
    });
  };

  const copyCode = async () => {
    if (!pending) return;
    try {
      await navigator.clipboard.writeText(pending.code);
      showToast({
        title: "Código copiado",
        message: `Pégalo en el chat con @${pending.botUsername}`,
        variant: "info",
      });
    } catch {
      showToast({
        title: "No se pudo copiar",
        message: `Escribe ${pending.displayCode} en el chat con @${pending.botUsername}`,
        variant: "warning",
      });
    }
  };

  return (
    <div className="min-h-screen bg-app font-(family-name:--font-outfit) w-full px-5 md:px-10 py-8 pb-28">
      <div className="w-full max-w-2xl mx-auto space-y-6">
        <header>
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-accent-fg">
            Integraciones
          </p>
          <h1 className="mt-1.5 text-3xl md:text-4xl font-bold tracking-tight text-ink leading-none">
            Telegram
          </h1>
          <p className="mt-3 text-sm text-ink-subtle">
            Registra tus gastos en segundos mandando un mensaje, sin abrir la app.
          </p>
        </header>

        <GlassCard className="p-5">
          {link ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-income-soft border border-income-border">
                  <CheckCircle2 size={18} className="text-income" />
                </div>
                <div>
                  <p className="text-sm font-medium text-ink">Conectado</p>
                  <p className="text-xs text-ink-subtle">
                    {link.telegramUsername ? `@${link.telegramUsername} · ` : ""}
                    desde{" "}
                    {new Date(link.linkedAt).toLocaleDateString("es-MX", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                </div>
              </div>
              <GlassButton
                variant="danger"
                onClick={handleUnlink}
                disabled={busy}
                className="flex items-center gap-2 justify-center"
              >
                <Unlink size={14} />
                Desconectar
              </GlassButton>
            </div>
          ) : pending ? (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-accent animate-pulse" />
                <p className="text-sm text-ink">Esperando la conexión…</p>
              </div>

              <ol className="space-y-4 text-sm text-ink-muted">
                <li className="flex gap-3">
                  <span className="text-accent-fg font-semibold">1.</span>
                  <div className="space-y-2">
                    <p>
                      Abre el chat con{" "}
                      <span className="text-ink">@{pending.botUsername}</span>{" "}
                      y toca <b className="text-ink">Iniciar</b>.
                    </p>
                    <a
                      href={pending.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-accent-soft border border-accent-border text-accent-fg hover:bg-accent/30"
                    >
                      <ExternalLink size={14} />
                      Abrir Telegram
                    </a>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="text-accent-fg font-semibold">2.</span>
                  <div className="space-y-2 w-full">
                    <p>
                      Si el bot no te confirma la conexión, envíale este código:
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="px-4 py-2 rounded-lg bg-surface-strong border border-edge-strong text-xl font-semibold tracking-[0.2em] text-ink select-all">
                        {pending.displayCode}
                      </code>
                      <GlassButton
                        variant="secondary"
                        onClick={copyCode}
                        className="flex items-center gap-2"
                      >
                        <Copy size={14} />
                        Copiar
                      </GlassButton>
                    </div>
                  </div>
                </li>
              </ol>

              <div className="flex items-center justify-between gap-3 pt-3 border-t border-edge-soft">
                <p className="text-xs text-ink-faint">
                  El código expira en 15 minutos.
                </p>
                <GlassButton
                  variant="ghost"
                  onClick={() => {
                    stopPolling();
                    setPending(null);
                  }}
                >
                  Cancelar
                </GlassButton>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft border border-accent-border">
                  <Send size={16} className="text-accent" />
                </div>
                <div>
                  <p className="text-sm font-medium text-ink">No conectado</p>
                  <p className="text-xs text-ink-subtle">
                    {botConfigured
                      ? "Conecta tu cuenta en un toque."
                      : "El bot aún no está configurado en el servidor."}
                  </p>
                </div>
              </div>
              <GlassButton
                onClick={handleConnect}
                disabled={busy || !botConfigured}
                className="flex items-center gap-2 justify-center"
              >
                <Send size={14} />
                {busy ? "Generando…" : "Conectar Telegram"}
              </GlassButton>
            </div>
          )}
        </GlassCard>

        <section className="space-y-3">
          <SectionHeading>Qué le puedes decir</SectionHeading>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {examples.map(({ icon: Icon, text }) => (
              <GlassCard key={text} className="p-4 flex items-start gap-3">
                <Icon size={16} className="text-accent shrink-0 mt-0.5" />
                <p className="text-sm text-ink-muted">{text}</p>
              </GlassCard>
            ))}
          </div>
          <p className="text-xs text-ink-faint">
            El bot tiene las mismas capacidades que el chat de la app: crear,
            consultar, corregir y borrar movimientos, cuentas, metas, categorías
            y recurrentes. Comandos: /nuevo, /ayuda, /desvincular.
          </p>
        </section>
      </div>
    </div>
  );
}
