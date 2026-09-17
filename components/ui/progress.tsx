import * as React from "react";
import { cn } from "@/lib/utils";

export function Progress({ value, color, thin = false, label }: { value: number; color: string; thin?: boolean; label: string }) {
  const clampedValue = Math.min(100, Math.max(0, value));
  return (
    <div
      className={cn("ui-progress", thin && "ui-progress-thin")}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clampedValue)}
    >
      <span style={{ width: `${clampedValue}%`, backgroundColor: color }} />
    </div>
  );
}
