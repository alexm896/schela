import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export type FileEditorState = {
  path: string;
  name: string;
  content: string;
  dirty: boolean;
};

export function FileEditorDialog({
  editor,
  busy,
  onChange,
  onClose,
  onSave,
}: {
  editor: FileEditorState | null;
  busy: boolean;
  onChange: (editor: FileEditorState) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={Boolean(editor)} onOpenChange={(o) => !o && onClose()}>
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
            onChange={(e) => onChange({ ...editor, content: e.target.value, dirty: true })}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none font-mono text-[13px] leading-relaxed"
          />
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onSave} disabled={busy || !editor?.dirty}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
