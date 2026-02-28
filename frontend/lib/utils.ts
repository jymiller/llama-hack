import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Return the Saturday of the week containing a given date (Sat–Fri work week). */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 6=Sat
  const diff = day === 6 ? 0 : -(day + 1); // roll back to Saturday
  d.setDate(d.getDate() + diff);
  return d;
}

/** Format a Date as YYYY-MM-DD */
export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Return the 7 dates of a Sat–Fri week containing the given date */
export function getWeekDates(date: Date): Date[] {
  const start = getWeekStart(date);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function formatPct(pct: number | null | undefined): string {
  if (pct == null) return "—";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}
