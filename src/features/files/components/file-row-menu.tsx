import { Copy, Download, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FileEntry } from "../files";

export function FileRowMenu({
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
