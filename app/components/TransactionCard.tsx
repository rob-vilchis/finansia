"use client";

import { Transaction } from "@/app/(main)/data/DataDashboard";

export default function TransactionCard({
  description,
  date,
  amount,
  showCategory = true,
  showDate = false,
  categoryName,
  type,
}: Omit<Transaction, "id" | "sourceAccountId"> & {
  showCategory?: boolean;
  showDate?: boolean;
}) {
  let amountColor = "text-transfer";
  if (type === "income") amountColor = "text-income";
  else if (type === "expense") amountColor = "text-expense";

  const formattedDate =
    showDate && date
      ? new Date(date).toLocaleDateString("es-MX", {
          day: "numeric",
          month: "short",
          // Dates are stored as UTC-anchored wall clock — see DataDashboard.
          timeZone: "UTC",
        })
      : null;

  return (
    <div
      className="w-full flex justify-between items-center gap-3 py-3 px-4
        bg-surface backdrop-blur-md rounded-xl border border-edge-soft
        cursor-pointer hover:bg-surface-hover hover:border-edge
        transition-all duration-200 shadow-lg shadow-black/10"
    >
      <div className="flex flex-col sm:flex-row w-full sm:items-center justify-between items-start gap-1 min-w-0">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-ink/90 line-clamp-1">
            {description}
          </h3>
          {formattedDate && (
            <span className="text-xs text-ink-faint">{formattedDate}</span>
          )}
        </div>
        {type !== "transfer" && showCategory && categoryName && (
          <span className="text-xs text-ink-faint shrink-0">{categoryName}</span>
        )}
      </div>
      <span className={`text-base font-semibold shrink-0 font-mono tabular-nums ${amountColor}`}>
        {type === "expense" ? "-" : ""}${Number(amount).toFixed(2)}
      </span>
    </div>
  );
}
