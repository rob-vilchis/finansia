"use client";

import TransactionCard from "@/app/components/TransactionCard";
import { useToast } from "@/app/components/GenericToast";
import { EmptyState, ErrorState } from "@/app/components/ui/states";
import {
  GlassButton,
  GlassInput,
  GlassDialogShell,
  glassDialogContent,
  FieldLabel,
  FieldError,
} from "@/app/components/ui/glass";
import { Transaction } from "@/app/(main)/data/DataDashboard";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, VisuallyHidden } from "@radix-ui/themes";
import {
  ArrowLeft,
  FolderX,
  Pencil,
  ReceiptText,
  Trash2,
  FolderPen,
  Wallet,
  Plus,
  DollarSign,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import z from "zod";

interface Category {
  id: string;
  name: string;
  type: string;
  budget: string | null;
}

interface CategoryData {
  category: Category;
  transactions: Transaction[];
  summary: {
    totalAmount: number;
    transactionCount: number;
    averageAmount: number;
    lastTransactionDate: string | null;
  };
}

function formatMXN(amount: number, withCents = false) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: withCents ? 2 : 0,
  }).format(amount);
}

const editSchema = z.object({
  name: z.string().min(1, "El nombre de la categoría es requerido"),
});

const budgetSchema = z
  .object({
    budgeted: z.boolean(),
    budget: z
      .number({ invalid_type_error: "Ingresa un número válido" })
      .nullish(),
  })
  .superRefine((val, ctx) => {
    if (val.budgeted && (val.budget == null || val.budget <= 0)) {
      ctx.addIssue({
        path: ["budget"],
        code: z.ZodIssueCode.custom,
        message: "El presupuesto debe ser mayor a 0",
      });
    }
  });

export default function CategoryPage(props: {
  params: Promise<{ id: string }>;
}) {
  const params = use(props.params);
  const router = useRouter();
  const [categoryData, setCategoryData] = useState<CategoryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const { showToast } = useToast();
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSavingBudget, setIsSavingBudget] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showBudgetDialog, setShowBudgetDialog] = useState(false);

  useEffect(() => {
    fetch("api/create-user");
  }, []);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: "",
    },
  });

  const {
    control: budgetControl,
    handleSubmit: handleBudgetSubmit,
    reset: resetBudget,
    watch: watchBudget,
    formState: { errors: budgetErrors },
  } = useForm({
    resolver: zodResolver(budgetSchema),
    defaultValues: {
      budgeted: false,
      budget: null as number | null | undefined,
    },
  });

  const fetchCategoryData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      setNotFound(false);
      const response = await fetch(`/api/categories/${params.id}`);
      if (!response.ok) {
        if (response.status === 404) {
          setNotFound(true);
        } else {
          throw new Error("Error al obtener datos de la categoría");
        }
        return;
      }
      const data = await response.json();
      setCategoryData(data);
      reset({
        name: data.category.name,
      });
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message || "Error al obtener datos de la categoría");
      } else {
        setError("Error al obtener datos de la categoría");
      }
    } finally {
      setIsLoading(false);
    }
  }, [params.id, reset]);

  useEffect(() => {
    fetchCategoryData();
  }, [fetchCategoryData]);

  const handleRename = () => {
    setShowRenameDialog(true);
  };

  const handleEditBudget = () => {
    const current = categoryData?.category.budget
      ? Number(categoryData.category.budget)
      : null;
    resetBudget({
      budgeted: current !== null && current > 0,
      budget: current,
    });
    setShowBudgetDialog(true);
  };

  const handleDelete = () => {
    setShowDeleteDialog(true);
  };

  const onSubmitRename = async (data: { name: string }) => {
    try {
      setIsRenaming(true);
      // The PATCH route treats a missing budget as null, so carry the existing
      // budget through to avoid wiping it on a name-only save.
      const currentBudget = categoryData?.category.budget
        ? Number(categoryData.category.budget)
        : null;
      const response = await fetch(`/api/categories/${params.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: data.name,
          type: categoryData?.category.type,
          budget: currentBudget,
        }),
      });

      if (!response.ok) {
        throw new Error("Error al renombrar la categoría");
      }

      setShowRenameDialog(false);
      fetchCategoryData(); // Refresh data
    } catch (err: unknown) {
      console.error(err);
      showToast({
        title: "No se pudo actualizar la categoría",
        message: "Intenta de nuevo.",
        variant: "error",
      });
    } finally {
      setIsRenaming(false);
    }
  };

  const onSubmitBudget = async (data: {
    budgeted: boolean;
    budget?: number | null;
  }) => {
    try {
      setIsSavingBudget(true);
      const response = await fetch(`/api/categories/${params.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: categoryData?.category.name,
          type: categoryData?.category.type,
          budget: data.budgeted ? data.budget : null,
        }),
      });

      if (!response.ok) {
        throw new Error("Error al actualizar el presupuesto");
      }

      setShowBudgetDialog(false);
      fetchCategoryData(); // Refresh data
    } catch (err: unknown) {
      console.error(err);
      showToast({
        title: "No se pudo actualizar el presupuesto",
        message: "Intenta de nuevo.",
        variant: "error",
      });
    } finally {
      setIsSavingBudget(false);
    }
  };

  const confirmDelete = async () => {
    try {
      setIsDeleting(true);
      const response = await fetch(`/api/categories/${params.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Error al eliminar la categoría");
      }

      setShowDeleteDialog(false);
      router.push("/categories"); // Redirect to categories list
    } catch (err: unknown) {
      console.error(err);
      showToast({
        title: "No se pudo eliminar la categoría",
        message:
          err instanceof Error && err.message
            ? err.message
            : "Intenta de nuevo.",
        variant: "error",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "expense":
        return "Gasto";
      case "income":
        return "Ingreso";
      case "transfer":
        return "Transferencia";
      default:
        return type;
    }
  };

  const typeChipClass = (type: string) => {
    switch (type) {
      case "expense":
        return "bg-expense-soft border-expense-border text-expense";
      case "income":
        return "bg-income-soft border-income-border text-income";
      default:
        return "bg-transfer-soft border-transfer-border text-transfer";
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-app font-(family-name:--font-outfit) w-full px-5 md:px-10 py-8">
        <div className="w-full max-w-4xl mx-auto">
          {/* Back Button Skeleton */}
          <div className="mb-6">
            <div className="w-32 h-6 bg-surface rounded animate-pulse"></div>
          </div>

          {/* Category Header Skeleton */}
          <div className="rounded-xl border border-edge bg-surface backdrop-blur-md p-5 mb-6">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex gap-2 items-center mb-3">
                  <div className="w-48 h-9 bg-surface-strong rounded animate-pulse"></div>
                  <div className="w-8 h-8 bg-surface-strong rounded animate-pulse"></div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-20 h-6 bg-surface-strong rounded-full animate-pulse"></div>
                  <div className="w-32 h-6 bg-surface-strong rounded animate-pulse"></div>
                </div>
              </div>
              <div className="w-24 h-9 bg-surface-strong rounded-lg animate-pulse"></div>
            </div>

            <div className="mt-5 pt-5 border-t border-edge-soft">
              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-16 bg-surface-strong rounded-lg animate-pulse"
                  ></div>
                ))}
              </div>
            </div>
          </div>

          {/* Transactions List Skeleton */}
          <div className="space-y-3">
            <div className="w-32 h-7 bg-surface rounded animate-pulse"></div>
            <div className="w-40 h-5 bg-surface rounded animate-pulse"></div>
            <div className="space-y-2">
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div
                  key={i}
                  className="w-full h-14 bg-surface rounded-xl animate-pulse"
                ></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-app font-(family-name:--font-outfit) w-full px-5 md:px-10 py-8">
        <div className="w-full max-w-4xl mx-auto">
          <Link
            href="/categories"
            className="inline-flex items-center gap-2 text-sm font-medium text-ink-subtle hover:text-ink mb-6 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver a Categorías
          </Link>
          <ErrorState
            title="No se pudo cargar la categoría"
            message="Revisa tu conexión e intenta de nuevo."
            onRetry={fetchCategoryData}
          />
        </div>
      </div>
    );
  }

  if (notFound || !categoryData) {
    return (
      <div className="min-h-screen bg-app font-(family-name:--font-outfit) w-full px-5 md:px-10 py-8">
        <div className="w-full max-w-4xl mx-auto">
          <EmptyState
            icon={<FolderX size={24} />}
            title="Categoría no encontrada"
            description="Esta categoría no existe o fue eliminada."
            action={
              <Link
                href="/categories"
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all bg-surface border border-edge text-ink-muted hover:bg-surface-strong hover:text-ink hover:border-edge-strong inline-flex items-center gap-2"
              >
                <ArrowLeft size={14} />
                Volver a categorías
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const groupTransactionsByMonth = (transactions: Transaction[]) => {
    return transactions.reduce(
      (groups, transaction) => {
        const date = new Date(transaction.date);
        let monthKey = date.toLocaleDateString("es-MX", {
          month: "long",
          year: "numeric",
        });

        monthKey = monthKey.charAt(0).toUpperCase() + monthKey.slice(1);

        if (!groups[monthKey]) {
          groups[monthKey] = [];
        }
        groups[monthKey].push(transaction);
        return groups;
      },
      {} as Record<string, Transaction[]>,
    );
  };

  const { category, summary } = categoryData;
  const isExpense = category.type === "expense";
  const budget = category.budget ? Number(category.budget) : null;
  const hasBudget = isExpense && budget !== null && budget > 0;

  // Budget is monthly, so compare it against the current calendar month's
  // spend (matches the `spent` figure shown on the categories list cards),
  // not the all-time total.
  const now = new Date();
  const monthlySpent = categoryData.transactions.reduce((sum, t) => {
    const d = new Date(t.date);
    return d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()
      ? sum + Number(t.amount)
      : sum;
  }, 0);

  const rawPct = hasBudget ? (monthlySpent / budget!) * 100 : 0;
  const clampedPct = Math.min(rawPct, 100);
  const budgetStatus =
    rawPct >= 100 ? "over" : rawPct >= 75 ? "warning" : "ok";
  const budgetAccent = {
    over: { bar: "bg-expense", text: "text-expense", glow: "shadow-rose-500/10" },
    warning: { bar: "bg-warn", text: "text-warn", glow: "shadow-amber-500/10" },
    ok: { bar: "bg-income", text: "text-income", glow: "shadow-emerald-500/10" },
  }[budgetStatus];
  const remaining = hasBudget ? budget! - monthlySpent : 0;

  const totalColor = isExpense
    ? "text-expense"
    : category.type === "income"
      ? "text-income"
      : "text-ink";

  return (
    <div className="min-h-screen bg-app font-(family-name:--font-outfit) w-full px-5 md:px-10 pt-8 pb-16">
      <div className="w-full max-w-4xl mx-auto animate-fadeIn">
        {/* Back Button */}
        <Link
          href="/categories"
          className="inline-flex items-center gap-2 text-sm font-medium text-ink-subtle hover:text-ink mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a Categorías
        </Link>

        {/* Category Header Card */}
        <div
          className={`rounded-xl border border-edge bg-surface backdrop-blur-md p-5 mb-6 shadow-lg shadow-black/10 ${
            hasBudget ? budgetAccent.glow : ""
          }`}
        >
          <div className="flex justify-between items-start gap-3">
            <div className="min-w-0">
              <div className="flex gap-1.5 items-center mb-2">
                <h1 className="text-2xl sm:text-3xl font-bold text-ink truncate">
                  {category.name}
                </h1>
                <button
                  onClick={handleRename}
                  aria-label="Editar nombre"
                  className="shrink-0 p-2 text-ink-subtle hover:text-ink hover:bg-surface rounded-lg transition-colors cursor-pointer"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium border ${typeChipClass(
                    category.type,
                  )}`}
                >
                  {getTypeLabel(category.type)}
                </span>
                <span className="text-sm text-ink-muted">
                  {summary.transactionCount}{" "}
                  {summary.transactionCount === 1
                    ? "transacción"
                    : "transacciones"}
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <GlassButton
              variant="danger"
              onClick={handleDelete}
              className="flex items-center gap-2 shrink-0"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">Eliminar</span>
            </GlassButton>
          </div>

          {/* Budget hero — only for expense categories with a budget */}
          {hasBudget && (
            <div className="mt-5 pt-5 border-t border-edge-soft">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5 text-ink-subtle" />
                  <p className="text-[11px] font-medium text-ink-subtle uppercase tracking-wider">
                    Presupuesto mensual
                  </p>
                </div>
                <button
                  onClick={handleEditBudget}
                  aria-label="Editar presupuesto"
                  className="shrink-0 p-1.5 text-ink-subtle hover:text-ink hover:bg-surface rounded-lg transition-colors cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-end justify-between gap-2 mb-2">
                <div>
                  <p className="text-[11px] font-medium text-ink-subtle uppercase tracking-wider mb-1">
                    Gastado este mes
                  </p>
                  <p className="font-mono text-2xl sm:text-3xl font-bold tabular-nums text-ink">
                    {formatMXN(monthlySpent)}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`font-mono text-2xl font-semibold tabular-nums ${budgetAccent.text}`}
                  >
                    {Math.round(rawPct)}%
                  </span>
                  <p className="text-xs text-ink-faint mt-0.5">
                    de {formatMXN(budget!)}
                  </p>
                </div>
              </div>

              <div className="h-2 w-full bg-surface-strong rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${budgetAccent.bar}`}
                  style={{ width: `${clampedPct}%` }}
                />
              </div>

              <p className={`text-xs mt-2 font-medium ${budgetAccent.text}`}>
                {remaining >= 0
                  ? `Te quedan ${formatMXN(remaining)}`
                  : `Excedido por ${formatMXN(Math.abs(remaining))}`}
              </p>
            </div>
          )}

          {/* No-budget CTA — expense categories without a budget */}
          {isExpense && !hasBudget && (
            <div className="mt-5 pt-5 border-t border-edge-soft flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <Wallet className="w-4 h-4 text-ink-subtle shrink-0" />
                <p className="text-sm text-ink-muted">
                  Sin presupuesto mensual
                </p>
              </div>
              <GlassButton
                variant="secondary"
                onClick={handleEditBudget}
                className="flex items-center gap-2 shrink-0"
              >
                <Plus className="w-4 h-4" />
                Definir presupuesto
              </GlassButton>
            </div>
          )}

          {/* Secondary stats */}
          <div className="mt-5 pt-5 border-t border-edge-soft grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-surface border border-edge-soft px-3 py-2.5">
              <p className="text-[11px] text-ink-subtle mb-1">Monto total</p>
              <p
                className={`font-mono text-base sm:text-lg font-bold tabular-nums ${totalColor}`}
              >
                {formatMXN(summary.totalAmount)}
              </p>
            </div>
            <div className="rounded-lg bg-surface border border-edge-soft px-3 py-2.5">
              <p className="text-[11px] text-ink-subtle mb-1">Promedio</p>
              <p className="font-mono text-base sm:text-lg font-bold tabular-nums text-ink">
                {formatMXN(summary.averageAmount, true)}
              </p>
            </div>
            <div className="rounded-lg bg-surface border border-edge-soft px-3 py-2.5">
              <p className="text-[11px] text-ink-subtle mb-1">Última</p>
              <p className="text-base sm:text-lg font-bold text-ink">
                {summary.lastTransactionDate
                  ? new Date(summary.lastTransactionDate).toLocaleDateString(
                      "es-MX",
                      {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      },
                    )
                  : "N/A"}
              </p>
            </div>
          </div>
        </div>

        {/* Transactions List */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-ink">Transacciones</h2>

          {categoryData.transactions.length > 0 ? (
            Object.entries(
              groupTransactionsByMonth(categoryData.transactions),
            ).map(([month, monthTransactions]) => {
              const monthlyTotal = monthTransactions.reduce(
                (sum, transaction) => sum + Number(transaction.amount),
                0,
              );
              return (
                <div key={month}>
                  <div className="sticky top-0 z-10 flex justify-between items-center py-2 bg-app/80 backdrop-blur-md">
                    <h3 className="text-sm font-semibold text-ink-muted">
                      {month}
                    </h3>
                    <span className="font-mono text-xs font-medium text-ink-subtle tabular-nums">
                      {formatMXN(monthlyTotal)}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {monthTransactions.map((transaction) => (
                      <TransactionCard
                        key={transaction.id}
                        description={transaction.description}
                        date={transaction.date}
                        amount={transaction.amount}
                        showCategory={false}
                        showDate
                        categoryName={transaction.categoryName}
                        type={transaction.type}
                        sourceAccountName={transaction.sourceAccountName}
                        targetAccountName={transaction.targetAccountName}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          ) : (
            <EmptyState
              icon={<ReceiptText size={24} />}
              title="Sin transacciones"
              description="Aún no hay transacciones en esta categoría."
            />
          )}
        </div>
      </div>

      {/* Edit Name Dialog */}
      <Dialog.Root open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <Dialog.Content maxWidth="420px" className={glassDialogContent}>
          <VisuallyHidden>
            <Dialog.Title>Editar nombre</Dialog.Title>
          </VisuallyHidden>
          <GlassDialogShell
            icon={<FolderPen size={16} />}
            title="Editar nombre"
            subtitle="Cambia el nombre de la categoría."
          >
            <form
              onSubmit={handleSubmit(onSubmitRename)}
              className="space-y-4"
            >
              <div>
                <FieldLabel>Nombre</FieldLabel>
                <Controller
                  name="name"
                  control={control}
                  render={({ field }) => (
                    <GlassInput
                      {...field}
                      placeholder="Nombre de la categoría"
                    />
                  )}
                />
                <FieldError message={errors.name?.message} />
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t border-edge-soft mt-2">
                <GlassButton
                  type="button"
                  variant="secondary"
                  onClick={() => setShowRenameDialog(false)}
                >
                  Cancelar
                </GlassButton>
                <GlassButton type="submit" variant="primary" disabled={isRenaming}>
                  {isRenaming ? "Guardando..." : "Guardar"}
                </GlassButton>
              </div>
            </form>
          </GlassDialogShell>
        </Dialog.Content>
      </Dialog.Root>

      {/* Budget Dialog */}
      <Dialog.Root open={showBudgetDialog} onOpenChange={setShowBudgetDialog}>
        <Dialog.Content maxWidth="420px" className={glassDialogContent}>
          <VisuallyHidden>
            <Dialog.Title>Presupuesto mensual</Dialog.Title>
          </VisuallyHidden>
          <GlassDialogShell
            icon={<Wallet size={16} />}
            title="Presupuesto mensual"
            subtitle="Define o desactiva el presupuesto de esta categoría."
          >
            <form
              onSubmit={handleBudgetSubmit(onSubmitBudget)}
              className="space-y-4"
            >
              <div>
                <FieldLabel>Presupuesto mensual (MXN)</FieldLabel>
                <div className="flex items-center gap-3">
                  <Controller
                    name="budgeted"
                    control={budgetControl}
                    render={({ field }) => (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={field.value}
                        aria-label="Activar presupuesto"
                        onClick={() => field.onChange(!field.value)}
                        className={`relative w-10 h-6 rounded-full border transition-colors shrink-0 cursor-pointer ${
                          field.value
                            ? "bg-accent-soft border-accent-border"
                            : "bg-surface border-edge"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 w-5 h-5 rounded-full transition-transform ${
                            field.value
                              ? "translate-x-4 bg-accent"
                              : "translate-x-0.5 bg-ink-faint"
                          }`}
                        />
                      </button>
                    )}
                  />
                  <Controller
                    name="budget"
                    control={budgetControl}
                    render={({ field }) => (
                      <div
                        className={`flex-1 transition-opacity ${
                          watchBudget("budgeted") ? "" : "opacity-40"
                        }`}
                      >
                        <GlassInput
                          leadingIcon={<DollarSign size={16} />}
                          type="number"
                          min="0"
                          step="1"
                          placeholder="0"
                          disabled={!watchBudget("budgeted")}
                          className="font-mono tabular-nums"
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                            )
                          }
                        />
                      </div>
                    )}
                  />
                </div>
                <FieldError message={budgetErrors.budget?.message} />
                <p className="text-xs text-ink-faint mt-2">
                  Desactiva el interruptor para quitar el presupuesto de esta
                  categoría.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t border-edge-soft mt-2">
                <GlassButton
                  type="button"
                  variant="secondary"
                  onClick={() => setShowBudgetDialog(false)}
                >
                  Cancelar
                </GlassButton>
                <GlassButton
                  type="submit"
                  variant="primary"
                  disabled={isSavingBudget}
                >
                  {isSavingBudget ? "Guardando..." : "Guardar"}
                </GlassButton>
              </div>
            </form>
          </GlassDialogShell>
        </Dialog.Content>
      </Dialog.Root>

      {/* Delete Confirmation Dialog */}
      <Dialog.Root open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <Dialog.Content maxWidth="420px" className={glassDialogContent}>
          <VisuallyHidden>
            <Dialog.Title>Eliminar categoría</Dialog.Title>
          </VisuallyHidden>
          <GlassDialogShell
            icon={<Trash2 size={16} />}
            title="Eliminar categoría"
            subtitle="Esta acción no se puede deshacer."
          >
            <div className="space-y-4">
              <p className="text-sm text-ink-muted">
                ¿Estás seguro de que deseas eliminar &quot;{category.name}
                &quot;?
              </p>
              {summary.transactionCount > 0 && (
                <div className="rounded-lg border border-expense-border bg-expense-soft px-3 py-2.5">
                  <p className="text-xs text-expense">
                    Esta categoría tiene {summary.transactionCount}{" "}
                    transacciones. No puedes eliminar una categoría con
                    transacciones existentes.
                  </p>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-4 border-t border-edge-soft mt-2">
                <GlassButton
                  type="button"
                  variant="secondary"
                  onClick={() => setShowDeleteDialog(false)}
                >
                  Cancelar
                </GlassButton>
                <GlassButton
                  variant="danger"
                  disabled={isDeleting || summary.transactionCount > 0}
                  onClick={confirmDelete}
                >
                  {isDeleting ? "Eliminando..." : "Eliminar"}
                </GlassButton>
              </div>
            </div>
          </GlassDialogShell>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
