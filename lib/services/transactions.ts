import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema/account";
import { categories } from "@/lib/db/schema/categories";
import {
  insertTransactionSchema,
  transactions,
} from "@/lib/db/schema/transactions";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

type TransactionType = "income" | "expense" | "transfer";

export type CreateTransactionInput = {
  userId: string;
  description: string;
  amount: number | string;
  type: TransactionType;
  date: string | Date;
  time?: string; // optional HH:mm or HH:mm:ss, used mainly by chat tool
  categoryName?: string | null; // category by name (non-transfer)
  categoryId?: string | null; // or category by id
  sourceAccountId?: string; // source for expense/transfer, target for income if target not given
  accountName?: string; // alternative to accountId
  targetAccountId?: string; // target for transfer or income
  targetAccountName?: string; // alternative to targetAccountId
  needsVerification?: boolean;
};

export type SortBy = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";

export type GetTransactionsInput = {
  userId: string;
  description?: string; // exact description, case-insensitive
  search?: string; // free text; matches description, category or account names
  amount?: number | string;
  type?: TransactionType;
  startDatetime?: Date;
  endDatetime?: Date;
  categoryName?: string; // category by name (non-transfer)
  accountName?: string; // source account by name
  targetAccountName?: string; // target account by name
  anyAccountName?: string; // matches either side of the transaction
  sortBy?: SortBy;
  limit?: number;
  offset?: number;
};

// Postgres LIKE/ILIKE treats % and _ as wildcards and \ as the escape char, so
// user-typed text has to be escaped before being embedded in a pattern.
function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

// `is_unverified` is nullable, and `= false` would silently drop NULL rows.
function isVerified() {
  return or(
    eq(transactions.isUnverified, false),
    isNull(transactions.isUnverified)
  );
}

function normalizeDate(date: string | Date, time?: string): Date {
  const base = typeof date === "string" ? new Date(date) : date;
  if (time && typeof date === "string" && !date.includes("T")) {
    const [h, m = "0", s = "0"] = time.split(":");
    const dateWithTime = new Date(base);
    dateWithTime.setHours(Number(h), Number(m), Number(s), 0);
    return dateWithTime;
  }
  return base;
}

async function resolveAccountId(
  userId: string,
  opts: { accountId?: string; accountName?: string }
): Promise<string | null> {
  if (opts.accountId) return opts.accountId;
  if (!opts.accountName) return null;
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(eq(accounts.userId, userId), eq(accounts.name, opts.accountName))
    )
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
    .where(
      and(eq(categories.userId, userId), eq(categories.name, categoryName))
    )
    .limit(1);
  return rows.length ? rows[0].id : null;
}

export async function createTransaction({
  userId,
  description,
  amount,
  type,
  date,
  time,
  categoryName,
  categoryId: providedCategoryId,
  sourceAccountId: accountId,
  accountName,
  targetAccountId,
  targetAccountName,
  needsVerification,
}: CreateTransactionInput) {
  const normalizedDate = normalizeDate(date, time);
  const amountAsString =
    typeof amount === "number" ? amount.toString() : amount;

  const resolvedCategoryId = await resolveCategoryId(
    userId,
    type,
    categoryName,
    providedCategoryId ?? null
  );

  if (type !== "transfer" && !resolvedCategoryId && !needsVerification) {
    throw new Error("Invalid or unknown category");
  }

  const resolvedSourceAccountId = await resolveAccountId(userId, {
    accountId,
    accountName,
  });

  const resolvedTargetAccountId = await resolveAccountId(userId, {
    accountId: targetAccountId,
    accountName: targetAccountName,
  });

  // Build DB values depending on type
  const sourceAccountId =
    type === "transfer"
      ? resolvedSourceAccountId
      : type === "expense"
        ? resolvedSourceAccountId
        : null;
  const finalTargetAccountId =
    type === "transfer"
      ? resolvedTargetAccountId
      : type === "income"
        ? resolvedTargetAccountId ?? resolvedSourceAccountId ?? null
        : null;

  const base = insertTransactionSchema.parse({
    userId,
    date: normalizedDate,
    amount: amountAsString,
    type,
    category: resolvedCategoryId ?? "",
    description,
  });

  const inserted = await db
    .insert(transactions)
    .values({
      ...base,
      amount: amountAsString,
      category: type === "transfer" ? null : resolvedCategoryId,
      sourceAccountId,
      targetAccountId: finalTargetAccountId,
      isUnverified: needsVerification,
      userId,
    })
    .returning();

  return inserted[0];
}

export async function createTransactionIfUnique({
  userId,
  description,
  amount,
  type,
  date,
  time,
  categoryName,
  categoryId: providedCategoryId,
  sourceAccountId: accountId,
  targetAccountId,
  needsVerification,
}: CreateTransactionInput) {
  const normalizedDate = normalizeDate(date, time);
  const amountAsString =
    typeof amount === "number" ? amount.toString() : amount;

  console.log("Creating transaction", {
    userId,
    description,
    amount,
    type,
    date,
    time,
    categoryName,
    accountId,
    targetAccountId,
  });
  const existingTransaction = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.date, normalizedDate),
        eq(transactions.amount, amountAsString),
        eq(transactions.type, type)
      )
    )
    .limit(1);

  if (existingTransaction.length) {
    console.log("Transaction already exists, skipping");
    return existingTransaction[0];
  }

  const resolvedCategoryId = await resolveCategoryId(
    userId,
    type,
    categoryName,
    providedCategoryId ?? null
  );

  if (type !== "transfer" && !resolvedCategoryId && !needsVerification) {
    throw new Error("Invalid or unknown category");
  }

  const resolvedSourceAccountId = await resolveAccountId(userId, {
    accountId,
  });

  const resolvedTargetAccountId = await resolveAccountId(userId, {
    accountId: targetAccountId,
  });

  // Build DB values depending on type
  const sourceAccountId =
    type === "transfer"
      ? resolvedSourceAccountId
      : type === "expense"
        ? resolvedSourceAccountId
        : null;

  const finalTargetAccountId =
    type === "transfer"
      ? resolvedTargetAccountId
      : type === "income"
        ? resolvedTargetAccountId ?? resolvedSourceAccountId ?? null
        : null;

  const base = insertTransactionSchema.parse({
    userId,
    date: normalizedDate,
    amount: amountAsString,
    type,
    category: resolvedCategoryId ?? "",
    description,
  });

  const inserted = await db
    .insert(transactions)
    .values({
      ...base,
      amount: amountAsString,
      category: type === "transfer" ? null : resolvedCategoryId,
      sourceAccountId,
      targetAccountId: finalTargetAccountId,
      isUnverified: needsVerification,
      userId,
    })
    .returning();

  return inserted[0];
}

export async function getUnverifiedTransactions(userId: string) {
  const sourceAccounts = alias(accounts, "sourceAccounts");
  const targetAccounts = alias(accounts, "targetAccounts");

  const results = await db
    .select({
      id: transactions.id,
      description: transactions.description,
      amount: transactions.amount,
      date: transactions.date,
      type: transactions.type,
      categoryName: categories.name,
      sourceAccountId: transactions.sourceAccountId,
      targetAccountId: transactions.targetAccountId,
      sourceAccountName: sourceAccounts.name,
      targetAccountName: targetAccounts.name,
      isUnverified: transactions.isUnverified,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.category, categories.id))
    .leftJoin(
      sourceAccounts,
      eq(transactions.sourceAccountId, sourceAccounts.id)
    )
    .leftJoin(
      targetAccounts,
      eq(transactions.targetAccountId, targetAccounts.id)
    )
    .where(
      and(eq(transactions.userId, userId), eq(transactions.isUnverified, true))
    )
    .orderBy(transactions.date);

  return results;
}

function buildFilterConditions(
  filters: GetTransactionsInput,
  sourceAccounts: ReturnType<typeof alias>,
  targetAccounts: ReturnType<typeof alias>
) {
  const conditions = [];
  if (filters.userId) {
    conditions.push(eq(transactions.userId, filters.userId));
  }
  if (filters.description) {
    conditions.push(
      ilike(transactions.description, escapeLikePattern(filters.description))
    );
  }
  if (filters.search) {
    const term = `%${escapeLikePattern(filters.search)}%`;
    conditions.push(
      or(
        ilike(transactions.description, term),
        ilike(categories.name, term),
        ilike(sourceAccounts.name, term),
        ilike(targetAccounts.name, term)
      )
    );
  }
  if (filters.categoryName) {
    conditions.push(
      ilike(categories.name, escapeLikePattern(filters.categoryName))
    );
  }
  if (filters.type) {
    conditions.push(eq(transactions.type, filters.type));
  }
  if (filters.startDatetime) {
    conditions.push(gte(transactions.date, filters.startDatetime));
  }
  if (filters.endDatetime) {
    conditions.push(lte(transactions.date, filters.endDatetime));
  }
  if (filters.targetAccountName) {
    conditions.push(
      ilike(targetAccounts.name, escapeLikePattern(filters.targetAccountName))
    );
  }
  if (filters.accountName) {
    conditions.push(
      ilike(sourceAccounts.name, escapeLikePattern(filters.accountName))
    );
  }
  if (filters.anyAccountName) {
    const name = escapeLikePattern(filters.anyAccountName);
    conditions.push(
      or(ilike(sourceAccounts.name, name), ilike(targetAccounts.name, name))
    );
  }
  return conditions;
}

function getSortOrder(sortBy?: SortBy) {
  switch (sortBy) {
    case "date_asc":
      return asc(transactions.date);
    case "amount_desc":
      return desc(transactions.amount);
    case "amount_asc":
      return asc(transactions.amount);
    case "date_desc":
    default:
      return desc(transactions.date);
  }
}

export async function getTransactions(filters: GetTransactionsInput) {
  const sourceAccounts = alias(accounts, "sourceAccounts");
  const targetAccounts = alias(accounts, "targetAccounts");

  const conditions = buildFilterConditions(filters, sourceAccounts, targetAccounts);

  let query = db
    .select({
      id: transactions.id,
      description: transactions.description,
      amount: transactions.amount,
      date: transactions.date,
      type: transactions.type,
      categoryName: categories.name,
      sourceAccountId: transactions.sourceAccountId,
      targetAccountId: transactions.targetAccountId,
      sourceAccountName: sourceAccounts.name,
      targetAccountName: targetAccounts.name,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.category, categories.id))
    .leftJoin(
      sourceAccounts,
      eq(transactions.sourceAccountId, sourceAccounts.id)
    )
    .leftJoin(
      targetAccounts,
      eq(transactions.targetAccountId, targetAccounts.id)
    )
    .where(and(isVerified(), ...conditions))
    .orderBy(getSortOrder(filters.sortBy))
    .$dynamic();

  if (filters.limit) {
    query = query.limit(filters.limit);
  }
  if (filters.offset) {
    query = query.offset(filters.offset);
  }

  return await query;
}

export async function countTransactions(filters: GetTransactionsInput): Promise<number> {
  const sourceAccounts = alias(accounts, "sourceAccounts");
  const targetAccounts = alias(accounts, "targetAccounts");

  const conditions = buildFilterConditions(filters, sourceAccounts, targetAccounts);

  const result = await db
    .select({ value: count() })
    .from(transactions)
    .leftJoin(categories, eq(transactions.category, categories.id))
    .leftJoin(
      sourceAccounts,
      eq(transactions.sourceAccountId, sourceAccounts.id)
    )
    .leftJoin(
      targetAccounts,
      eq(transactions.targetAccountId, targetAccounts.id)
    )
    .where(and(isVerified(), ...conditions));

  return result[0]?.value ?? 0;
}

export async function deleteTransactions(filters: GetTransactionsInput) {
  // First get the transaction IDs that match the criteria
  const matchingTransactions = await getTransactions(filters);
  const transactionIds = matchingTransactions.map((t) => t.id);
  if (transactionIds.length === 0) {
    return [];
  }

  // Delete transactions by their IDs
  const deleted = await db
    .delete(transactions)
    .where(inArray(transactions.id, transactionIds));

  return deleted;
}
