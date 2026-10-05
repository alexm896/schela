import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  Archive,
  Box,
  Clock,
  Database,
  DatabaseZap,
  FolderOpen,
  Globe,
  Inbox,
  LayoutDashboard,
  Mail,
  Menu,
  Network,
  Puzzle,
  Server,
  Settings,
  Shield,
} from "lucide-react";
import { useState } from "react";
import { SchelaMark } from "@/components/layout/schela-mark";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { UserButton } from "@/auth/gates";
import { cn } from "@/lib/utils";
import type { ModuleRow } from "@/features/modules/types";
import type { PanelSettings } from "@/features/settings/types";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Shown when any of these modules is on. */
  modules?: string[];
};

const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: "Hosting",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard },
      { to: "/sites", label: "Sites", icon: Globe, modules: ["php"] },
      { to: "/apps", label: "Node apps", icon: Box, modules: ["node"] },
      { to: "/files", label: "Files", icon: FolderOpen },
      { to: "/databases", label: "Databases", icon: Database, modules: ["mariadb", "postgresql"] },
      { to: "/mail", label: "Mail", icon: Mail, modules: ["mail"] },
      { to: "/webmail", label: "Webmail", icon: Inbox, modules: ["mail"] },
      { to: "/cron", label: "Cron jobs", icon: Clock },
      { to: "/redis", label: "Redis", icon: DatabaseZap, modules: ["redis"] },
    ],
  },
  {
    title: "Security",
    items: [
      { to: "/firewall", label: "Firewall", icon: Shield, modules: ["firewall"] },
      { to: "/dns", label: "DNS", icon: Server, modules: ["dns"] },
      { to: "/ips", label: "IP addresses", icon: Network },
      { to: "/backups", label: "Backups", icon: Archive },
    ],
  },
  {
    title: "Server",
    items: [
      { to: "/modules", label: "Modules", icon: Puzzle },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function NavList({
  pathname,
  enabled,
  onNavigate,
}: {
  pathname: string;
  enabled: Set<string>;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-5">
      {NAV.map((group) => {
        const items = group.items.filter(
          (item) => !item.modules || item.modules.some((m) => enabled.has(m)),
        );
        if (items.length === 0) return null;
        return (
          <div key={group.title} className="flex flex-col gap-0.5">
            <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {group.title}
            </p>
            {items.map((item) => {
              const active =
                item.to === "/"
                  ? pathname === "/"
                  : pathname === item.to || pathname.startsWith(`${item.to}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  className={cn(
                    "flex h-9 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors duration-150",
                    active
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-1">
      <SchelaMark className="size-7" />
      <span className="text-base font-semibold tracking-tight">Schela</span>
    </Link>
  );
}

function ServerChip({ hostname }: { hostname: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2.5">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full rounded-full bg-ok opacity-60 [animation:schela-pulse-dot_2.4s_ease-in-out_infinite]" />
        <span className="relative inline-flex size-2 rounded-full bg-ok" />
      </span>
      <div className="min-w-0">
        <p className="truncate font-mono text-xs text-foreground">{hostname}</p>
        <p className="text-[11px] text-muted-foreground">healthy</p>
      </div>
    </div>
  );
}

function SidebarBody({
  pathname,
  settings,
  enabled,
  onNavigate,
}: {
  pathname: string;
  settings: PanelSettings;
  enabled: Set<string>;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0">
        <Brand />
      </div>
      <div className="schela-sidebar-scroll mt-8 min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <NavList pathname={pathname} enabled={enabled} onNavigate={onNavigate} />
      </div>
      <div className="shrink-0 pt-4">
        <ServerChip hostname={settings.hostname} />
        <ThemeToggle className="mt-3" />
        <div className="mt-3 px-1">
          <UserButton />
        </div>
      </div>
    </div>
  );
}

export function Shell({
  settings,
  modules,
}: {
  settings: PanelSettings;
  modules: ModuleRow[];
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const enabled = new Set(modules.filter((m) => m.enabled).map((m) => m.slug));

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 hidden w-60 overflow-hidden border-r border-border bg-sidebar p-4 md:flex md:flex-col">
        <SidebarBody
          pathname={pathname}
          settings={settings}
          enabled={enabled}
        />
      </aside>
      <div className="md:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur-sm md:hidden">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </Button>
          <Brand />
        </header>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="left" className="w-72 bg-sidebar">
            <SidebarBody
              pathname={pathname}
              settings={settings}
              enabled={enabled}
              onNavigate={() => setOpen(false)}
            />
          </SheetContent>
        </Sheet>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
