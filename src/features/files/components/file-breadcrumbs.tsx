import { ChevronRight } from "lucide-react";
import { virtSegments } from "../files";

export function FileBreadcrumbs({ path, onNavigate }: { path: string; onNavigate: (path: string) => void }) {
  const crumbs = virtSegments(path);
  return (
    <nav className="flex min-w-0 flex-wrap items-center gap-0.5 font-mono text-xs">
      <button
        type="button"
        className="rounded-sm px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={() => onNavigate("/")}
      >
        /
      </button>
      {crumbs.map((seg, i) => {
        const next = `/${crumbs.slice(0, i + 1).join("/")}`;
        return (
          <span key={next} className="flex items-center">
            <ChevronRight className="size-3 text-muted-foreground/70" />
            <button
              type="button"
              className="rounded-sm px-1.5 py-1 hover:bg-accent"
              onClick={() => onNavigate(next)}
            >
              {seg}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
