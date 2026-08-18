import { db } from "@/lib/db";
import { categories } from "@/lib/db/schema/categories";
import { transactions } from "@/lib/db/schema/transactions";
import { recurringTransactions } from "@/lib/db/schema/recurringTransactions";
import { expenses } from "@/lib/db/schema/expenses";
import { currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * Merges this category into another one: every transaction, recurring
 * transaction and expense pointing at it is repointed to the target category,
 * then the (now empty) source category is deleted.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: sourceId } = await params;
    const { targetCategoryId: targetId } = await request.json();

    if (!targetId || typeof targetId !== "string") {
      return NextResponse.json(
        { error: "La categoría destino es requerida" },
        { status: 400 }
      );
    }

    if (targetId === sourceId) {
      return NextResponse.json(
        { error: "No puedes fusionar una categoría consigo misma" },
        { status: 400 }
      );
    }

    const bothCategories = await db
      .select({ id: categories.id, name: categories.name, type: categories.type })
      .from(categories)
      .where(eq(categories.userId, user.id));

    const source = bothCategories.find((c) => c.id === sourceId);
    const target = bothCategories.find((c) => c.id === targetId);

    if (!source || !target) {
      return NextResponse.json(
        { error: "Category not found" },
        { status: 404 }
      );
    }

    if (source.type !== target.type) {
      return NextResponse.json(
        { error: "Solo puedes fusionar categorías del mismo tipo" },
        { status: 400 }
      );
    }

    const moved = await db.transaction(async (tx) => {
      const movedTransactions = await tx
        .update(transactions)
        .set({ category: targetId })
        .where(
          and(
            eq(transactions.category, sourceId),
            eq(transactions.userId, user.id)
          )
        )
        .returning({ id: transactions.id });

      await tx
        .update(recurringTransactions)
        .set({ category: targetId })
        .where(
          and(
            eq(recurringTransactions.category, sourceId),
            eq(recurringTransactions.userId, user.id)
          )
        );

      // Legacy table with no userId column; scoped by the category itself,
      // which we already verified belongs to this user.
      await tx
        .update(expenses)
        .set({ categoryId: targetId })
        .where(eq(expenses.categoryId, sourceId));

      await tx
        .delete(categories)
        .where(and(eq(categories.id, sourceId), eq(categories.userId, user.id)));

      return movedTransactions.length;
    });

    return NextResponse.json({
      message: "Category merged successfully",
      movedTransactions: moved,
      targetCategory: target,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to merge category: ${error}` },
      { status: 500 }
    );
  }
}
