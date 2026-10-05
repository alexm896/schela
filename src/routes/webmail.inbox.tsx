import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { Inbox, LogOut, PenLine, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SchelaMark } from "@/components/layout/schela-mark";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import type { MailListItem } from "@/features/webmail/imap";
import {
  webmailDelete,
  webmailFolders,
  webmailList,
  webmailLogout,
  webmailRead,
  webmailSend,
  webmailWhoami,
} from "@/features/webmail/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/webmail/inbox")({
  loader: async () => {
    const who = await webmailWhoami();
    if (!who) throw redirect({ to: "/webmail" });
    const folders = await webmailFolders();
    return { who, folders };
  },
  component: WebmailInbox,
});

function WebmailInbox() {
  const { who, folders } = Route.useLoaderData();
  const router = useRouter();
  const [folder, setFolder] = useState("INBOX");
  const [items, setItems] = useState<MailListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [openUid, setOpenUid] = useState<number | null>(null);
  const [images, setImages] = useState(false);
  const [read, setRead] = useState<{
    from: string;
    to: string;
    subject: string;
    date: string;
    html: string;
  } | null>(null);
  const [compose, setCompose] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const list = await webmailList({ data: { folder } });
      setItems(list);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load folder");
    } finally {
      setBusy(false);
    }
  }, [folder]);

  useEffect(() => {
    void reload();
    setOpenUid(null);
    setRead(null);
    setImages(false);
  }, [reload]);

  async function openMsg(uid: number, allowImages = false) {
    setOpenUid(uid);
    setImages(allowImages);
    try {
      const msg = await webmailRead({
        data: { folder, uid, images: allowImages },
      });
      setRead({
        from: msg.from,
        to: msg.to,
        subject: msg.subject,
        date: msg.date,
        html: msg.html,
      });
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open message");
    }
  }

  async function onDelete(uid: number) {
    try {
      await webmailDelete({ data: { folder, uid } });
      if (openUid === uid) {
        setOpenUid(null);
        setRead(null);
      }
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete");
    }
  }

  async function onSend() {
    setBusy(true);
    try {
      await webmailSend({ data: { to, subject, text } });
      toast.success("Sent");
      setCompose(false);
      setTo("");
      setSubject("");
      setText("");
      if (folder.toLowerCase().includes("sent")) await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  const unseen = (m: MailListItem) => !m.flags.some((f) => f.toLowerCase() === "\\seen");

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 items-center gap-3 border-b border-border px-4">
        <SchelaMark className="size-7" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{who.address}</p>
          <p className="text-[11px] text-muted-foreground">Webmail · encrypted session</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setCompose(true)}>
          <PenLine className="size-4" />
          Compose
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void webmailLogout().then(() => router.navigate({ to: "/webmail" }))
          }
        >
          <LogOut className="size-4" />
          Sign out
        </Button>
      </header>

      <div className="grid flex-1 md:grid-cols-[12rem_minmax(0,22rem)_minmax(0,1fr)]">
        <nav className="border-b border-border p-3 md:border-b-0 md:border-r">
          <p className="mb-2 px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Folders
          </p>
          <ul className="grid gap-0.5">
            {(folders.includes("INBOX") ? folders : ["INBOX", ...folders]).map((f) => (
              <li key={f}>
                <button
                  type="button"
                  onClick={() => setFolder(f)}
                  className={cn(
                    "flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm",
                    f === folder ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
                  )}
                >
                  <Inbox className="size-4 shrink-0" />
                  {f}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section className="border-b border-border md:border-b-0 md:border-r">
          <div className="flex h-10 items-center justify-between border-b border-border px-3">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {folder}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {busy ? "Loading…" : `${items.length} messages`}
            </p>
          </div>
          <ul className="max-h-[40vh] overflow-y-auto md:max-h-[calc(100dvh-6rem)]">
            {items.length === 0 ? (
              <li className="px-4 py-10 text-center text-sm text-muted-foreground">Empty</li>
            ) : (
              items.map((m) => (
                <li key={m.uid}>
                  <button
                    type="button"
                    onClick={() => void openMsg(m.uid)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 border-b border-border px-4 py-3 text-left hover:bg-accent/40",
                      openUid === m.uid && "bg-accent",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <p
                        className={cn(
                          "min-w-0 flex-1 truncate text-sm",
                          unseen(m) ? "font-semibold" : "font-medium",
                        )}
                      >
                        {m.from || "(unknown)"}
                      </p>
                      {unseen(m) ? <Badge variant="ok">new</Badge> : null}
                    </div>
                    <p className="truncate text-sm text-foreground">{m.subject}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {m.date}
                    </p>
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="flex min-h-[40vh] flex-col">
          {read ? (
            <>
              <div className="border-b border-border px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <h1 className="text-lg font-semibold tracking-tight">{read.subject}</h1>
                  {openUid ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete"
                      onClick={() => void onDelete(openUid)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  From {read.from}
                  <br />
                  To {read.to}
                </p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">{read.date}</p>
                {!images ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => openUid && void openMsg(openUid, true)}
                  >
                    Show remote images
                  </Button>
                ) : null}
              </div>
              <iframe
                title="Message"
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={read.html}
                className="min-h-64 w-full flex-1 bg-card"
              />
            </>
          ) : (
            <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
              Select a message
            </div>
          )}
        </section>
      </div>

      <Dialog open={compose} onOpenChange={setCompose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New message</DialogTitle>
            <DialogDescription>
              From {who.address} — locked to this mailbox. Plain text only.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="to">To</Label>
              <Input
                id="to"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="person@example.com"
                spellCheck={false}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="subj">Subject</Label>
              <Input id="subj" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="body">Message</Label>
              <Textarea
                id="body"
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="min-h-40"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCompose(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void onSend()}
              disabled={busy || !to.includes("@") || !subject.trim() || !text.trim()}
            >
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
