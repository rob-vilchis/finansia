import { buildFinanceAssistant, FINANCE_ASSISTANT_MODEL } from "@/lib/ai/financeAssistant";
import { currentUser } from "@clerk/nextjs/server";
import { convertToModelMessages, streamText, UIMessage } from "ai";
import { revalidatePath } from "next/cache";

// Allow streaming responses up to 30 seconds
export const maxDuration = 300;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const user = await currentUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

  const { system, tools } = await buildFinanceAssistant(user.id);

  const result = streamText({
    model: FINANCE_ASSISTANT_MODEL,
    tools,
    system,
    messages: convertToModelMessages(messages),
  });

  revalidatePath("/data");
  revalidatePath("/home");
  revalidatePath("/categories");
  revalidatePath("/recurring");

  return result.toUIMessageStreamResponse();
}
