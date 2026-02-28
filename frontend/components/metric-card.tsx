import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: string | number;
  description?: string;
  delta?: string;
  deltaPositive?: boolean;
  className?: string;
}

export function MetricCard({
  title,
  value,
  description,
  delta,
  deltaPositive,
  className,
}: MetricCardProps) {
  return (
    <Card className={cn("", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {(description || delta) && (
          <div className="flex items-center gap-2 mt-1">
            {delta && (
              <span
                className={cn(
                  "text-xs font-medium",
                  deltaPositive ? "text-green-600" : "text-red-600"
                )}
              >
                {delta}
              </span>
            )}
            {description && (
              <span className="text-xs text-muted-foreground">{description}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
