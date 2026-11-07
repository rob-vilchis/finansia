"use server";

import { getBotUsername } from "@/lib/telegram/api";
import {
  createLinkCode,
  getLinkByUserId,
  unlinkUser,
} from "@/lib/services/telegram";
import { currentUser } from "@clerk/nextjs/server";

/**
 * Server Actions for connecting a Telegram chat to the user's account.
 */

export async function getTelegramStatusAction() {
  const user = await currentUser();
  if (!user) return { success: false, message: "No autorizado" };

  const link = await getLinkByUserId(user.id);
  return {
    success: true,
    message: "",
    data: link
      ? {
          linked: true as const,
          telegramUsername: link.telegramUsername,
          linkedAt: link.linkedAt.toISOString(),
        }
      : { linked: false as const },
  };
}

export async function createTelegramLinkAction() {
  try {
    const user = await currentUser();
    if (!user) return { success: false, message: "No autorizado" };

    if (!process.env.TELEGRAM_BOT_TOKEN) {
      return {
        success: false,
        message: "El bot de Telegram no está configurado en el servidor",
      };
    }

    const [{ code, expiresAt }, botUsername] = await Promise.all([
      createLinkCode(user.id),
      getBotUsername(),
    ]);

    return {
      success: true,
      message: "Enlace generado",
      data: {
        url: `https://t.me/${botUsername}?start=${code}`,
        code,
        botUsername,
        expiresAt: expiresAt.toISOString(),
      },
    };
  } catch (error) {
    console.error("Error creating Telegram link:", error);
    return { success: false, message: "No se pudo generar el enlace" };
  }
}

export async function unlinkTelegramAction() {
  try {
    const user = await currentUser();
    if (!user) return { success: false, message: "No autorizado" };

    const removed = await unlinkUser(user.id);
    return removed
      ? { success: true, message: "Telegram desconectado" }
      : { success: false, message: "No había ningún chat conectado" };
  } catch (error) {
    console.error("Error unlinking Telegram:", error);
    return { success: false, message: "No se pudo desconectar Telegram" };
  }
}
