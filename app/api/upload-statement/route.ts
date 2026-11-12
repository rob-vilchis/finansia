export const runtime = "nodejs";
export const maxDuration = 300;
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema/account";
import {
  processStatement,
  startStatementUpload,
} from "@/lib/services/statementImport";
import { currentUser } from "@clerk/nextjs/server";
import { waitUntil } from "@vercel/functions";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const accountType = formData.get("accountType") as string;
    const accountId = formData.get("accountId") as string;
    const comments = formData.get("comments") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (accountType !== "checking" && accountType !== "credit") {
      return NextResponse.json(
        { error: "Tipo de estado de cuenta inválido" },
        { status: 400 },
      );
    }

    const [account] = await db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, user.id)))
      .limit(1);
    if (!account) {
      return NextResponse.json(
        { error: "Cuenta no encontrada" },
        { status: 400 },
      );
    }

    const pdf = new Uint8Array(await file.arrayBuffer());
    const statement = await startStatementUpload(user.id, uuidv4());

    // Keep serverless function alive until processing completes
    waitUntil(
      processStatement(statement.id, {
        userId: user.id,
        pdf,
        accountId: account.id,
        accountName: account.name,
        accountType,
        comments,
      }),
    );

    return NextResponse.json(
      {
        status: "processing",
        statementId: statement.id,
        message: "File processing started in background",
      },
      { status: 202 },
    );
  } catch (err) {
    console.error("Statement upload failed", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
