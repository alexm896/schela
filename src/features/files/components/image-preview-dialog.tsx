import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type ImagePreview = { name: string; src: string };

export function ImagePreviewDialog({
  preview,
  onClose,
}: {
  preview: ImagePreview | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(preview)} onOpenChange={(o) => !o && onClose()}>
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
  );
}
