"use client";

import { UserButton } from "@clerk/nextjs";
import { Home, CircleDollarSign, AppWindow, Repeat, Send } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export const navLinks = [
  { href: "/home", label: "Inicio", icon: Home },
  { href: "/data", label: "Datos", icon: CircleDollarSign },
  { href: "/recurring", label: "Recurrentes", icon: Repeat },
  { href: "/categories", label: "Categorías", icon: AppWindow },
  { href: "/telegram", label: "Telegram", icon: Send },
  /*  { href: "/analysis", label: "Análisis", icon: BarChart3 }, */
];

export const Sidebar = () => {
  const [selectedPage, setSelectedPage] = useState<string>();
  const pathname = usePathname();
  const page = pathname.split("/")[1];

  useEffect(() => {
    setSelectedPage(page);
  }, [page]);

  return (
    <aside className="fixed top-0 left-0 flex flex-col bg-app-secondary border-r border-edge-soft h-screen w-80 font-(family-name:--font-outfit)">
      {/* Logo */}
      <div className="px-6 py-7 border-b border-edge-soft">
        <span className="text-2xl font-semibold text-ink tracking-tight">
          finansia
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navLinks.map(({ href, label, icon: Icon }) => {
          const isActive = href.slice(1) === selectedPage;
          return (
            <Link
              key={href}
              href={href}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200
                ${
                  isActive
                    ? "bg-surface-strong text-ink"
                    : "text-ink-subtle hover:text-ink-muted hover:bg-surface"
                }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="text-sm font-medium">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-edge-soft">
        <UserButton />
      </div>
    </aside>
  );
};
