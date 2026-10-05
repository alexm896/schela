import { Link } from "@tanstack/react-router";
import { Inbox, KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { formatBytes } from "@/lib/utils";
import type { Mailbox } from "../types";

export function MailboxCard({
  box,
  onSetPassword,
  onToggle,
  onRemove,
}: {
  box: Mailbox;
  onSetPassword: () => void;
  onToggle: (active: boolean) => void;
  onRemove: () => void;
}) {
  const used = Math.min(100, Math.round((box.usedMb / box.quotaMb) * 100));
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium">{box.address}</p>
            <Badge variant={box.status === "active" ? "ok" : "default"}>
              {box.status}
            </Badge>
            <Badge variant={box.hasPassword ? "ok" : "warn"}>
              {box.hasPassword ? "password set" : "no password"}
            </Badge>
          </div>
          <div className="mt-2 max-w-sm">
            <Progress value={used} />
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {formatBytes(box.usedMb)} of {formatBytes(box.quotaMb)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/webmail" search={{ address: box.address }}>
              <Inbox className="size-4" />
              Webmail
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onSetPassword}
          >
            <KeyRound className="size-4" />
            {box.hasPassword ? "Reset password" : "Set password"}
          </Button>
          <Switch
            checked={box.status === "active"}
            onCheckedChange={onToggle}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
          >
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
