import Link from "next/link";
import { Home } from "lucide-react";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600 mb-1 transition-colors"
        >
          <Home className="h-3 w-3" />
          Home
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
