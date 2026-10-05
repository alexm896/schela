import { formatDistanceToNow } from "date-fns";
import { File, FileCode, Folder, Image as ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatSize, type FileEntry } from "../files";
import type { FilePrompt } from "./file-prompt-dialog";
import { FileRowMenu } from "./file-row-menu";

function iconFor(entry: FileEntry) {
  if (entry.kind === "dir") return Folder;
  if (entry.preview === "image") return ImageIcon;
  if (entry.editable) return FileCode;
  return File;
}

export function FileTable({
  entries,
  path,
  selected,
  busy,
  filter,
  onUp,
  onRowClick,
  onOpen,
  onDownload,
  onPrompt,
}: {
  entries: FileEntry[];
  path: string;
  selected: Set<string>;
  busy: boolean;
  filter: string;
  onUp: () => void;
  onRowClick: (entry: FileEntry, event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
  onOpen: (entry: FileEntry) => void;
  onDownload: (entry: FileEntry) => void;
  onPrompt: (prompt: FilePrompt) => void;
}) {
  if (entries.length === 0) {
    return (
      <div className="px-5 py-16 text-center text-sm text-muted-foreground">
        {busy ? "Loading…" : filter ? "No names match." : "Empty folder. Drop files here or create one."}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead className="border-b border-border text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <tr>
            <th className="px-5 py-2.5 font-medium">Name</th>
            <th className="px-3 py-2.5 font-medium">Size</th>
            <th className="hidden px-3 py-2.5 font-medium sm:table-cell">Modified</th>
            <th className="hidden px-3 py-2.5 font-medium md:table-cell">Mode</th>
            <th className="w-12 px-3 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {path !== "/" ? (
            <tr>
              <td colSpan={5}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-5 py-2.5 text-left text-muted-foreground hover:bg-accent/40"
                  onClick={onUp}
                >
                  <Folder className="size-4" />
                  ..
                </button>
              </td>
            </tr>
          ) : null}
          {entries.map((entry) => {
            const Icon = iconFor(entry);
            const active = selected.has(entry.path);
            return (
              <tr
                key={entry.path}
                className={cn(
                  "cursor-default hover:bg-accent/40",
                  active && "bg-accent",
                  entry.hidden && "text-muted-foreground",
                )}
                onClick={(e) => onRowClick(entry, e)}
                onDoubleClick={() => onOpen(entry)}
              >
                <td className="px-5 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate font-medium">{entry.name}</span>
                    {entry.kind === "dir" ? <Badge variant="outline">dir</Badge> : null}
                    {entry.unsafe ? <Badge variant="warn">unsafe</Badge> : null}
                  </div>
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                  {entry.kind === "dir" ? "—" : formatSize(entry.size)}
                </td>
                <td className="hidden px-3 py-2.5 font-mono text-xs text-muted-foreground sm:table-cell">
                  {formatDistanceToNow(new Date(entry.mtime), { addSuffix: true })}
                </td>
                <td className="hidden px-3 py-2.5 font-mono text-xs text-muted-foreground md:table-cell">
                  {entry.mode}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <FileRowMenu
                    entry={entry}
                    onOpen={() => onOpen(entry)}
                    onDownload={() => onDownload(entry)}
                    onRename={() => onPrompt({ kind: "rename", value: entry.name, paths: [entry.path] })}
                    onCopy={() => onPrompt({ kind: "copy", value: `${entry.path}.copy`, paths: [entry.path] })}
                    onMove={() => onPrompt({ kind: "move", value: entry.path, paths: [entry.path] })}
                    onChmod={() => onPrompt({ kind: "chmod", value: entry.mode, paths: [entry.path] })}
                    onDelete={() => onPrompt({ kind: "delete", value: "", paths: [entry.path] })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
