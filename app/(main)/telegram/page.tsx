import { getLinkByUserId } from "@/lib/services/telegram";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import TelegramConnect from "./TelegramConnect";

export default async function TelegramPage() {
  const user = await currentUser();
  if (!user) redirect("/");

  const link = await getLinkByUserId(user.id);

  return (
    <TelegramConnect
      initialLink={
        link
          ? {
              telegramUsername: link.telegramUsername,
              linkedAt: link.linkedAt.toISOString(),
            }
          : null
      }
      botConfigured={Boolean(process.env.TELEGRAM_BOT_TOKEN)}
    />
  );
}
