import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initialSelection, toggleOption, type RemovalPlan } from "@/lib/removal";

/**
 * Asks before deleting anything. With a plan it lists what goes along, lets
 * the admin tick what else should go, and asks for the name when the plan
 * wants it typed. Stays open and shows the error if the delete fails.
 */
export function ConfirmDeleteDialog<K extends string = never>({
  title,
  description,
  confirmLabel,
  confirmText,
  loadPlan,
  onConfirm,
  onClose,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** Text to type to confirm when there is no plan. */
  confirmText?: string;
  /** What goes with it, from the server. Without it, a click (or `confirmText`) confirms. */
  loadPlan?: () => Promise<RemovalPlan<K>>;
  onConfirm: (choice: { remove: K[]; confirm: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<RemovalPlan<K> | null>(
    loadPlan ? null : { confirm: confirmText ?? null, alsoRemoved: [], options: [], notes: [] },
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<K[]>([]);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loadPlan) return;
    let live = true;
    loadPlan().then(
      (loaded) => {
        if (!live) return;
        setPlan(loaded);
        setSelection(initialSelection(loaded));
      },
      (err: unknown) => live && setLoadError(err instanceof Error ? err.message : "Could not check what goes with it"),
    );
    return () => {
      live = false;
    };
    // The plan is loaded once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmed = plan !== null && (plan.confirm === null || typed.trim() === plan.confirm);

  async function submit() {
    setBusy(true);
    try {
      await onConfirm({ remove: selection, confirm: typed.trim() });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
        {!plan && !loadError ? (
          <p className="text-sm text-muted-foreground">Checking what goes with it…</p>
        ) : null}

        {plan?.alsoRemoved.length ? (
          <div className="grid gap-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Also removed
            </p>
            {plan.alsoRemoved.map((g) => (
              <div key={g.label} className="grid gap-1">
                <p className="text-sm font-medium">{g.label}</p>
                <ItemList items={g.items} />
              </div>
            ))}
          </div>
        ) : null}

        {plan?.options.length ? (
          <div className="grid gap-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Remove as well
            </p>
            {plan.options.map((o) => (
              <div key={o.key} className="flex items-start gap-3">
                <Checkbox
                  id={`remove-${o.key}`}
                  className="mt-0.5"
                  checked={selection.includes(o.key)}
                  onCheckedChange={(on) => setSelection((s) => toggleOption(s, o.key, on === true))}
                  disabled={busy}
                />
                <div className="grid gap-1">
                  <Label htmlFor={`remove-${o.key}`}>{o.label}</Label>
                  <ItemList items={o.items} />
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {plan?.notes.map((note) => (
          <p key={note} className="text-xs text-muted-foreground">
            {note}
          </p>
        ))}

        {plan?.confirm ? (
          <div className="grid gap-2">
            <Label htmlFor="confirm-delete">
              Type <span className="font-mono text-foreground">{plan.confirm}</span> to confirm
            </Label>
            <Input
              id="confirm-delete"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="font-mono text-sm"
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
            />
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy || !confirmed} onClick={() => void submit()}>
            {busy ? "Deleting…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ItemList({ items }: { items: string[] }) {
  return (
    <ul className="max-h-32 overflow-y-auto font-mono text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item} className="truncate">
          {item}
        </li>
      ))}
    </ul>
  );
}
