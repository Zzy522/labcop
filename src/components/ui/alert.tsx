import * as React from "react";
import { cn } from "@/lib/utils";

type AlertVariant = "default" | "destructive";

interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
}

const variantClasses: Record<AlertVariant, string> = {
  default: "bg-white text-gray-900 border-gray-200",
  destructive: "bg-white text-red-700 border-red-200",
};

function Alert({ className, variant = "default", ...props }: AlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        "relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("font-medium", className)} {...props} />
  );
}

function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("text-sm text-gray-600", className)} {...props} />
  );
}

function AlertAction({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("absolute top-2 right-2", className)} {...props} />
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction };
