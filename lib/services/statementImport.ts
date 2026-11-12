import { fetchUserCategories } from "@/lib/financial-data";
import {
  createStatementUpload,
  updateStatementUploadStatus,
} from "@/lib/services/statements";
import { createTransactionIfUnique } from "@/lib/services/transactions";
import { generateObject } from "ai";
import { revalidatePath } from "next/cache";
import z from "zod";

export const STATEMENT_PARSER_MODEL = "anthropic/claude-sonnet-4.5";

export type StatementAccountType = "checking" | "credit";

export type StatementImportInput = {
  userId: string;
  pdf: Uint8Array;
  /** Account every parsed transaction is booked against. */
  accountId: string;
  accountName: string;
  accountType: StatementAccountType;
  comments?: string | null;
};

export type StatementImportResult = {
  statementId: string;
  status: "ready" | "error";
  /** New transactions inserted. */
  created: number;
  /** Of `created`, how many were flagged for review in /data/review. */
  needsReview: number;
  /** Rows that matched an existing transaction (date + amount + type). */
  duplicates: number;
  /** Rows that failed to insert. */
  failed: number;
};

const createPrompt = (
  accountType: StatementAccountType,
  accountName: string,
  comments?: string | null,
) => `You are a financial data parser. Your job is to read the attached bank statement PDF and extract all transactions into the provided format.

GUIDELINES:
- Statements can be either credit card statements or checking account statements.
- When it is a credit statement, consider only the expenses. DO NOT GENERATE CREDIT CARD PAYMENT TRANSACTIONS, IGNORE THEM.
- When it is a checking statement, classify all transactions into income/expense.
- For each transaction, generate a short description in spanish, based on the available information.
- If there is no time value, set it to 12:00 PM by default.
- If you can't accurately classify the transaction with the available information, leave the category as null and set needsVerification to true, for the user to classify later

${comments ? "ADDITIONAL INSTRUCTIONS PROVIDED BY USER: " + comments : ""}

STATEMENT TYPE: ${accountType}
ACCOUNT NAME: ${accountName}
The statement is attached as a PDF file.
`;

/** Creates the statement record so callers can report progress right away. */
export async function startStatementUpload(
  userId: string,
  originalFileName: string,
) {
  return createStatementUpload({
    userId,
    originalFileName,
    extractedText: "",
    status: "processing",
  });
}

/**
 * Parses a bank statement PDF with the model and inserts its transactions
 * (skipping duplicates). Never throws: failures mark the statement as "error".
 * Shared by the web upload and the Telegram bot.
 */
export async function processStatement(
  statementId: string,
  input: StatementImportInput,
): Promise<StatementImportResult> {
  const { userId, pdf, accountId, accountName, accountType, comments } = input;
  const result: StatementImportResult = {
    statementId,
    status: "error",
    created: 0,
    needsReview: 0,
    duplicates: 0,
    failed: 0,
  };

  try {
    console.log(`Starting background processing for statement ${statementId}`);
    const userCategories = await fetchUserCategories(userId);

    // Claude parses PDFs natively (including image-based and Type3 fonts).
    const response = await generateObject({
      model: STATEMENT_PARSER_MODEL,
      output: "array",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: createPrompt(accountType, accountName, comments) },
            { type: "file", data: pdf, mediaType: "application/pdf" },
          ],
        },
      ],
      schema: z.object({
        description: z.string().describe("Description of the transaction"),
        date: z.string().date().describe("Date of the transaction"),
        time: z.string().time().describe("Time of the transaction"),
        amount: z.number().describe("Amount of the transaction"),
        categoryName: z
          .enum(
            (userCategories.length > 0
              ? userCategories.map((category) => category.name)
              : [""]) as [string, ...string[]],
          )
          .nullable()
          .describe(
            "Category of the transaction. Must match the selected type (expense categories for expense, income categories for income). Leave as null if the transaction cannot be accurately classified.",
          ),
        type: z
          .enum(["expense", "income"])
          .describe("Type of the transaction"),
        needsVerification: z
          .boolean()
          .describe("Set to true if user verification is needed"),
      }),
    });

    console.log(`Generated ${response.object.length} transactions from AI`);

    const results = await Promise.allSettled(
      response.object.map((transaction) =>
        createTransactionIfUnique({
          userId,
          ...transaction,
          // The account comes from the user, not the model.
          ...(transaction.type === "expense"
            ? { sourceAccountId: accountId }
            : { targetAccountId: accountId }),
        }),
      ),
    );

    for (const r of results) {
      if (r.status === "rejected") result.failed++;
      else if (!r.value.created) result.duplicates++;
      else {
        result.created++;
        if (r.value.transaction.isUnverified) result.needsReview++;
      }
    }

    if (result.failed > 0) {
      console.error(
        `Statement ${statementId}: ${result.failed} transactions failed:`,
        results
          .filter((r) => r.status === "rejected")
          .map((r) => (r as PromiseRejectedResult).reason),
      );
    }

    // A statement that only had duplicates is still a successful import.
    const ok = results.length > 0 && result.failed < results.length;
    result.status = ok ? "ready" : "error";
    await updateStatementUploadStatus(statementId, result.status);

    if (ok) {
      try {
        revalidatePath("/data");
        revalidatePath("/home");
      } catch {
        // Outside a request scope (e.g. some background contexts); harmless.
      }
    }
    console.log(
      `Statement ${statementId}: ${result.created} created, ${result.duplicates} duplicates, ${result.failed} failed`,
    );
  } catch (error) {
    console.error(
      `Background processing failed for statement ${statementId}`,
      error,
    );
    await updateStatementUploadStatus(statementId, "error").catch(() => {});
  }

  return result;
}
