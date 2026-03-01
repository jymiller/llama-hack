"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  FileText,
  CheckSquare,
  DollarSign,
  BookMarked,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/ground-truth", label: "Ground Truth", icon: CheckSquare },
  { href: "/data-governance", label: "Data Governance", icon: BookMarked },
  { href: "/reconciliation", label: "Reconciliation", icon: DollarSign },
];

type HealthStatus = "ok" | "degraded" | "down" | "checking";

function useHealth(intervalMs = 30_000) {
  const [status, setStatus] = useState<HealthStatus>("checking");
  const [latency, setLatency] = useState<number | null>(null);

  async function check() {
    try {
      const r = await fetch("/api/health");
      const data = await r.json();
      setStatus(data.status as HealthStatus);
      setLatency(data.snowflake?.latency_ms ?? null);
    } catch {
      setStatus("down");
      setLatency(null);
    }
  }

  useEffect(() => {
    check();
    const id = setInterval(check, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return { status, latency };
}

const DOT_CLASSES: Record<HealthStatus, string> = {
  ok: "bg-green-400",
  degraded: "bg-yellow-400",
  down: "bg-red-500",
  checking: "bg-gray-500 animate-pulse",
};

const STATUS_LABELS: Record<HealthStatus, string> = {
  ok: "Connected",
  degraded: "Degraded",
  down: "Offline",
  checking: "Checking…",
};

export function Sidebar() {
  const pathname = usePathname();
  const { status, latency } = useHealth();

  return (
    <aside className="fixed inset-y-0 left-0 z-50 w-56 bg-gray-900 text-white flex flex-col">
      <div className="px-4 py-5 border-b border-gray-700">
        <h1 className="font-semibold text-sm uppercase tracking-widest text-gray-400">
          Timesheet
        </h1>
        <p className="text-white font-bold text-lg leading-tight">
          Reconciliation
        </p>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-blue-600 text-white"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-3 border-t border-gray-700">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full shrink-0", DOT_CLASSES[status])} />
          <span className="text-xs text-gray-400">
            {STATUS_LABELS[status]}
            {latency !== null && status === "ok" && (
              <span className="text-gray-600 ml-1">({latency}ms)</span>
            )}
          </span>
        </div>
        <p className="text-xs text-gray-600 mt-0.5">RECONCILIATION.PUBLIC</p>
      </div>
    </aside>
  );
}
