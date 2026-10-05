import { toast } from "sonner";

/** Toasts a finished delete, then anything it could not remove. */
export function notifyRemoved(message: string, warnings: readonly string[] = []) {
  toast.success(message);
  for (const warning of warnings) toast.warning(warning, { duration: 15_000 });
}
