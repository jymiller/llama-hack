"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  FileText,
  CheckSquare,
  BarChart2,
  ThumbsUp,
  DollarSign,
  BookMarked,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/ground-truth", label: "Ground Truth", icon: CheckSquare },
  { href: "/master-data", label: "Master Data", icon: BookMarked },
  { href: "/accuracy", label: "Accuracy", icon: BarChart2 },
  { href: "/approvals", label: "Approvals", icon: ThumbsUp },
  { href: "/reconciliation", label: "Reconciliation", icon: DollarSign },
];

export function Sidebar() {
  const pathname = usePathname();

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
      <div className="px-4 py-3 border-t border-gray-700 text-xs text-gray-500">
        RECONCILIATION.PUBLIC
      </div>
    </aside>
  );
}
