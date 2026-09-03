import { cn } from "@/lib/utils";

export function SchelaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("text-foreground", className)}
      aria-hidden="true"
    >
      <path
        d="M6 8h20L16 26 6 8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path d="M11 12h10L16 21 11 12z" fill="currentColor" opacity="0.9" />
    </svg>
  );
}
