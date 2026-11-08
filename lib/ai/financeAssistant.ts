import { db } from "@/lib/db";
import { accounts as accountsTable } from "@/lib/db/schema/account";
import { categories as categoriesTable } from "@/lib/db/schema/categories";
import { financialGoals } from "@/lib/db/schema/financial_goals";
import { transactions as transactionsTable } from "@/lib/db/schema/transactions";
import {
  fetchAllFinancialData,
  fetchUserAccounts,
  fetchUserCategories,
  fetchUserGoals,
  getFirst50,
} from "@/lib/financial-data";
import {
  createRecurringTransaction,
  deleteRecurringTransaction,
  getRecurringTransactions,
} from "@/lib/services/recurringTransactions";
import {
  createTransaction,
  deleteTransactions,
  getTransactions,
} from "@/lib/services/transactions";
import { tool } from "ai";
import { and, eq } from "drizzle-orm";
import z from "zod";

export const FINANCE_ASSISTANT_MODEL = "anthropic/claude-sonnet-5";

const MX_TIMEZONE = "America/Mexico_City";

/**
 * Builds the system prompt and tool set for the finance assistant, scoped to
 * a single user. Shared by the web chat and the Telegram bot so both channels
 * have exactly the same capabilities and validation.
 *
 * `extraInstructions` is appended to the system prompt (e.g. channel-specific
 * formatting rules).
 */
export async function buildFinanceAssistant(
  userId: string,
  { extraInstructions }: { extraInstructions?: string } = {},
) {
  const { transactions, goals, accounts, categorySum } =
    await fetchAllFinancialData(userId);

  const userCategories = await fetchUserCategories(userId);
  const userAccounts = await fetchUserAccounts(userId);

  // Build lookups for cross-field validation
  const categoryByName = new Map(
    userCategories.map((category) => [category.name, category]),
  );

  const systemContext = `
  You are a personal finance assistant. You ONLY answer questions and perform actions related to personal finance, budgeting, and the user's financial data. If the user asks about anything unrelated to finance, politely decline and redirect to financial topics.

  RESPONSE GUIDELINES:
  - Be concise and professional
  - Provide specific, actionable recommendations based on the user's actual data
  - Ask clarifying questions when you need more information
  - Respond in the same language the user writes in

  CAPABILITIES — you can ONLY do thes following:
  - Create, retrieve, update, and delete transactions (one at a time)
  - Create, list, and delete recurring/automatic transactions (e.g. monthly subscriptions, biweekly salary)
  - Create, list, update, and delete accounts
  - Create, list, update, and delete financial goals (each goal has a linked savings account)
  - Create, update, and delete categories (expense or income)
  - Analyze spending patterns, goal progress, and account balances

  LIMITATIONS — do NOT promise or suggest you can:
  - Connect to banks or import statements (the user uploads PDFs separately)
  - Make actual transfers or paymentsp
  - Access data beyond what is provided below

  When a tool returns { status: "created" }, that means you just created something new — do not say it "already existed."
  When a tool returns { error: "..." }, relay the error to the user.
  For delete operations, always confirm with the user before executing.
  To update a transaction, first use retrieveTransactions to find its ID.

  CURRENT DATE AND TIME (Mexico City): ${new Date().toLocaleString("es-MX", {
    timeZone: MX_TIMEZONE,
    dateStyle: "full",
    timeStyle: "short",
  })} — ISO date: ${new Date().toLocaleDateString("en-CA", { timeZone: MX_TIMEZONE })}

  USER'S FINANCIAL DATA:

  LOCATION: Mexico
  CURRENCY: Mexican Pesos (MXN)

  RECENT TRANSACTIONS (last 20):
  ${JSON.stringify(getFirst50(transactions), null, 2)}

  SPENDING BY CATEGORY (last 30 days):
  ${JSON.stringify(categorySum, null, 2)}

  FINANCIAL GOALS:
  ${JSON.stringify(goals, null, 2)}

  ACCOUNTS & BALANCES:
  ${JSON.stringify(accounts, null, 2)}

  USER CATEGORIES:
  ${JSON.stringify(
    userCategories.map((c) => ({ name: c.name, type: c.type })),
    null,
    2,
  )}
  `;

  const tools = {
      createTransaction: tool({
        description: "Create a new transaction for the user",
        inputSchema: z
          .object({
            name: z.string().describe("Name of the transaction"),
            date: z.string().date().describe("Date of the transaction"),
            time: z.string().time().describe("Time of the transaction"),
            amount: z.number().describe("Amount of the transaction"),
            category: z
              .enum(
                (userCategories.length > 0
                  ? userCategories.map((category) => category.name)
                  : [""]) as [string, ...string[]],
              )
              .describe(
                "Category of the transaction. Must match the selected type (expense categories for expense, income categories for income).",
              ),
            type: z
              .enum(["expense", "income", "transfer"])
              .describe("Type of the transaction"),
            accountName: z
              .enum(
                (userAccounts.length > 0
                  ? userAccounts.map((account) => account.name)
                  : [""]) as [string, ...string[]],
              )
              .describe(
                "Source account for the transaction, if the type is expense or transfer",
              ),
            targetAccountName: z
              .enum(
                (userAccounts.length > 0
                  ? userAccounts.map((account) => account.name)
                  : [""]) as [string, ...string[]],
              )
              .describe(
                "Target Account ID of the transaction, if the type is transfer or income",
              ),
          })
          .superRefine((val, ctx) => {
            // Skip category/type validation for transfers if your model doesn't use categories for them
            if (val.type === "transfer") return;

            const category = categoryByName.get(val.category);
            if (!category) {
              ctx.addIssue({
                code: "custom",
                message: `Unknown category: ${val.category}`,
                path: ["category"],
              });
              return;
            }

            if (category.type !== val.type) {
              ctx.addIssue({
                code: "custom",
                message: `Category "${val.category}" is of type "${category.type}" but transaction type is "${val.type}"`,
                path: ["category"],
              });
            }
          }),
        execute: async ({
          name,
          date,
          time,
          amount,
          category,
          type,
          accountName,
          targetAccountName,
        }) => {
          const created = await createTransaction({
            userId: userId,
            description: name,
            amount,
            type,
            date,
            time,
            categoryName: category,
            accountName,
            targetAccountName,
          });

          return {
            status: "created",
            transaction: {
              id: created.id,
              description: created.description,
              amount: created.amount,
              date: created.date,
              type: created.type,
              sourceAccountId: created.sourceAccountId,
              targetAccountId: created.targetAccountId,
              category: created.category,
            },
          };
        },
      }),
      retrieveTransactions: tool({
        description: "Retrieve transactions by any criteria",
        inputSchema: z
          .object({
            description: z
              .string()
              .describe("Description of the transaction")
              .optional(),
            amount: z.number().describe("Amount of the transaction").optional(),
            category: z
              .enum(
                (userCategories.length > 0
                  ? userCategories.map((category) => category.name)
                  : [""]) as [string, ...string[]],
              )
              .describe(
                "Category of the transaction. Must match the selected type (expense categories for expense, income categories for income).",
              )
              .optional(),
            type: z
              .enum(["expense", "income", "transfer"])
              .describe("Type of the transaction")
              .optional(),
            accountName: z
              .enum(
                (userAccounts.length > 0
                  ? userAccounts.map((account) => account.name)
                  : [""]) as [string, ...string[]],
              )
              .describe(
                "Source account for the transaction, if the type is expense or transfer",
              )
              .optional(),
            targetAccountName: z
              .enum(
                (userAccounts.length > 0
                  ? userAccounts.map((account) => account.name)
                  : [""]) as [string, ...string[]],
              )
              .describe(
                "Target Account ID of the transaction, if the type is transfer or income",
              )
              .optional(),
            startDatetime: z
              .string()
              .datetime()
              .describe("Start datetime for date range filtering")
              .optional(),
            endDatetime: z
              .string()
              .datetime()
              .describe("End datetime for date range filtering")
              .optional(),
          })
          .superRefine((data, ctx) => {
            // Check that at least one argument is provided
            if (
              data.description === undefined &&
              data.amount === undefined &&
              data.category === undefined &&
              data.type === undefined &&
              data.accountName === undefined &&
              data.targetAccountName === undefined &&
              data.startDatetime === undefined &&
              data.endDatetime === undefined
            ) {
              ctx.addIssue({
                code: "custom",
                message: "At least one argument must be provided",
                path: [],
              });
            }

            // If startDate is provided, endDate must also be provided
            if (
              data.startDatetime !== undefined &&
              data.endDatetime === undefined
            ) {
              ctx.addIssue({
                code: "custom",
                message:
                  "If startDatetime is provided, endDatetime must also be provided",
                path: ["endDatetime"],
              });
            }
          }),
        execute: async (criteria) => {
          const transactions = await getTransactions({
            userId: userId,
            description: criteria.description,
            categoryName: criteria.category,
            type: criteria.type,
            accountName: criteria.accountName,
            targetAccountName: criteria.targetAccountName,
            startDatetime: criteria.startDatetime
              ? new Date(criteria.startDatetime)
              : undefined,
            endDatetime: criteria.endDatetime
              ? new Date(criteria.endDatetime)
              : undefined,
          });
          return transactions;
        },
      }),
      deleteTransactions: tool({
        description:
          "Delete transactions specified by the user. Ask user for confirmation first.",
        inputSchema: z
          .object({
            description: z
              .string()
              .describe("Description of the transaction")
              .optional(),
            amount: z.number().describe("Amount of the transaction").optional(),
            category: z
              .enum(
                (userCategories.length > 0
                  ? userCategories.map((category) => category.name)
                  : [""]) as [string, ...string[]],
              )
              .describe(
                "Category of the transaction. Must match the selected type (expense categories for expense, income categories for income).",
              )
              .optional(),
            type: z
              .enum(["expense", "income", "transfer"])
              .describe("Type of the transaction")
              .optional(),
            accountName: z
              .enum(
                (userAccounts.length > 0
                  ? userAccounts.map((account) => account.name)
                  : [""]) as [string, ...string[]],
              )
              .describe(
                "Source account for the transaction, if the type is expense or transfer",
              )
              .optional(),
            targetAccountName: z
              .enum(
                (userAccounts.length > 0
                  ? userAccounts.map((account) => account.name)
                  : [""]) as [string, ...string[]],
              )
              .describe(
                "Target Account ID of the transaction, if the type is transfer or income",
              )
              .optional(),
            startDatetime: z
              .string()
              .datetime()
              .describe("Start datetime for date range filtering")
              .optional(),
            endDatetime: z
              .string()
              .datetime()
              .describe("End datetime for date range filtering")
              .optional(),
          })
          .superRefine((data, ctx) => {
            // Check that at least one argument is provided
            if (
              data.description === undefined &&
              data.amount === undefined &&
              data.category === undefined &&
              data.type === undefined &&
              data.accountName === undefined &&
              data.targetAccountName === undefined &&
              data.startDatetime === undefined &&
              data.endDatetime === undefined
            ) {
              ctx.addIssue({
                code: "custom",
                message: "At least one argument must be provided",
                path: [],
              });
            }

            // If startDate is provided, endDate must also be provided
            if (
              data.startDatetime !== undefined &&
              data.endDatetime === undefined
            ) {
              ctx.addIssue({
                code: "custom",
                message:
                  "If startDatetime is provided, endDatetime must also be provided",
                path: ["endDatetime"],
              });
            }
          }),
        execute: async (criteria) => {
          await deleteTransactions({
            userId: userId,
            description: criteria.description,
            categoryName: criteria.category,
            type: criteria.type,
            accountName: criteria.accountName,
            targetAccountName: criteria.targetAccountName,
            startDatetime: criteria.startDatetime
              ? new Date(criteria.startDatetime)
              : undefined,
            endDatetime: criteria.endDatetime
              ? new Date(criteria.endDatetime)
              : undefined,
          });

          return { status: "deleted" };
        },
      }),

      // --- Update Transaction ---
      updateTransaction: tool({
        description:
          "Update an existing transaction. First use retrieveTransactions to find the transaction ID, then update it.",
        inputSchema: z.object({
          id: z.string().describe("ID of the transaction to update"),
          name: z
            .string()
            .describe("New description/name of the transaction")
            .optional(),
          date: z.string().date().describe("New date").optional(),
          time: z.string().time().describe("New time").optional(),
          amount: z.number().describe("New amount").optional(),
          category: z
            .enum(
              (userCategories.length > 0
                ? userCategories.map((c) => c.name)
                : [""]) as [string, ...string[]],
            )
            .describe("New category name")
            .optional(),
          type: z
            .enum(["expense", "income", "transfer"])
            .describe("New transaction type")
            .optional(),
          accountName: z
            .enum(
              (userAccounts.length > 0
                ? userAccounts.map((a) => a.name)
                : [""]) as [string, ...string[]],
            )
            .describe("New source account name")
            .optional(),
          targetAccountName: z
            .enum(
              (userAccounts.length > 0
                ? userAccounts.map((a) => a.name)
                : [""]) as [string, ...string[]],
            )
            .describe("New target account name")
            .optional(),
        }),
        execute: async ({
          id,
          name,
          date,
          time,
          amount,
          category,
          type,
          accountName,
          targetAccountName,
        }) => {
          // Fetch existing transaction
          const existing = await db
            .select()
            .from(transactionsTable)
            .where(
              and(
                eq(transactionsTable.id, id),
                eq(transactionsTable.userId, userId),
              ),
            )
            .limit(1);

          if (!existing.length) return { error: "Transaction not found" };

          const current = existing[0];
          const newType = type ?? current.type;

          // Resolve category
          let categoryId = current.category;
          if (category && newType !== "transfer") {
            const cat = await db
              .select({ id: categoriesTable.id })
              .from(categoriesTable)
              .where(
                and(
                  eq(categoriesTable.name, category),
                  eq(categoriesTable.userId, userId),
                ),
              )
              .limit(1);
            if (cat.length) categoryId = cat[0].id;
          }
          if (newType === "transfer") categoryId = null;

          // Resolve accounts
          let sourceAccountId = current.sourceAccountId;
          let targetAccountId = current.targetAccountId;

          if (accountName) {
            const acc = await db
              .select({ id: accountsTable.id })
              .from(accountsTable)
              .where(
                and(
                  eq(accountsTable.name, accountName),
                  eq(accountsTable.userId, userId),
                ),
              )
              .limit(1);
            if (acc.length) sourceAccountId = acc[0].id;
          }
          if (targetAccountName) {
            const acc = await db
              .select({ id: accountsTable.id })
              .from(accountsTable)
              .where(
                and(
                  eq(accountsTable.name, targetAccountName),
                  eq(accountsTable.userId, userId),
                ),
              )
              .limit(1);
            if (acc.length) targetAccountId = acc[0].id;
          }

          // Build date
          let newDate = current.date;
          if (date) {
            const base = new Date(date);
            if (time) {
              const [h, m = "0", s = "0"] = time.split(":");
              base.setHours(Number(h), Number(m), Number(s), 0);
            }
            newDate = base;
          }

          const updated = await db
            .update(transactionsTable)
            .set({
              description: name ?? current.description,
              date: newDate,
              amount: amount !== undefined ? amount.toString() : current.amount,
              type: newType,
              category: categoryId,
              sourceAccountId: newType === "income" ? null : sourceAccountId,
              targetAccountId: newType === "expense" ? null : targetAccountId,
            })
            .where(
              and(
                eq(transactionsTable.id, id),
                eq(transactionsTable.userId, userId),
              ),
            )
            .returning();

          return { status: "updated", transaction: updated[0] };
        },
      }),

      // --- Accounts CRUD ---
      createAccount: tool({
        description: "Create a new financial account for the user",
        inputSchema: z.object({
          name: z.string().describe("Name of the account"),
          type: z
            .string()
            .describe("Type of account (e.g. checking, savings, credit)")
            .optional(),
        }),
        execute: async ({ name, type }) => {
          const existing = await db
            .select()
            .from(accountsTable)
            .where(
              and(
                eq(accountsTable.name, name),
                eq(accountsTable.userId, userId),
              ),
            )
            .limit(1);

          if (existing.length)
            return { error: "Account with this name already exists" };

          const created = await db
            .insert(accountsTable)
            .values({ name, type: type ?? null, userId: userId })
            .returning();

          return { status: "created", account: created[0] };
        },
      }),

      getAccounts: tool({
        description: "Get all user accounts with their current balances",
        inputSchema: z.object({}),
        execute: async () => {
          return await fetchUserAccounts(userId);
        },
      }),

      updateAccount: tool({
        description: "Update an existing account (rename or change type)",
        inputSchema: z.object({
          name: z
            .enum(
              (userAccounts.length > 0
                ? userAccounts.map((a) => a.name)
                : [""]) as [string, ...string[]],
            )
            .describe("Current name of the account to update"),
          newName: z.string().describe("New name for the account").optional(),
          newType: z.string().describe("New type for the account").optional(),
        }),
        execute: async ({ name, newName, newType }) => {
          const acc = await db
            .select()
            .from(accountsTable)
            .where(
              and(
                eq(accountsTable.name, name),
                eq(accountsTable.userId, userId),
              ),
            )
            .limit(1);

          if (!acc.length) return { error: "Account not found" };

          const updated = await db
            .update(accountsTable)
            .set({
              ...(newName !== undefined && { name: newName }),
              ...(newType !== undefined && { type: newType }),
            })
            .where(
              and(
                eq(accountsTable.id, acc[0].id),
                eq(accountsTable.userId, userId),
              ),
            )
            .returning();

          return { status: "updated", account: updated[0] };
        },
      }),

      deleteAccount: tool({
        description: "Delete an account. Ask user for confirmation first.",
        inputSchema: z.object({
          name: z
            .enum(
              (userAccounts.length > 0
                ? userAccounts.map((a) => a.name)
                : [""]) as [string, ...string[]],
            )
            .describe("Name of the account to delete"),
        }),
        execute: async ({ name }) => {
          const acc = await db
            .select()
            .from(accountsTable)
            .where(
              and(
                eq(accountsTable.name, name),
                eq(accountsTable.userId, userId),
              ),
            )
            .limit(1);

          if (!acc.length) return { error: "Account not found" };

          await db
            .delete(accountsTable)
            .where(
              and(
                eq(accountsTable.id, acc[0].id),
                eq(accountsTable.userId, userId),
              ),
            );

          return { success: true, deletedAccount: name };
        },
      }),

      // --- Goals CRUD ---
      createGoal: tool({
        description:
          "Create a new financial goal. This also creates a linked account to track savings toward the goal.",
        inputSchema: z.object({
          name: z.string().describe("Name of the goal"),
          targetAmount: z.number().describe("Target amount in Mexican Pesos"),
          targetDate: z
            .string()
            .date()
            .describe("Target date to reach the goal (YYYY-MM-DD)")
            .optional(),
        }),
        execute: async ({ name, targetAmount, targetDate }) => {
          // Check if account with this name exists
          const existingAcc = await db
            .select()
            .from(accountsTable)
            .where(
              and(
                eq(accountsTable.name, name),
                eq(accountsTable.userId, userId),
              ),
            )
            .limit(1);

          if (existingAcc.length)
            return { error: "An account with this name already exists" };

          // Create linked account
          const account = await db
            .insert(accountsTable)
            .values({ name, userId: userId })
            .returning();

          // Create goal
          const goal = await db
            .insert(financialGoals)
            .values({
              name,
              targetAmount: targetAmount.toString(),
              targetDate: targetDate ?? null,
              accountId: account[0].id,
              userId: userId,
            })
            .returning();

          return { status: "created", goal: goal[0] };
        },
      }),

      getGoals: tool({
        description:
          "Get all financial goals with their current progress (amount saved vs target)",
        inputSchema: z.object({}),
        execute: async () => {
          return await fetchUserGoals(userId);
        },
      }),

      updateGoal: tool({
        description:
          "Update a financial goal's name, target amount, or target date",
        inputSchema: z.object({
          name: z.string().describe("Current name of the goal to update"),
          newName: z.string().describe("New name for the goal").optional(),
          newTargetAmount: z.number().describe("New target amount").optional(),
          newTargetDate: z
            .string()
            .date()
            .describe("New target date (YYYY-MM-DD)")
            .optional(),
        }),
        execute: async ({ name, newName, newTargetAmount, newTargetDate }) => {
          const goal = await db
            .select()
            .from(financialGoals)
            .where(
              and(
                eq(financialGoals.name, name),
                eq(financialGoals.userId, userId),
              ),
            )
            .limit(1);

          if (!goal.length) return { error: "Goal not found" };

          const updated = await db
            .update(financialGoals)
            .set({
              ...(newName !== undefined && { name: newName }),
              ...(newTargetAmount !== undefined && {
                targetAmount: newTargetAmount.toString(),
              }),
              ...(newTargetDate !== undefined && { targetDate: newTargetDate }),
            })
            .where(
              and(
                eq(financialGoals.id, goal[0].id),
                eq(financialGoals.userId, userId),
              ),
            )
            .returning();

          return { status: "updated", goal: updated[0] };
        },
      }),

      deleteGoal: tool({
        description:
          "Delete a financial goal. Ask user for confirmation first.",
        inputSchema: z.object({
          name: z.string().describe("Name of the goal to delete"),
        }),
        execute: async ({ name }) => {
          const goal = await db
            .select()
            .from(financialGoals)
            .where(
              and(
                eq(financialGoals.name, name),
                eq(financialGoals.userId, userId),
              ),
            )
            .limit(1);

          if (!goal.length) return { error: "Goal not found" };

          await db
            .delete(financialGoals)
            .where(
              and(
                eq(financialGoals.id, goal[0].id),
                eq(financialGoals.userId, userId),
              ),
            );

          return { success: true, deletedGoal: name };
        },
      }),

      // --- Categories CRUD ---
      createCategory: tool({
        description: "Create a new spending or income category",
        inputSchema: z.object({
          name: z.string().describe("Name of the category"),
          type: z
            .enum(["expense", "income"])
            .describe("Whether this is an expense or income category"),
          budget: z
            .number()
            .describe("Monthly budget for this category (expense only)")
            .optional(),
        }),
        execute: async ({ name, type, budget }) => {
          const created = await db
            .insert(categoriesTable)
            .values({
              name,
              type,
              budget: type === "expense" && budget ? budget.toString() : null,
              userId: userId,
            })
            .returning();

          return { status: "created", category: created[0] };
        },
      }),

      updateCategory: tool({
        description: "Update an existing category's name or type",
        inputSchema: z.object({
          name: z
            .enum(
              (userCategories.length > 0
                ? userCategories.map((c) => c.name)
                : [""]) as [string, ...string[]],
            )
            .describe("Current name of the category to update"),
          newName: z.string().describe("New name for the category").optional(),
          newType: z
            .enum(["expense", "income"])
            .describe("New type for the category")
            .optional(),
          newBudget: z
            .number()
            .describe("New monthly budget (expense only)")
            .optional(),
        }),
        execute: async ({ name, newName, newType, newBudget }) => {
          const cat = await db
            .select()
            .from(categoriesTable)
            .where(
              and(
                eq(categoriesTable.name, name),
                eq(categoriesTable.userId, userId),
              ),
            )
            .limit(1);

          if (!cat.length) return { error: "Category not found" };

          const updated = await db
            .update(categoriesTable)
            .set({
              ...(newName !== undefined && { name: newName }),
              ...(newType !== undefined && { type: newType }),
              ...(newBudget !== undefined && {
                budget: newBudget.toString(),
              }),
            })
            .where(
              and(
                eq(categoriesTable.id, cat[0].id),
                eq(categoriesTable.userId, userId),
              ),
            )
            .returning();

          return { status: "updated", category: updated[0] };
        },
      }),

      deleteCategory: tool({
        description:
          "Delete a category. Will fail if transactions are using it. Ask user for confirmation first.",
        inputSchema: z.object({
          name: z
            .enum(
              (userCategories.length > 0
                ? userCategories.map((c) => c.name)
                : [""]) as [string, ...string[]],
            )
            .describe("Name of the category to delete"),
        }),
        execute: async ({ name }) => {
          const cat = await db
            .select()
            .from(categoriesTable)
            .where(
              and(
                eq(categoriesTable.name, name),
                eq(categoriesTable.userId, userId),
              ),
            )
            .limit(1);

          if (!cat.length) return { error: "Category not found" };

          // Check for transactions using this category
          const txns = await db
            .select({ id: transactionsTable.id })
            .from(transactionsTable)
            .where(
              and(
                eq(transactionsTable.category, cat[0].id),
                eq(transactionsTable.userId, userId),
              ),
            )
            .limit(1);

          if (txns.length)
            return {
              error:
                "Cannot delete category — it has existing transactions. Reassign them first.",
            };

          await db
            .delete(categoriesTable)
            .where(
              and(
                eq(categoriesTable.id, cat[0].id),
                eq(categoriesTable.userId, userId),
              ),
            );

          return { success: true, deletedCategory: name };
        },
      }),

      // --- Recurring Transactions ---
      createRecurringTransaction: tool({
        description:
          "Create a recurring transaction that automatically creates transactions at the specified frequency (e.g. monthly Netflix subscription, biweekly salary).",
        inputSchema: z
          .object({
            name: z
              .string()
              .describe("Description of the recurring transaction"),
            amount: z.number().describe("Amount of each occurrence"),
            type: z
              .enum(["expense", "income", "transfer"])
              .describe("Type of the transaction"),
            category: z
              .enum(
                (userCategories.length > 0
                  ? userCategories.map((c) => c.name)
                  : [""]) as [string, ...string[]],
              )
              .describe("Category name (required for expense/income)")
              .optional(),
            frequency: z
              .enum([
                "daily",
                "weekly",
                "biweekly",
                "monthly",
                "quarterly",
                "semi-annually",
                "yearly",
              ])
              .describe("How often the transaction repeats"),
            startDate: z
              .string()
              .date()
              .describe(
                "Start date (YYYY-MM-DD). Defaults to today if not specified.",
              ),
            endDate: z
              .string()
              .date()
              .describe("Optional end date (YYYY-MM-DD). Omit for indefinite.")
              .optional(),
            accountName: z
              .enum(
                (userAccounts.length > 0
                  ? userAccounts.map((a) => a.name)
                  : [""]) as [string, ...string[]],
              )
              .describe("Source account (for expense/transfer)")
              .optional(),
            targetAccountName: z
              .enum(
                (userAccounts.length > 0
                  ? userAccounts.map((a) => a.name)
                  : [""]) as [string, ...string[]],
              )
              .describe("Target account (for income/transfer)")
              .optional(),
          })
          .superRefine((val, ctx) => {
            if (val.type === "transfer") return;
            if (!val.category) {
              ctx.addIssue({
                code: "custom",
                message: "Category is required for non-transfer transactions",
                path: ["category"],
              });
              return;
            }
            const cat = categoryByName.get(val.category);
            if (cat && cat.type !== val.type) {
              ctx.addIssue({
                code: "custom",
                message: `Category "${val.category}" is type "${cat.type}" but transaction is "${val.type}"`,
                path: ["category"],
              });
            }
          }),
        execute: async ({
          name,
          amount,
          type,
          category,
          frequency,
          startDate,
          endDate,
          accountName,
          targetAccountName,
        }) => {
          const created = await createRecurringTransaction({
            userId: userId,
            description: name,
            amount,
            type,
            frequency,
            startDate,
            endDate: endDate ?? null,
            categoryName: category,
            accountName,
            targetAccountName,
          });

          return {
            status: "created",
            recurringTransaction: {
              id: created.id,
              description: created.description,
              amount: created.amount,
              type: created.type,
              frequency: created.frequency,
              startDate: created.startDate,
              endDate: created.endDate,
              nextRunDate: created.nextRunDate,
            },
          };
        },
      }),

      getRecurringTransactions: tool({
        description:
          "List all recurring transactions for the user (active and paused).",
        inputSchema: z.object({}),
        execute: async () => {
          return await getRecurringTransactions(userId);
        },
      }),

      deleteRecurringTransaction: tool({
        description:
          "Delete a recurring transaction by its ID. Ask user for confirmation first. Previously created transactions are NOT affected.",
        inputSchema: z.object({
          id: z
            .string()
            .describe(
              "ID of the recurring transaction to delete. Use getRecurringTransactions to find the ID first.",
            ),
        }),
        execute: async ({ id }) => {
          const deleted = await deleteRecurringTransaction(userId, id);
          if (!deleted) return { error: "Recurring transaction not found" };
          return { status: "deleted" };
        },
      }),
  };

  return {
    system: extraInstructions
      ? `${systemContext}\n\n${extraInstructions}`
      : systemContext,
    tools,
  };
}
