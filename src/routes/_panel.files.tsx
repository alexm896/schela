import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import {
  ChevronRight,
  Copy,
  Download,
  File,
  FileCode,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatSize, virtParent, virtSegments, type FileEntry, type FileListing } from "@/features/files/files";
import {
  chmodFile,
  copyFile,
  createDir,
  createFile,
  deleteFiles,
  listFileTargets,
  listFiles,
  moveFile,
  readFile,
  renameFile,
  uploadFile,
  writeFile,
} from "@/features/files/api";
import { cn } from "@/lib/utils";

type FilesSearch = {
  kind?: "site" | "app";
  id?: number;
  path?: string;
};

export const Route = createFileRoute("/_panel/files")({
  validateSearch: (raw: Record<string, unknown>): FilesSearch => {
    const idRaw = raw.id;
    const id =
      typeof idRaw === "number"
        ? idRaw
        : typeof idRaw === "string" && idRaw
          ? Number(idRaw)
          : undefined;
    return {
      kind: raw.kind === "app" ? "app" : raw.kind === "site" ? "site" : undefined,
      id: Number.isFinite(id) ? id : undefined,
      path: typeof raw.path === "string" ? raw.path : undefined,
    };
  },
  loader: () => listFileTargets(),
  component: FilesPage,
});

type PromptKind = "new-file" | "new-folder" | "rename" | "copy" | "move" | "chmod" | "delete";

function iconFor(entry: FileEntry) {
  if (entry.kind === "dir") return Folder;
  if (entry.preview === "image") return ImageIcon;
  if (entry.editable) return FileCode;
  return File;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function saveBlob(name: string, b64: string, mime: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function FilesPage() {
  const targets = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const target = useMemo(() => {
    if (targets.length === 0) return null;
    if (search.kind && search.id) {
      return targets.find((t) => t.kind === search.kind && t.id === search.id) ?? targets[0];
    }
    return targets[0];
  }, [targets, search.kind, search.id]);

  const path = search.path || "/";
  const [listing, setListing] = useState<FileListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClicked, setLastClicked] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [prompt, setPrompt] = useState<{ kind: PromptKind; value: string; paths: string[] } | null>(
    null,
  );
  const [editor, setEditor] = useState<{
    path: string;
    name: string;
    content: string;
    dirty: boolean;
  } | null>(null);
  const [preview, setPreview] = useState<{ name: string; src: string } | null>(null);

  const syncSearch = useCallback(
    (next: { kind: "site" | "app"; id: number; path: string }) => {
      void navigate({
        to: "/files",
        search: next,
        replace: true,
      });
    },
    [navigate],
  );

  const reload = useCallback(async () => {
    if (!target) return;
    setBusy(true);
    try {
      const next = await listFiles({
        data: { kind: target.kind, id: target.id, path },
      });
      setListing(next);
      setSelected(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not list files");
    } finally {
      setBusy(false);
    }
  }, [target, path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const visible = useMemo(() => {
    const entries = listing?.entries ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [listing, filter]);

  const selectedEntries = visible.filter((e) => selected.has(e.path));

  function go(nextPath: string) {
    if (!target) return;
    syncSearch({ kind: target.kind, id: target.id, path: nextPath });
  }

  function pickTarget(key: string) {
    const next = targets.find((t) => `${t.kind}:${t.id}` === key);
    if (!next) return;
    syncSearch({ kind: next.kind, id: next.id, path: "/" });
  }

  function onRowClick(entry: FileEntry, event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) {
    if (event.shiftKey && lastClicked && listing) {
      const names = visible.map((e) => e.path);
      const a = names.indexOf(lastClicked);
      const b = names.indexOf(entry.path);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected(new Set(names.slice(lo, hi + 1)));
        return;
      }
    }
    if (event.metaKey || event.ctrlKey) {
      const next = new Set(selected);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      setSelected(next);
      setLastClicked(entry.path);
      return;
    }
    setSelected(new Set([entry.path]));
    setLastClicked(entry.path);
  }

  async function openEntry(entry: FileEntry) {
    if (!target) return;
    if (entry.unsafe) {
      toast.error("This link points outside the account");
      return;
    }
    if (entry.kind === "dir") {
      go(entry.path);
      return;
    }
    if (entry.editable && entry.preview !== "image") {
      try {
        const file = await readFile({
          data: { kind: target.kind, id: target.id, path: entry.path },
        });
        setEditor({
          path: file.path,
          name: file.name,
          content: file.content,
          dirty: false,
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not open file");
      }
      return;
    }
    if (entry.preview === "image") {
      try {
        const file = await readFile({
          data: { kind: target.kind, id: target.id, path: entry.path, binary: true },
        });
        setPreview({
          name: file.name,
          src: `data:${file.mime};base64,${file.content}`,
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not preview");
      }
      return;
    }
    await downloadOne(entry);
  }

  async function downloadOne(entry: FileEntry) {
    if (!target || entry.kind === "dir") return;
    try {
      const file = await readFile({
        data: { kind: target.kind, id: target.id, path: entry.path, binary: true },
      });
      saveBlob(file.name, file.content, file.mime);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    }
  }

  async function uploadBuffers(files: FileList | File[]) {
    if (!target) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    setBusy(true);
    try {
      for (const file of list) {
        const buf = await file.arrayBuffer();
        if (buf.byteLength > 4 * 1024 * 1024) {
          toast.error(`${file.name} is over 4 MB`);
          continue;
        }
        await uploadFile({
          data: {
            kind: target.kind,
            id: target.id,
            path,
            name: file.name,
            content: toBase64(buf),
          },
        });
      }
      toast.success(list.length === 1 ? `Uploaded ${list[0].name}` : `Uploaded ${list.length} files`);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitPrompt() {
    if (!target || !prompt) return;
    const value = prompt.value.trim();
    setBusy(true);
    try {
      if (prompt.kind === "new-file") {
        await createFile({ data: { kind: target.kind, id: target.id, path, name: value } });
      } else if (prompt.kind === "new-folder") {
        await createDir({ data: { kind: target.kind, id: target.id, path, name: value } });
      } else if (prompt.kind === "rename" && prompt.paths[0]) {
        await renameFile({
          data: { kind: target.kind, id: target.id, path: prompt.paths[0], name: value },
        });
      } else if (prompt.kind === "copy" && prompt.paths[0]) {
        await copyFile({
          data: { kind: target.kind, id: target.id, path: prompt.paths[0], to: value },
        });
      } else if (prompt.kind === "move" && prompt.paths[0]) {
        await moveFile({
          data: { kind: target.kind, id: target.id, path: prompt.paths[0], to: value },
        });
      } else if (prompt.kind === "chmod" && prompt.paths[0]) {
        await chmodFile({
          data: { kind: target.kind, id: target.id, path: prompt.paths[0], mode: value },
        });
      } else if (prompt.kind === "delete") {
        await deleteFiles({
          data: { kind: target.kind, id: target.id, paths: prompt.paths },
        });
      }
      setPrompt(null);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not complete");
    } finally {
      setBusy(false);
    }
  }

  async function saveEditor() {
    if (!target || !editor) return;
    setBusy(true);
    try {
      await writeFile({
        data: {
          kind: target.kind,
          id: target.id,
          path: editor.path,
          content: editor.content,
          encoding: "utf8",
        },
      });
      setEditor({ ...editor, dirty: false });
      toast.success("Saved");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const el = event.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable]")) {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && editor) {
          event.preventDefault();
          void saveEditor();
        }
        return;
      }
      if (event.key === "Backspace" || (event.altKey && event.key === "ArrowUp")) {
        const parent = virtParent(path);
        if (parent) {
          event.preventDefault();
          go(parent);
        }
      }
      if (event.key === "Delete" && selected.size > 0) {
        event.preventDefault();
        setPrompt({
          kind: "delete",
          value: "",
          paths: [...selected],
        });
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelected(new Set(visible.map((e) => e.path)));
      }
      if (event.key === "Enter" && selectedEntries.length === 1) {
        event.preventDefault();
        void openEntry(selectedEntries[0]);
      }
      if (event.key === "F2" && selectedEntries.length === 1) {
        event.preventDefault();
        setPrompt({
          kind: "rename",
          value: selectedEntries[0].name,
          paths: [selectedEntries[0].path],
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, selected, selectedEntries, visible, editor, target]);

  const crumbs = virtSegments(path);
  const counts = listing
    ? {
        dirs: listing.entries.filter((e) => e.kind === "dir").length,
        files: listing.entries.filter((e) => e.kind !== "dir").length,
        bytes: listing.entries.reduce((n, e) => n + (e.kind === "dir" ? 0 : e.size), 0),
      }
    : null;

  if (targets.length === 0) {
    return (
      <div>
        <PageHeader
          kicker="Hosting"
          title="Files"
          description="Browse, edit, and upload inside each site or Node app home directory."
        />
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <FolderOpen className="size-6 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              Create a site or a Node app first. Files live in that account — never as root.
            </p>
            <div className="mt-4 flex gap-2">
              <Button asChild variant="outline">
                <Link to="/sites">Sites</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/apps">Node apps</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        kicker="Hosting"
        title="Files"
        description="Limited to the selected home directory. Hidden files stay visible — this is where .env and .htaccess live."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={target ? `${target.kind}:${target.id}` : ""}
              onValueChange={pickTarget}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Choose a site or app" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((t) => (
                  <SelectItem key={`${t.kind}:${t.id}`} value={`${t.kind}:${t.id}`}>
                    {t.kind === "site" ? "Site" : "App"} · {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon-sm" onClick={() => void reload()} aria-label="Refresh">
              <RefreshCw className={cn("size-4", busy && "animate-spin")} />
            </Button>
          </div>
        }
      />

      {target ? (
        <p className="mb-4 font-mono text-[11px] text-muted-foreground">
          {target.user} · {target.virtRoot}
          {path}
        </p>
      ) : null}

      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex min-w-0 flex-wrap items-center gap-0.5 font-mono text-xs">
          <button
            type="button"
            className="rounded-sm px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => go("/")}
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
                  onClick={() => go(next)}
                >
                  {seg}
                </button>
              </span>
            );
          })}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter"
              className="h-9 w-40 pl-8"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                New
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setPrompt({ kind: "new-file", value: "", paths: [] })}
              >
                <FilePlus className="size-4" />
                File
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setPrompt({ kind: "new-folder", value: "", paths: [] })}
              >
                <FolderPlus className="size-4" />
                Folder
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <Upload className="size-4" />
            Upload
          </Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void uploadBuffers(e.target.files);
              e.target.value = "";
            }}
          />
          {selectedEntries.length === 1 && selectedEntries[0].kind !== "dir" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void downloadOne(selectedEntries[0])}
            >
              <Download className="size-4" />
              Download
            </Button>
          ) : null}
          {selected.size > 0 ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() =>
                setPrompt({ kind: "delete", value: "", paths: [...selected] })
              }
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      <div
        ref={tableRef}
        tabIndex={0}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) void uploadBuffers(e.dataTransfer.files);
        }}
        className={cn(
          "overflow-hidden rounded-xl bg-card shadow-[var(--shadow-border)] outline-none",
          dragOver && "ring-2 ring-ring/40",
        )}
      >
        {visible.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-muted-foreground">
            {busy ? "Loading…" : filter ? "No names match." : "Empty folder. Drop files here or create one."}
          </div>
        ) : (
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
                        onClick={() => {
                          const parent = virtParent(path);
                          if (parent) go(parent);
                        }}
                      >
                        <Folder className="size-4" />
                        ..
                      </button>
                    </td>
                  </tr>
                ) : null}
                {visible.map((entry) => {
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
                      onDoubleClick={() => void openEntry(entry)}
                    >
                      <td className="px-5 py-2.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Icon className="size-4 shrink-0" />
                          <span className="truncate font-medium">{entry.name}</span>
                          {entry.kind === "dir" ? (
                            <Badge variant="outline">dir</Badge>
                          ) : null}
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
                        <RowMenu
                          entry={entry}
                          onOpen={() => void openEntry(entry)}
                          onDownload={() => void downloadOne(entry)}
                          onRename={() =>
                            setPrompt({
                              kind: "rename",
                              value: entry.name,
                              paths: [entry.path],
                            })
                          }
                          onCopy={() =>
                            setPrompt({
                              kind: "copy",
                              value: `${entry.path}.copy`,
                              paths: [entry.path],
                            })
                          }
                          onMove={() =>
                            setPrompt({
                              kind: "move",
                              value: entry.path,
                              paths: [entry.path],
                            })
                          }
                          onChmod={() =>
                            setPrompt({
                              kind: "chmod",
                              value: entry.mode,
                              paths: [entry.path],
                            })
                          }
                          onDelete={() =>
                            setPrompt({
                              kind: "delete",
                              value: "",
                              paths: [entry.path],
                            })
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {counts
          ? `${counts.files} files · ${counts.dirs} folders · ${formatSize(counts.bytes)}${
              selected.size ? ` · ${selected.size} selected` : ""
            }${listing?.truncated ? " · listing truncated" : ""}`
          : busy
            ? "Loading…"
            : ""}
        {" · "}
        Enter opens · Backspace up · Del removes · drop to upload · 4 MB cap
      </p>

      <PromptDialog
        prompt={prompt}
        busy={busy}
        onChange={(value) => prompt && setPrompt({ ...prompt, value })}
        onClose={() => setPrompt(null)}
        onSubmit={() => void submitPrompt()}
      />

      <Dialog open={Boolean(editor)} onOpenChange={(o) => !o && setEditor(null)}>
        <DialogContent className="flex h-[min(80vh,44rem)] max-w-4xl flex-col">
          <DialogHeader>
            <DialogTitle className="font-mono text-base">{editor?.name}</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {editor?.path}
              {editor?.dirty ? " · unsaved" : ""}
            </DialogDescription>
          </DialogHeader>
          {editor ? (
            <Textarea
              value={editor.content}
              onChange={(e) =>
                setEditor({ ...editor, content: e.target.value, dirty: true })
              }
              spellCheck={false}
              className="min-h-0 flex-1 resize-none font-mono text-[13px] leading-relaxed"
            />
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditor(null)}>
              Close
            </Button>
            <Button onClick={() => void saveEditor()} disabled={busy || !editor?.dirty}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(preview)} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-base">{preview?.name}</DialogTitle>
          </DialogHeader>
          {preview ? (
            <img
              src={preview.src}
              alt={preview.name}
              className="mx-auto max-h-[60vh] rounded-md bg-secondary object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RowMenu({
  entry,
  onOpen,
  onDownload,
  onRename,
  onCopy,
  onMove,
  onChmod,
  onDelete,
}: {
  entry: FileEntry;
  onOpen: () => void;
  onDownload: () => void;
  onRename: () => void;
  onCopy: () => void;
  onMove: () => void;
  onChmod: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${entry.name} actions`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={onOpen}>
          <Pencil className="size-4" />
          {entry.kind === "dir" ? "Open" : entry.editable ? "Edit" : "Open"}
        </DropdownMenuItem>
        {entry.kind !== "dir" ? (
          <DropdownMenuItem onClick={onDownload}>
            <Download className="size-4" />
            Download
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={onRename}>Rename</DropdownMenuItem>
        <DropdownMenuItem onClick={onCopy}>
          <Copy className="size-4" />
          Copy to…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onMove}>Move to…</DropdownMenuItem>
        <DropdownMenuItem onClick={onChmod}>Permissions</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PromptDialog({
  prompt,
  busy,
  onChange,
  onClose,
  onSubmit,
}: {
  prompt: { kind: PromptKind; value: string; paths: string[] } | null;
  busy: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!prompt) return null;
  const titles: Record<PromptKind, string> = {
    "new-file": "New file",
    "new-folder": "New folder",
    rename: "Rename",
    copy: "Copy to",
    move: "Move to",
    chmod: "Permissions",
    delete: "Delete",
  };
  const labels: Record<PromptKind, string> = {
    "new-file": "Name",
    "new-folder": "Name",
    rename: "New name",
    copy: "Destination path",
    move: "Destination path",
    chmod: "Mode (octal)",
    delete: "",
  };
  const isDelete = prompt.kind === "delete";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titles[prompt.kind]}</DialogTitle>
          <DialogDescription>
            {isDelete
              ? `Remove ${prompt.paths.length === 1 ? prompt.paths[0] : `${prompt.paths.length} items`} from this account. Directories go recursively.`
              : "Stays inside this site or app home."}
          </DialogDescription>
        </DialogHeader>
        {!isDelete ? (
          <div className="grid gap-2">
            <Label>{labels[prompt.kind]}</Label>
            <Input
              value={prompt.value}
              onChange={(e) => onChange(e.target.value)}
              autoFocus
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSubmit();
              }}
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={isDelete ? "destructive" : "default"}
            onClick={onSubmit}
            disabled={busy || (!isDelete && !prompt.value.trim())}
          >
            {isDelete ? "Delete" : "OK"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
