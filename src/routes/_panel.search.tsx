import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { KeyRound, Plus, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDatabaseSize } from "@/features/databases/databases";
import {
  getSearch,
  revokeSearchKeyFn,
  type SearchEngineStatus,
  type SearchKeyWithState,
} from "@/features/search/api";
import { IssuedKeyDialog, NewSearchKeyDialog } from "@/features/search/components/search-dialogs";
import { SEARCH_ACCESS, SEARCH_ENGINES, type IssuedSearchKey } from "@/features/search/search";

export const Route = createFileRoute("/_panel/search")({
  loader: () => getSearch(),
  component: SearchPage,
});

type Open =
  | { kind: "new" }
  | { kind: "issued"; issued: IssuedSearchKey }
  | { kind: "revoke"; key: SearchKeyWithState }
  | null;

function engineState(e: SearchEngineStatus): { label: string; variant: "ok" | "warn" | "outline" } {
  if (!e.enabled) return { label: e.installed ? "stopped" : "off", variant: "outline" };
  if (e.running && e.healthy) return { label: "running", variant: "ok" };
  if (!e.installed) return { label: "installing", variant: "warn" };
  return { label: e.running ? "starting" : "stopped", variant: "warn" };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-sm">{value || "-"}</p>
    </div>
  );
}

function EngineCard({ e, live }: { e: SearchEngineStatus; live: boolean }) {
  const info = SEARCH_ENGINES[e.engine];
  const state = engineState(e);
  const upgrade = e.version && e.version !== e.pinnedVersion;
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium">{info.label}</p>
          <Badge variant={state.variant}>{state.label}</Badge>
        </div>
        {e.enabled ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label="Listen" value={`127.0.0.1:${info.port}`} />
              <Stat label="Version" value={live ? e.version : e.pinnedVersion} />
              <Stat
                label={info.indexWord[0].toUpperCase() + info.indexWord.slice(1)}
                value={e.indexes === null ? "" : String(e.indexes)}
              />
              <Stat label="Memory" value={formatDatabaseSize(e.memoryBytes)} />
              <Stat label="Disk" value={formatDatabaseSize(e.diskBytes)} />
              <Stat
                label="Boot"
                value={live ? (e.enabledAtBoot ? "enabled" : "disabled") : "enabled"}
              />
            </div>
            {upgrade ? (
              <p className="mt-4 text-xs text-muted-foreground">
                {e.pinnedVersion} is pinned; the next apply upgrades it and keeps a copy of the data
                first.
              </p>
            ) : null}
            {live && e.enabled && !e.healthy ? (
              <p className="mt-4 text-xs text-warn">
                {e.error ||
                  `Not answering on 127.0.0.1:${info.port}. Apply again, or run schela doctor on the server.`}
              </p>
            ) : null}
            {e.engine === "typesense" ? (
              <p className="mt-4 text-xs text-muted-foreground">
                Typesense keeps every collection in RAM: plan for 2 to 3 times the size of the
                indexed fields.
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Off. Turn it on in{" "}
            <Link to="/modules" className="underline-offset-4 hover:underline">
              Modules
            </Link>{" "}
            to install {info.label} {e.pinnedVersion}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Owner({ k }: { k: SearchKeyWithState }) {
  if (k.siteId && k.siteDomain) {
    return (
      <Link
        to="/sites/$id"
        params={{ id: String(k.siteId) }}
        className="underline-offset-4 hover:underline"
      >
        {k.siteDomain}
      </Link>
    );
  }
  return <span>{k.appName ?? "Node app"}</span>;
}

function SearchPage() {
  const overview = Route.useLoaderData();
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const anyEnabled = overview.engines.some((e) => e.enabled);

  return (
    <div>
      <PageHeader
        kicker="Hosting"
        title="Search"
        description="Meilisearch and Typesense on this server, reachable from 127.0.0.1 only. Each key reaches only its site's or app's own indexes and is shown once."
        action={
          anyEnabled ? (
            <Button onClick={() => setOpen({ kind: "new" })}>
              <Plus />
              New key
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 lg:grid-cols-2">
        {overview.engines.map((e) => (
          <EngineCard key={e.engine} e={e} live={overview.live} />
        ))}
      </div>

      <h2 className="mt-8 mb-3 text-sm font-medium">Keys</h2>
      {overview.keys.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl bg-card py-12 text-center shadow-[var(--shadow-border)]">
          {anyEnabled ? (
            <KeyRound className="size-6 text-muted-foreground" />
          ) : (
            <Search className="size-6 text-muted-foreground" />
          )}
          <p className="mt-3 text-sm text-muted-foreground">
            {anyEnabled
              ? "No keys yet."
              : "Turn on Meilisearch or Typesense in Modules to create keys."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-card shadow-[var(--shadow-border)]">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
              <tr className="border-b border-border">
                {["Key", "Engine", "Access", "Belongs to", "Index prefix", ""].map((h, i) => (
                  <th key={`${h}-${i}`} className="px-5 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {overview.keys.map((k) => (
                <tr key={k.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 font-mono text-xs font-medium">
                    {k.keyHint}...
                    {k.onServer === false ? (
                      <Badge variant="warn" className="ml-2">
                        missing on server
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {SEARCH_ENGINES[k.engine].label}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {SEARCH_ACCESS[k.access].label}
                  </td>
                  <td className="px-5 py-3">
                    <Owner k={k} />
                  </td>
                  <td className="px-5 py-3 font-mono text-xs">{k.prefix}</td>
                  <td className="px-5 py-3 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setOpen({ kind: "revoke", key: k })}
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open?.kind === "new" ? (
        <NewSearchKeyDialog
          overview={overview}
          onClose={() => setOpen(null)}
          onCreated={(issued) => {
            void router.invalidate({ sync: true }).then(() => setOpen({ kind: "issued", issued }));
          }}
        />
      ) : null}
      {open?.kind === "issued" ? (
        <IssuedKeyDialog issued={open.issued} onClose={() => setOpen(null)} />
      ) : null}
      {open?.kind === "revoke" ? (
        <ConfirmDeleteDialog
          title={`Revoke key ${open.key.keyHint}...?`}
          description={`Anything using this ${SEARCH_ENGINES[open.key.engine].label} key stops working at once. The indexes and their data stay.`}
          confirmLabel="Revoke key"
          onConfirm={async () => {
            await revokeSearchKeyFn({ data: { id: open.key.id } });
            await router.invalidate({ sync: true });
            setOpen(null);
            toast.success("Key revoked");
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
