"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Info } from "lucide-react";
import TransactionCard from "@/app/components/TransactionCard";
import TransactionDialog from "@/app/components/TransactionDialog";
import { EmptyState } from "@/app/components/ui/states";
import { Transaction } from "../DataDashboard";

interface ReviewPageClientProps {
  initialTransactions: Transaction[];
}

export default function ReviewPageClient({
  initialTransactions,
}: ReviewPageClientProps) {
  const router = useRouter();
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);
  const [transactions, setTransactions] =
    useState<Transaction[]>(initialTransactions);

  // Sync state with server data when props change (after router.refresh())
  useEffect(() => {
    setTransactions(initialTransactions);
  }, [initialTransactions]);

  const handleRefresh = useCallback(() => {
    // Refresh the page data by revalidating the server component
    // The server component will re-fetch and pass new data via props
    router.refresh();
  }, [router]);

  const groupTransactionsByDay = (transactions: Transaction[]) => {
    return transactions.reduce(
      (groups, transaction) => {
        const date = new Date(transaction.date);
        let dayKey = date.toLocaleDateString("es-MX", {
          weekday: "long",
          month: "long",
          day: "numeric",
          // Imported dates are UTC-anchored wall clock — see DataDashboard.
          timeZone: "UTC",
        });

        dayKey = dayKey.charAt(0).toUpperCase() + dayKey.slice(1);

        if (!groups[dayKey]) {
          groups[dayKey] = [];
        }
        groups[dayKey].push(transaction);
        return groups;
      },
      {} as Record<string, Transaction[]>,
    );
  };

  return (
    <div className="flex justify-center container mx-auto px-8 py-4 min-h-screen">
      <main className="flex flex-col w-full max-w-[680px]">
        <div className="grow">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Link
                href="/data"
                className="text-ink-subtle hover:text-ink hover:bg-surface rounded-lg p-2 transition-all"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <h1 className="text-2xl font-bold text-ink">
                Revisar transacciones
              </h1>
            </div>

            {transactions.length > 0 && (
              <span className="text-xs text-ink-faint bg-surface-strong border border-edge-soft px-2.5 py-1 rounded-full tabular-nums">
                {transactions.length} pendiente
                {transactions.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Info banner */}
          <div className="flex items-start gap-3 p-4 bg-surface backdrop-blur-md border border-edge rounded-xl mb-4">
            <Info className="w-4 h-4 text-ink-faint shrink-0 mt-0.5" />
            <p className="text-sm text-ink-muted">
              Estas transacciones no pudieron ser clasificadas automáticamente
              de tus estados de cuenta. Ábrelas para asignarles una categoría.
            </p>
          </div>

          <div className="grid gap-4 mx-auto">
            {transactions.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 size={24} />}
                title="No hay transacciones pendientes"
                description="Todas las transacciones han sido revisadas."
              />
            ) : (
              Object.entries(groupTransactionsByDay(transactions)).map(
                ([day, dayTransactions]) => (
                  <div key={day}>
                    <div className="flex items-center gap-3 mb-2 mt-4 first:mt-1">
                      <span className="text-[10px] text-ink-faint uppercase tracking-widest font-semibold shrink-0">
                        {day}
                      </span>
                      <div className="flex-1 h-px bg-edge-soft" />
                    </div>
                    <div className="space-y-2">
                      {dayTransactions.map((transaction) => (
                        <div
                          key={transaction.id}
                          onClick={() => {
                            setSelectedTransaction(transaction);
                            setTransactionDialogOpen(true);
                          }}
                        >
                          <TransactionCard
                            description={transaction.description}
                            date={transaction.date}
                            showCategory={false}
                            amount={transaction.amount}
                            categoryName={transaction.categoryName || ""}
                            type={transaction.type}
                            sourceAccountName={
                              transaction.sourceAccountName || ""
                            }
                            targetAccountName={
                              transaction.targetAccountName || ""
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ),
              )
            )}
          </div>
        </div>
      </main>

      {selectedTransaction && (
        <TransactionDialog
          open={transactionDialogOpen}
          onOpenChange={setTransactionDialogOpen}
          transaction={{
            id: selectedTransaction.id,
            description: selectedTransaction.description,
            date: selectedTransaction.date,
            type: selectedTransaction.type,
            amount: selectedTransaction.amount,
            categoryName: selectedTransaction.categoryName || null,
            sourceAccountId: selectedTransaction.sourceAccountId,
            targetAccountId: selectedTransaction.targetAccountId,
          }}
          onUpdate={() => {
            setTransactionDialogOpen(false);
            handleRefresh();
          }}
          onDelete={() => {
            setTransactionDialogOpen(false);
            handleRefresh();
          }}
        />
      )}
    </div>
  );
}
