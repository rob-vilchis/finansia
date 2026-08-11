import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema/account";
import { categories } from "@/lib/db/schema/categories";
import {
  recurringTransactions,
  type Frequency,
} from "@/lib/db/schema/recurringTransactions";
import { and, eq, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createTransaction } from "./transactions";

type TransactionType = "income" | "expense" | "transfer";

export type CreateRecurringTransactionInput = {
  userId: string;
  description: string;
  amount: number | string;
  type: TransactionType;
  frequency: Frequency;
  startDate: string; // YYYY-MM-DD
  endDate?: string | null; // YYYY-MM-DD or null for indefinite
  categoryId?: string | null;
  categoryName?: string | null;
  sourceAccountId?: string | null;
  targetAccountId?: string | null;
  accountName?: string | null;
  targetAccountName?: string | null;
};

export type UpdateRecurringTransactionInput = Partial<
  Omit<CreateRecurringTransactionInput, "userId">
>;

async function resolveAccountId(
  userId: string,
  opts: { accountId?: string | null; accountName?: string | null }
): Promise<string | null> {
  if (opts.accountId) return opts.accountId;
  if (!opts.accountName) return null;
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.name, opts.accountName)))
    .limit(1);
  return rows.length ? rows[0].id : null;
}

async function resolveCategoryId(
  userId: string,
  type: TransactionType,
  categoryName?: string | null,
  categoryId?: string | null
): Promise<string | null> {
  if (type === "transfer") return null;
  if (categoryId) return categoryId;
  if (!categoryName) return null;
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.name, categoryName)))
    .limit(1);
  return rows.length ? rows[0].id : null;
}

/**
 * Snaps a date to the nearest Mexican "quincena" anchor: the 15th or the last
 * day of the month. Days 1-15 snap to the 15th; days 16-end snap to the last
 * day. Used so biweekly recurrences never drift off these two fixed days.
 */
export function snapToQuincena(currentDate: string): string {
  const date = new Date(currentDate + "T00:00:00");
  const lastDay = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0
  ).getDate();
  date.setDate(date.getDate() <= 15 ? 15 : lastDay);
  return date.toISOString().split("T")[0];
}

export function calculateNextRunDate(
  currentDate: string,
  frequency: Frequency
): string {
  const date = new Date(currentDate + "T00:00:00");

  switch (frequency) {
    case "daily":
      date.setDate(date.getDate() + 1);
      break;
    case "weekly":
      date.setDate(date.getDate() + 7);
      break;
    case "biweekly": {
      // Quincena: always the 15th and the last day of the month.
      const day = date.getDate();
      const lastDay = new Date(
        date.getFullYear(),
        date.getMonth() + 1,
        0
      ).getDate();
      if (day < 15) {
        date.setDate(15);
      } else if (day < lastDay) {
        date.setDate(lastDay);
      } else {
        // Last day of the month → 15th of next month.
        date.setMonth(date.getMonth() + 1, 15);
      }
      break;
    }
    case "monthly":
      date.setMonth(date.getMonth() + 1);
      break;
    case "quarterly":
      date.setMonth(date.getMonth() + 3);
      break;
    case "semi-annually":
      date.setMonth(date.getMonth() + 6);
      break;
    case "yearly":
      date.setFullYear(date.getFullYear() + 1);
      break;
  }

  return date.toISOString().split("T")[0];
}

export async function createRecurringTransaction(
  input: CreateRecurringTransactionInput
) {
  const amountStr =
    typeof input.amount === "number" ? input.amount.toString() : input.amount;

  const resolvedCategoryId = await resolveCategoryId(
    input.userId,
    input.type,
    input.categoryName,
    input.categoryId
  );

  const resolvedSourceAccountId = await resolveAccountId(input.userId, {
    accountId: input.sourceAccountId,
    accountName: input.accountName,
  });

  const resolvedTargetAccountId = await resolveAccountId(input.userId, {
    accountId: input.targetAccountId,
    accountName: input.targetAccountName,
  });

  const sourceAccountId =
    input.type === "transfer" || input.type === "expense"
      ? resolvedSourceAccountId
      : null;

  const targetAccountId =
    input.type === "transfer" || input.type === "income"
      ? (resolvedTargetAccountId ?? resolvedSourceAccountId)
      : null;

  const inserted = await db
    .insert(recurringTransactions)
    .values({
      userId: input.userId,
      description: input.description,
      amount: amountStr,
      type: input.type,
      category: resolvedCategoryId,
      sourceAccountId,
      targetAccountId,
      frequency: input.frequency,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      nextRunDate:
        input.frequency === "biweekly"
          ? snapToQuincena(input.startDate)
          : input.startDate,
      isActive: true,
    })
    .returning();

  return inserted[0];
}

export async function getRecurringTransactions(userId: string) {
  const sourceAccounts = alias(accounts, "sourceAccounts");
  const targetAccounts = alias(accounts, "targetAccounts");

  return await db
    .select({
      id: recurringTransactions.id,
      description: recurringTransactions.description,
      amount: recurringTransactions.amount,
      type: recurringTransactions.type,
      frequency: recurringTransactions.frequency,
      startDate: recurringTransactions.startDate,
      endDate: recurringTransactions.endDate,
      nextRunDate: recurringTransactions.nextRunDate,
      isActive: recurringTransactions.isActive,
      categoryName: categories.name,
      categoryId: recurringTransactions.category,
      sourceAccountId: recurringTransactions.sourceAccountId,
      targetAccountId: recurringTransactions.targetAccountId,
      sourceAccountName: sourceAccounts.name,
      targetAccountName: targetAccounts.name,
      createdAt: recurringTransactions.createdAt,
    })
    .from(recurringTransactions)
    .leftJoin(categories, eq(recurringTransactions.category, categories.id))
    .leftJoin(
      sourceAccounts,
      eq(recurringTransactions.sourceAccountId, sourceAccounts.id)
    )
    .leftJoin(
      targetAccounts,
      eq(recurringTransactions.targetAccountId, targetAccounts.id)
    )
    .where(eq(recurringTransactions.userId, userId))
    .orderBy(recurringTransactions.nextRunDate);
}

export async function updateRecurringTransaction(
  userId: string,
  id: string,
  input: UpdateRecurringTransactionInput
) {
  const existing = await db
    .select()
    .from(recurringTransactions)
    .where(
      and(
        eq(recurringTransactions.id, id),
        eq(recurringTransactions.userId, userId)
      )
    )
    .limit(1);

  if (!existing.length) return null;

  const current = existing[0];
  const newType = (input.type ?? current.type) as TransactionType;

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (input.description !== undefined) updateData.description = input.description;
  if (input.amount !== undefined)
    updateData.amount =
      typeof input.amount === "number" ? input.amount.toString() : input.amount;
  if (input.type !== undefined) updateData.type = input.type;
  if (input.frequency !== undefined) updateData.frequency = input.frequency;
  if (input.startDate !== undefined) updateData.startDate = input.startDate;
  if (input.endDate !== undefined) updateData.endDate = input.endDate;

  if (input.categoryId !== undefined || input.categoryName !== undefined) {
    updateData.category = await resolveCategoryId(
      userId,
      newType,
      input.categoryName,
      input.categoryId
    );
  }

  if (input.sourceAccountId !== undefined || input.accountName !== undefined) {
    const resolved = await resolveAccountId(userId, {
      accountId: input.sourceAccountId,
      accountName: input.accountName,
    });
    updateData.sourceAccountId =
      newType === "transfer" || newType === "expense" ? resolved : null;
  }

  if (
    input.targetAccountId !== undefined ||
    input.targetAccountName !== undefined
  ) {
    const resolved = await resolveAccountId(userId, {
      accountId: input.targetAccountId,
      accountName: input.targetAccountName,
    });
    updateData.targetAccountId =
      newType === "transfer" || newType === "income" ? resolved : null;
  }

  // Recalculate nextRunDate if frequency or startDate changed
  if (input.frequency !== undefined || input.startDate !== undefined) {
    const freq = (input.frequency ?? current.frequency) as Frequency;
    const start = input.startDate ?? current.startDate;
    const today = new Date().toISOString().split("T")[0];

    // Find the next run date from start that's >= today
    let next = freq === "biweekly" ? snapToQuincena(start) : start;
    while (next < today) {
      next = calculateNextRunDate(next, freq);
    }
    updateData.nextRunDate = next;
  }

  const updated = await db
    .update(recurringTransactions)
    .set(updateData)
    .where(
      and(
        eq(recurringTransactions.id, id),
        eq(recurringTransactions.userId, userId)
      )
    )
    .returning();

  return updated[0];
}

export async function deleteRecurringTransaction(userId: string, id: string) {
  const deleted = await db
    .delete(recurringTransactions)
    .where(
      and(
        eq(recurringTransactions.id, id),
        eq(recurringTransactions.userId, userId)
      )
    )
    .returning({ deletedId: recurringTransactions.id });

  return deleted.length > 0;
}

export async function toggleRecurringTransaction(
  userId: string,
  id: string,
  isActive: boolean
) {
  const updated = await db
    .update(recurringTransactions)
    .set({ isActive, updatedAt: new Date() })
    .where(
      and(
        eq(recurringTransactions.id, id),
        eq(recurringTransactions.userId, userId)
      )
    )
    .returning();

  return updated[0] ?? null;
}

export async function materializeRecurringTransactions() {
  const today = new Date().toISOString().split("T")[0];

  const dueRecurrings = await db
    .select()
    .from(recurringTransactions)
    .where(
      and(
        eq(recurringTransactions.isActive, true),
        lte(recurringTransactions.nextRunDate, today)
      )
    );

  let createdCount = 0;

  for (const recurring of dueRecurrings) {
    let nextDate = recurring.nextRunDate;

    // Create transactions for all missed dates
    while (nextDate <= today) {
      // Check if endDate has passed
      if (recurring.endDate && nextDate > recurring.endDate) {
        await db
          .update(recurringTransactions)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(recurringTransactions.id, recurring.id));
        break;
      }

      await createTransaction({
        userId: recurring.userId!,
        description: recurring.description,
        amount: recurring.amount,
        type: recurring.type as TransactionType,
        date: nextDate,
        categoryId: recurring.category,
        sourceAccountId: recurring.sourceAccountId ?? undefined,
        targetAccountId: recurring.targetAccountId ?? undefined,
      });

      createdCount++;
      nextDate = calculateNextRunDate(nextDate, recurring.frequency as Frequency);
    }

    // Update nextRunDate
    if (
      !recurring.endDate ||
      nextDate <= recurring.endDate
    ) {
      await db
        .update(recurringTransactions)
        .set({ nextRunDate: nextDate, updatedAt: new Date() })
        .where(eq(recurringTransactions.id, recurring.id));
    }
  }

  return { createdCount, processedRecurrings: dueRecurrings.length };
}
