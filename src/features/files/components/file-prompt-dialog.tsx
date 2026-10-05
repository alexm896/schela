import { Button } from "@/components/ui/button";
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

export type FilePromptKind = "new-file" | "new-folder" | "rename" | "copy" | "move" | "chmod" | "delete";

export type FilePrompt = { kind: FilePromptKind; value: string; paths: string[] };

export function FilePromptDialog({
  prompt,
  busy,
  onChange,
  onClose,
  onSubmit,
}: {
  prompt: FilePrompt | null;
  busy: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!prompt) return null;
  const titles: Record<FilePromptKind, string> = {
    "new-file": "New file",
    "new-folder": "New folder",
    rename: "Rename",
    copy: "Copy to",
    move: "Move to",
    chmod: "Permissions",
    delete: "Delete",
  };
  const labels: Record<FilePromptKind, string> = {
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
