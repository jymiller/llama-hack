import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Status =
  | "PASS"
  | "FAIL"
  | "WARN"
  | "APPROVED"
  | "REJECTED"
  | "CORRECTED"
  | "PENDING"
  | "MATCH"
  | "VARIANCE"
  | "MISSING_INVOICE"
  | "MISSING_TIMESHEET"
  | string;

const STATUS_STYLES: Record<string, string> = {
  PASS: "bg-green-100 text-green-800 border-green-200",
  FAIL: "bg-red-100 text-red-800 border-red-200",
  WARN: "bg-yellow-100 text-yellow-800 border-yellow-200",
  APPROVED: "bg-green-100 text-green-800 border-green-200",
  REJECTED: "bg-red-100 text-red-800 border-red-200",
  CORRECTED: "bg-blue-100 text-blue-800 border-blue-200",
  PENDING: "bg-gray-100 text-gray-600 border-gray-200",
  MATCH: "bg-green-100 text-green-800 border-green-200",
  VARIANCE: "bg-orange-100 text-orange-800 border-orange-200",
  MISSING_INVOICE: "bg-red-100 text-red-800 border-red-200",
  MISSING_TIMESHEET: "bg-red-100 text-red-800 border-red-200",
};

interface StatusBadgeProps {
  status: Status | null | undefined;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  if (!status) {
    return (
      <Badge
        variant="outline"
        className={cn("bg-gray-100 text-gray-500 border-gray-200", className)}
      >
        —
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        STATUS_STYLES[status] ?? "bg-gray-100 text-gray-600 border-gray-200",
        className
      )}
    >
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
