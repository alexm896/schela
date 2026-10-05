import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { listModules, toggleModule } from "@/features/modules/api";

export const Route = createFileRoute("/_panel/modules")({
  loader: () => listModules(),
  component: ModulesPage,
});

function ModulesPage() {
  const modules = Route.useLoaderData();
  const router = useRouter();
  // Module id -> the state the user asked for, while the change is applied.
  const [pending, setPending] = useState<Record<number, boolean>>({});

  async function toggle(id: number, slug: string, enabled: boolean) {
    setPending((prev) => ({ ...prev, [id]: enabled }));
    try {
      await toggleModule({ data: { id, enabled } });
      if (slug === "redis" && enabled) {
        toast.success("Redis will install and start. It also starts after reboot");
      }
      if (slug === "redis" && !enabled) {
        toast.message("Redis stopped. Package stays; it will not start on reboot");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      // The row is saved before schela-apply runs, so reload even when the
      // apply failed; otherwise the page keeps showing the old state. `sync`
      // waits for the loaders, so the switch does not flick back meanwhile.
      await router.invalidate({ sync: true });
      setPending((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  return (
    <div>
      <PageHeader
        kicker="Server"
        title="Modules"
        description="Enable only what this server needs. You can add more later without reinstalling."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {modules.map((mod) => (
          <Card key={mod.id}>
            <CardContent className="flex items-start justify-between gap-4 p-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-medium">{mod.name}</h2>
                  <Badge variant="outline">v{mod.version}</Badge>
                  {mod.core ? <Badge>core</Badge> : null}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{mod.description}</p>
              </div>
              <Switch
                checked={pending[mod.id] ?? mod.enabled}
                disabled={mod.id in pending}
                aria-label={`${mod.name} module`}
                onCheckedChange={(v) => void toggle(mod.id, mod.slug, v)}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
