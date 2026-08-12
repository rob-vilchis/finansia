"use client";

import { Tabs } from "@radix-ui/themes";
import {
  AlertCircle,
  ArrowRight,
  Loader2,
  Plus,
  ReceiptText,
  SearchX,
  Upload,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import AccountsList from "@/app/components/AccountsList";
import { AddButton } from "@/app/components/AddButton";
import { useToast } from "@/app/components/GenericToast";
import GoalsList from "@/app/components/GoalsList";
import NewAccountDialog from "@/app/components/NewAccountDialog";
import NewTransactionDialog from "@/app/components/NewTransactionDialog";
import TransactionCard from "@/app/components/TransactionCard";
import TransactionDialog from "@/app/components/TransactionDialog";
import TransactionFilters, {
  hasAnyFilter,
  type ActiveFilters,
} from "@/app/components/TransactionFilters";
import UploadStatementDialog from "@/app/components/UploadStatementDialog";
import { GlassButton, GlassSegmented } from "@/app/components/ui/glass";
import { EmptyState } from "@/app/components/ui/states";
import { Goal } from "@/lib/services/goals";

export interface Transaction {
  id: string;
  description: string | null;
  date: Date;
  amount: string;
  categoryName: string | null;
  type: string;
  sourceAccountName: string | null;
  targetAccountName: string | null;
  sourceAccountId: string | null;
  targetAccountId?: string | null;
}

export interface Account {
  id: string;
  name: string;
  balance: number;
}

interface Statement {
  id: string;
  userId: string | null;
  originalFileName: string;
  extractedText: string | null;
  status: "uploaded" | "processing" | "ready" | "error" | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface Category {
  id: string;
  name: string;
  type: string;
}

type TabValue = "transactions" | "goals" | "accounts";

const TAB_OPTIONS: { value: TabValue; label: string }[] = [
  { value: "transactions", label: "Transacciones" },
  { value: "goals", label: "Metas" },
  { value: "accounts", label: "Cuentas" },
];

export default function DataDashboard({
  transactions,
  accounts,
  goals,
  unverifiedTransactions,
  pendingStatements: pending,
  categories,
  currentPage,
  totalPages,
  totalCount,
  activeFilters,
}: {
  transactions: Transaction[];
  accounts: Account[];
  goals: Goal[];
  unverifiedTransactions: Transaction[];
  pendingStatements: Statement[];
  categories: Category[];
  currentPage: number;
  totalPages: number;
  totalCount: number;
  activeFilters: ActiveFilters;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [dialogOpen, setNewTransactionDialogOpen] = useState(false);
  const [statementDialogOpen, setStatementDialogOpen] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);
  const [pendingStatements, setPendingStatements] =
    useState<Statement[]>(pending);
  const [processingStatement, setProcessingStatement] = useState(false);
  const pollErrorNotified = useRef(false);
  const { showToast } = useToast();

  const activeTab = (searchParams.get("tab") || "transactions") as TabValue;

  /* const summaryStats = useMemo(() => {
    const income = transactions
      .filter((t) => t.type === "income")
      .reduce((sum, t) => sum + Number(t.amount), 0);
    const expense = transactions
      .filter((t) => t.type === "expense")
      .reduce((sum, t) => sum + Number(t.amount), 0);
    return { income, expense };
  }, [transactions]); */

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(name, value);
      return params.toString();
    },
    [searchParams]
  );

  const fetchPendingStatements = useCallback(async () => {
    try {
      const response = await fetch("/api/pending-statements");
      if (!response.ok) throw new Error("Failed to pending statements");
      const data = await response.json();
      if (processingStatement && data.length == 0) {
        showToast({
          title: "Estado de cuenta procesado con éxito",
          message: "",
          variant: "success",
        });
        setProcessingStatement(false);
        router.refresh();
      }
      setPendingStatements(data);
      pollErrorNotified.current = false;
    } catch (error) {
      console.error("Error fetching pending statements:", error);
      if (processingStatement && !pollErrorNotified.current) {
        pollErrorNotified.current = true;
        showToast({
          title: "No se pudo verificar el estado de cuenta",
          message: "Seguiremos intentando en unos segundos.",
          variant: "warning",
        });
      }
    }
  }, [processingStatement, router, showToast]);

  useEffect(() => {
    // Keep polling while a statement is queued *or* while an upload we just
    // triggered hasn't shown up yet — otherwise a freshly uploaded statement
    // never refreshes the page on its own.
    if (pendingStatements.length === 0 && !processingStatement) return;
    const intervalId = setInterval(() => {
      fetchPendingStatements();
    }, 3000);
    return () => clearInterval(intervalId);
  }, [pendingStatements.length, processingStatement, fetchPendingStatements]);

  useEffect(() => {
    fetch("api/create-user");
  }, []);

  const handleAddTransaction = () => {
    setNewTransactionDialogOpen(false);
  };

  const groupTransactionsByDay = (transactions: Transaction[]) => {
    return transactions.reduce((groups, transaction) => {
      const date = new Date(transaction.date);
      // Dates are stored as the wall-clock date the user (or the statement
      // parser) entered, anchored to UTC. Formatting in the browser's timezone
      // would push anything before 06:00 into the previous day.
      let dayKey = date.toLocaleDateString("es-MX", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      });
      dayKey = dayKey.charAt(0).toUpperCase() + dayKey.slice(1);
      if (!groups[dayKey]) groups[dayKey] = [];
      groups[dayKey].push(transaction);
      return groups;
    }, {} as Record<string, Transaction[]>);
  };

  const closeAccountDialog = useCallback(() => {
    setAccountDialogOpen(false);
  }, []);

  return (
    <div className="flex justify-center container mx-auto px-8 pt-4 pb-28 min-h-screen">
      <main className="flex flex-col w-full max-w-[680px]">
        <div className="grow">
          {/* Glass tab bar */}
          <div className="mb-4">
            <GlassSegmented
              value={activeTab}
              onChange={(v) => router.push(`?${createQueryString("tab", v)}`)}
              options={TAB_OPTIONS}
            />
          </div>

          {/* Tabs content — Radix used only for accessible panel semantics */}
          <Tabs.Root value={activeTab}>
            <Tabs.Content value="goals">
              <GoalsList goals={goals} />
            </Tabs.Content>

            <Tabs.Content value="accounts">
              <div className="flex mb-8 gap-3 items-center justify-between">
                <h1 className="text-2xl font-bold text-ink">Cuentas</h1>
                <AddButton onClick={() => setAccountDialogOpen(true)} />
              </div>
              {accounts.length === 0 ? (
                <EmptyState
                  icon={<Wallet size={24} />}
                  title="No hay cuentas"
                  description="Agrega tu primera cuenta para registrar transacciones y saldos."
                  action={
                    <GlassButton
                      onClick={() => setAccountDialogOpen(true)}
                      className="flex items-center gap-2"
                    >
                      <Plus size={16} />
                      Crear cuenta
                    </GlassButton>
                  }
                />
              ) : (
                <AccountsList
                  accounts={accounts}
                  onAccountUpdated={closeAccountDialog}
                />
              )}
            </Tabs.Content>

            <Tabs.Content value="transactions">
              <div className="flex gap-3 items-center justify-between mb-2">
                <h1 className="text-2xl font-bold text-ink">Transacciones</h1>
                <div className="flex items-center gap-2">
                  <button
                    className="text-ink-subtle hover:text-ink-muted hover:bg-surface rounded-lg p-2 transition-all cursor-pointer"
                    onClick={() => setStatementDialogOpen(true)}
                  >
                    <Upload className="w-5 h-5" />
                  </button>
                  <AddButton
                    onClick={() => setNewTransactionDialogOpen(true)}
                  />
                </div>
              </div>

              {pendingStatements.length > 0 && (
                <div className="flex items-center gap-3 w-full bg-accent-soft border border-accent-border rounded-xl px-4 py-3 mb-3">
                  <Loader2 className="w-4 h-4 text-accent opacity-70 animate-spin shrink-0" />
                  <span className="text-sm text-accent font-medium flex-1">
                    Procesando estado de cuenta
                  </span>
                </div>
              )}

              {unverifiedTransactions.length > 0 && (
                <Link
                  href="/data/review"
                  className="flex items-center gap-3 w-full bg-accent-soft border border-accent-border
                   rounded-xl px-4 py-3 mb-3 hover:bg-accent/10 transition-colors group"
                >
                  <AlertCircle className="w-4 h-4 text-cyan-200 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-cyan-200 font-medium">
                      {unverifiedTransactions.length}{" "}
                      {unverifiedTransactions.length !== 1
                        ? "transacciones"
                        : "transacción"}{" "}
                      sin clasificar
                    </p>
                    <p className="text-xs text-cyan-200/60 mt-0.5">
                      Importadas desde estado de cuenta — requieren revisión
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-cyan-200/60 group-hover:text-cyan-200 group-hover:translate-x-0.5 transition-all shrink-0" />
                </Link>
              )}

              <TransactionFilters
                categories={categories}
                accounts={accounts}
                activeFilters={activeFilters}
              />

              <div className="grid gap-4 mx-auto">
                {transactions.length === 0 ? (
                  hasAnyFilter(activeFilters) ? (
                    <EmptyState
                      icon={<SearchX size={24} />}
                      title="Sin resultados"
                      description="No se encontraron transacciones con los filtros seleccionados."
                      className="mt-3"
                      action={
                        <GlassButton
                          variant="secondary"
                          onClick={() => {
                            const params = new URLSearchParams();
                            const tab = searchParams.get("tab");
                            if (tab) params.set("tab", tab);
                            router.push(`?${params.toString()}`);
                          }}
                        >
                          Limpiar filtros
                        </GlassButton>
                      }
                    />
                  ) : (
                    <EmptyState
                      icon={<ReceiptText size={24} />}
                      title="Aún no hay transacciones"
                      description="Registra tu primera transacción o sube un estado de cuenta."
                      className="mt-3"
                      action={
                        <GlassButton
                          onClick={() => setNewTransactionDialogOpen(true)}
                          className="flex items-center gap-2"
                        >
                          <Plus size={16} />
                          Nueva transacción
                        </GlassButton>
                      }
                    />
                  )
                ) : (
                  Object.entries(groupTransactionsByDay(transactions)).map(
                    ([day, dayTransactions]) => (
                      <div key={day}>
                        <div className="flex items-center gap-3 mb-2 mt-4 first:mt-1">
                          <span className="text-[10px] text-ink-faint uppercase tracking-widest font-semibold shrink-0">
                            {day}
                          </span>
                          <div className="flex-1 h-px bg-edge-soft" />
                          {/* <span className="text-[10px] text-ink-faint/70 bg-surface-strong border border-edge-soft px-1.5 py-0.5 rounded-full shrink-0 tabular-nums">
                            {dayTransactions.length}
                          </span> */}
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
                                amount={transaction.amount}
                                categoryName={transaction.categoryName}
                                type={transaction.type}
                                sourceAccountName={
                                  transaction.sourceAccountName
                                }
                                targetAccountName={
                                  transaction.targetAccountName
                                }
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  )
                )}
              </div>

              {/* Pagination */}
              {totalCount > 0 && (
                <div className="mt-6 pb-6 space-y-3">
                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-3">
                      {currentPage > 1 && (
                        <GlassButton
                          variant="secondary"
                          className="px-4 py-1.5 text-xs"
                          onClick={() => {
                            const params = new URLSearchParams(
                              searchParams.toString()
                            );
                            params.set("page", String(currentPage - 1));
                            router.push(`?${params.toString()}`);
                          }}
                        >
                          ← Anterior
                        </GlassButton>
                      )}
                      <span className="text-sm text-ink-faint tabular-nums min-w-[52px] text-center">
                        {currentPage}{" "}
                        <span className="text-ink-faint/40">/</span>{" "}
                        {totalPages}
                      </span>
                      {currentPage < totalPages && (
                        <GlassButton
                          variant="secondary"
                          className="px-4 py-1.5 text-xs"
                          onClick={() => {
                            const params = new URLSearchParams(
                              searchParams.toString()
                            );
                            params.set("page", String(currentPage + 1));
                            router.push(`?${params.toString()}`);
                          }}
                        >
                          Siguiente →
                        </GlassButton>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-ink-faint/60 text-center">
                    {transactions.length} de {totalCount} transacciones
                  </p>
                </div>
              )}
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </main>

      <NewTransactionDialog
        open={dialogOpen}
        onOpenChange={setNewTransactionDialogOpen}
        onAddTransaction={handleAddTransaction}
      />

      <NewAccountDialog
        open={accountDialogOpen}
        onOpenChange={setAccountDialogOpen}
        onAccountAdded={closeAccountDialog}
      />

      <UploadStatementDialog
        open={statementDialogOpen}
        onOpenChange={setStatementDialogOpen}
        onStatementUpload={() => {
          setProcessingStatement(true);
          fetchPendingStatements();
        }}
      />

      {selectedTransaction && (
        <TransactionDialog
          open={transactionDialogOpen}
          onOpenChange={setTransactionDialogOpen}
          transaction={selectedTransaction}
          onUpdate={() => setTransactionDialogOpen(false)}
          onDelete={() => setTransactionDialogOpen(false)}
        />
      )}
    </div>
  );
}
