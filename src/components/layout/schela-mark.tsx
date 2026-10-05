import { cn } from "@/lib/utils";

/** Scaffold bay: three poles, two platforms, one brace. */
export function SchelaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("text-foreground", className)}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 4v24M16 4v24M26 4v24"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="square"
      />
      <path
        d="M3.5 11h25M3.5 21h25"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="square"
      />
      <path
        d="M6 21 16 11"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="square"
      />
    </svg>
  );
}
