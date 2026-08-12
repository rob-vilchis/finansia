"use client";

import { Search, X, Calendar, SlidersHorizontal, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { GlassSelect } from "@/app/components/ui/glass";

interface Category {
  id: string;
  name: string;
  type: string;
}

interface Account {
  id: string;
  name: string;
}

export interface ActiveFilters {
  type?: string;
  category?: string;
  account?: string;
  startDate?: string;
  endDate?: string;
  q?: string;
  sort?: string;
}

const TYPE_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "expense", label: "Gastos" },
  { value: "income", label: "Ingresos" },
  { value: "transfer", label: "Transferencias" },
];

const SEARCH_DEBOUNCE_MS = 350;

export function hasAnyFilter(filters: ActiveFilters) {
  return Boolean(
    filters.type ||
      filters.category ||
      filters.account ||
      filters.startDate ||
      filters.endDate ||
      filters.q
  );
}

export default function TransactionFilters({
  categories,
  accounts,
  activeFilters,
}: {
  categories: Category[];
  accounts: Account[];
  activeFilters: ActiveFilters;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const appliedSearch = activeFilters.q || "";
  const [searchInput, setSearchInput] = useState(appliedSearch);
  // Last search term this component sent to the URL. Used to tell our own
  // navigations apart from external ones (back/forward, "Limpiar filtros"),
  // so an in-flight debounce never overwrites what the user is typing.
  const lastAppliedSearch = useRef(appliedSearch);

  const [showFilters, setShowFilters] = useState(
    !!(
      activeFilters.category ||
      activeFilters.account ||
      activeFilters.startDate ||
      activeFilters.endDate
    )
  );

  const updateFilter = useCallback(
    (key: string, value: string | null, options?: { replace?: boolean }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === null || value === "" || value === "all") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      params.delete("page");
      const url = `?${params.toString()}`;
      startTransition(() => {
        if (options?.replace) router.replace(url);
        else router.push(url);
      });
    },
    [searchParams, router]
  );

  const applySearch = useCallback(
    (value: string) => {
      lastAppliedSearch.current = value;
      // Replace rather than push: typing shouldn't fill up the history stack.
      updateFilter("q", value, { replace: true });
    },
    [updateFilter]
  );

  // Adopt search terms that changed outside this input.
  useEffect(() => {
    if (appliedSearch !== lastAppliedSearch.current) {
      lastAppliedSearch.current = appliedSearch;
      setSearchInput(appliedSearch);
    }
  }, [appliedSearch]);

  // Debounced search — results update as the user types.
  useEffect(() => {
    const next = searchInput.trim();
    if (next === appliedSearch) return;
    const timeout = setTimeout(() => applySearch(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchInput, appliedSearch, applySearch]);

  const clearAllFilters = useCallback(() => {
    const params = new URLSearchParams();
    const tab = searchParams.get("tab");
    if (tab) params.set("tab", tab);
    lastAppliedSearch.current = "";
    setSearchInput("");
    startTransition(() => router.push(`?${params.toString()}`));
  }, [searchParams, router]);

  const hasActiveFilters = hasAnyFilter(activeFilters);

  // Filters that live in the collapsible panel, badged on the toggle so they
  // aren't invisible while the panel is closed.
  const advancedFilterCount = [
    activeFilters.category,
    activeFilters.account,
    activeFilters.startDate,
    activeFilters.endDate,
  ].filter(Boolean).length;

  const filteredCategories = activeFilters.type
    ? categories.filter((cat) => cat.type === activeFilters.type)
    : categories;

  return (
    <div className="mb-4 space-y-2">
      {/* Row 1 — Type filter pills */}
      <div className="flex gap-1 bg-surface backdrop-blur-md border border-edge rounded-xl p-1">
        {TYPE_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => {
              // Categories are type-scoped, so a category filter can't survive
              // a switch to a different type.
              if (value !== "all" && activeFilters.category) {
                const params = new URLSearchParams(searchParams.toString());
                params.delete("category");
                params.delete("page");
                params.set("type", value);
                startTransition(() => router.push(`?${params.toString()}`));
              } else {
                updateFilter("type", value);
              }
            }}
            className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer ${
              (activeFilters.type || "all") === value
                ? "bg-surface-strong text-ink shadow-inner shadow-black/20"
                : "text-ink-faint hover:text-ink-muted hover:bg-surface"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Row 2 — Search + sort + controls */}
      <div className="flex items-center gap-2">
        {/* Free-text search — always visible */}
        <div className="relative flex-1 min-w-0">
          {isPending ? (
            <Loader2
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint animate-spin pointer-events-none"
            />
          ) : (
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
            />
          )}
          <input
            type="search"
            inputMode="search"
            aria-label="Buscar transacciones"
            placeholder="Buscar descripción, categoría o cuenta..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applySearch(searchInput.trim());
              } else if (e.key === "Escape" && searchInput) {
                e.preventDefault();
                setSearchInput("");
              }
            }}
            className="w-full h-9 bg-surface border border-edge rounded-lg pl-8 pr-8
              text-sm text-ink-muted placeholder:text-ink-faint
              focus:outline-none focus:border-accent-border hover:border-edge-strong transition-all
              [&::-webkit-search-cancel-button]:appearance-none"
          />
          {searchInput && (
            <button
              type="button"
              aria-label="Limpiar búsqueda"
              onClick={() => setSearchInput("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded
                text-ink-faint hover:text-ink-muted transition-colors cursor-pointer"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Sort */}
        <div className="w-36 shrink-0">
          <GlassSelect
            value={activeFilters.sort || "date_desc"}
            onChange={(e) => updateFilter("sort", e.target.value)}
          >
            <option value="date_desc">Más reciente</option>
            <option value="date_asc">Más antiguo</option>
            <option value="amount_desc">Mayor monto</option>
            <option value="amount_asc">Menor monto</option>
          </GlassSelect>
        </div>

        {/* Clear */}
        {hasActiveFilters && (
          <button
            onClick={clearAllFilters}
            title="Limpiar filtros"
            aria-label="Limpiar filtros"
            className="shrink-0 flex items-center gap-1 px-2.5 py-2 text-xs text-ink-faint hover:text-ink-muted transition-colors cursor-pointer"
          >
            <X size={13} />
          </button>
        )}

        {/* Filters toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          aria-expanded={showFilters}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border transition-all cursor-pointer ${
            showFilters
              ? "bg-surface-strong border-edge-strong text-ink-muted"
              : "bg-surface border-edge text-ink-subtle hover:bg-surface-strong hover:text-ink-muted"
          }`}
        >
          <SlidersHorizontal size={13} />
          Filtros
          {advancedFilterCount > 0 && (
            <span className="ml-0.5 min-w-4 px-1 rounded-full bg-accent-soft border border-accent-border text-accent text-[10px] leading-4 tabular-nums">
              {advancedFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Expandable panel — category, account, dates */}
      {showFilters && (
        <div className="space-y-2 p-3 bg-surface backdrop-blur-md border border-edge rounded-xl">
          {/* Category + Account */}
          <div className="grid grid-cols-2 gap-2">
            <GlassSelect
              value={activeFilters.category || "all"}
              onChange={(e) => updateFilter("category", e.target.value)}
            >
              <option value="all">Categoría</option>
              {filteredCategories.map((cat) => (
                <option key={cat.id} value={cat.name}>
                  {cat.name}
                </option>
              ))}
            </GlassSelect>

            <GlassSelect
              value={activeFilters.account || "all"}
              onChange={(e) => updateFilter("account", e.target.value)}
            >
              <option value="all">Cuenta</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.name}>
                  {account.name}
                </option>
              ))}
            </GlassSelect>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-2">
            {(["startDate", "endDate"] as const).map((field) => (
              <label key={field} className="space-y-1">
                <span className="text-[11px] text-ink-faint ml-1">
                  {field === "startDate" ? "Desde" : "Hasta"}
                </span>
                <div className="relative">
                  <Calendar size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none z-10" />
                  <input
                    type="date"
                    value={activeFilters[field] || ""}
                    max={
                      field === "startDate" ? activeFilters.endDate : undefined
                    }
                    min={
                      field === "endDate" ? activeFilters.startDate : undefined
                    }
                    onChange={(e) => updateFilter(field, e.target.value)}
                    className="w-full h-9 pl-8 pr-2 bg-surface border border-edge rounded-lg
                      text-sm text-ink-muted focus:outline-none focus:border-accent-border
                      hover:border-edge-strong transition-all scheme-dark"
                  />
                </div>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
