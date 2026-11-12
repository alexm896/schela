import { Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createSearchKey, type SearchOverview } from "@/features/search/api";
import {
  SEARCH_ACCESS,
  SEARCH_ACCESS_KEYS,
  SEARCH_ENGINES,
  scoutEnv,
  searchPrefix,
  type IssuedSearchKey,
  type SearchAccess,
  type SearchEngine,
  type SearchOwnerKind,
} from "@/features/search/search";

function copyText(text: string, label: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(`Copied ${label}`),
    () => toast.error("Could not copy"),
  );
}

/** "site:3" or "app:5" in the owner select. */
function parseOwner(value: string): { owner: SearchOwnerKind; ownerId: number } | null {
  const [kind, id] = value.split(":");
  const ownerId = Number(id);
  if ((kind !== "site" && kind !== "app") || !Number.isInteger(ownerId) || ownerId <= 0)
    return null;
  return { owner: kind, ownerId };
}

export function NewSearchKeyDialog({
  overview,
  onClose,
  onCreated,
}: {
  overview: SearchOverview;
  onClose: () => void;
  onCreated: (issued: IssuedSearchKey) => void;
}) {
  const engines = overview.engines.filter((e) => e.enabled).map((e) => e.engine);
  const [engine, setEngine] = useState<SearchEngine>(engines[0] ?? "meilisearch");
  const firstOwner = overview.sites[0]
    ? `site:${overview.sites[0].id}`
    : overview.apps[0]
      ? `app:${overview.apps[0].id}`
      : "";
  const [owner, setOwner] = useState(firstOwner);
  const [access, setAccess] = useState<SearchAccess>("admin");
  const [busy, setBusy] = useState(false);
  const parsed = parseOwner(owner);

  async function submit() {
    if (!parsed) return;
    setBusy(true);
    try {
      onCreated(await createSearchKey({ data: { engine, ...parsed, access } }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the key");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New search key</DialogTitle>
          <DialogDescription>
            The key reaches only the {SEARCH_ENGINES[engine].indexWord} whose name starts with the
            site's or app's prefix. It is shown once, right after you create it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="search-engine">Engine</Label>
              <Select value={engine} onValueChange={(v) => setEngine(v as SearchEngine)}>
                <SelectTrigger id="search-engine">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {engines.map((e) => (
                    <SelectItem key={e} value={e}>
                      {SEARCH_ENGINES[e].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="search-access">Access</Label>
              <Select value={access} onValueChange={(v) => setAccess(v as SearchAccess)}>
                <SelectTrigger id="search-access">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEARCH_ACCESS_KEYS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {SEARCH_ACCESS[a].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">{SEARCH_ACCESS[access].description}</p>
          <div className="grid gap-2">
            <Label htmlFor="search-owner">For</Label>
            <Select value={owner} onValueChange={setOwner}>
              <SelectTrigger id="search-owner">
                <SelectValue placeholder="Pick a site or app" />
              </SelectTrigger>
              <SelectContent>
                {overview.sites.map((site) => (
                  <SelectItem key={`site:${site.id}`} value={`site:${site.id}`}>
                    Site · {site.domain}
                  </SelectItem>
                ))}
                {overview.apps.map((app) => (
                  <SelectItem key={`app:${app.id}`} value={`app:${app.id}`}>
                    Node app · {app.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {parsed ? (
              <p className="text-xs text-muted-foreground">
                Index prefix{" "}
                <span className="font-mono text-foreground">
                  {searchPrefix(parsed.owner, parsed.ownerId)}
                </span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Create a site or Node app first.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !parsed || engines.length === 0}>
            Create key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-sm select-all">{value}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => copyText(value, label.toLowerCase())}
        aria-label={`Copy ${label}`}
      >
        <Copy />
      </Button>
    </div>
  );
}

/** The one time a key is visible. */
export function IssuedKeyDialog({
  issued,
  onClose,
}: {
  issued: IssuedSearchKey;
  onClose: () => void;
}) {
  const env = scoutEnv(issued);
  const url =
    issued.engine === "meilisearch"
      ? `http://${issued.host}:${issued.port}`
      : `${issued.host}:${issued.port}`;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {SEARCH_ENGINES[issued.engine].label} key for {issued.prefix}*
          </DialogTitle>
          <DialogDescription>
            Copy the key now. Schela does not keep it and cannot show it again; create a new key and
            revoke this one if it gets lost.
          </DialogDescription>
        </DialogHeader>
        <div className="divide-y divide-border rounded-lg shadow-[var(--shadow-border)]">
          <CopyRow label={issued.engine === "meilisearch" ? "URL" : "Host:port"} value={url} />
          <CopyRow label="Key" value={issued.key} />
          <CopyRow label="Index prefix" value={issued.prefix} />
        </div>
        <p className="text-xs text-muted-foreground">
          Every {SEARCH_ENGINES[issued.engine].indexOne} name must start with{" "}
          <span className="font-mono text-foreground">{issued.prefix}</span>; the key cannot reach
          any other.
        </p>
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label>Laravel Scout .env</Label>
            <Button variant="ghost" size="sm" onClick={() => copyText(env, ".env block")}>
              <Copy />
              Copy
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-lg bg-secondary p-3 font-mono text-xs leading-relaxed">
            {env}
          </pre>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>I saved it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
