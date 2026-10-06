import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "ghost" | "link";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  render?: React.ReactElement;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-teal-600 text-white shadow-sm shadow-teal-600/20",
  secondary: "bg-gray-100 text-gray-700",
  destructive: "bg-red-100 text-red-700 ring-1 ring-red-200",
  outline: "border border-gray-200 text-gray-700 bg-white",
  ghost: "hover:bg-gray-100 hover:text-gray-700",
  link: "text-teal-600 underline-offset-4 hover:underline",
};

function Badge({ className, variant = "default", render, ...props }: BadgeProps) {
  // If render prop provided, wrap it
  if (render) {
    return (
      <span
        className={cn(
          "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors",
          variantClasses[variant],
          className
        )}
        {...props}
      >
        {render}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge };
