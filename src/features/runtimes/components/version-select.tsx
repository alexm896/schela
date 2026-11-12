import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RuntimeChoices } from "../api";
import { versionOptions } from "../runtimes";

type Props = {
  choices: RuntimeChoices;
  value: string;
  onValueChange: (version: string) => void;
  /** Version currently in use by an existing site or app; kept visible even when retired. */
  current?: string;
  prefix?: string;
  triggerClassName?: string;
};

export function VersionSelect({
  choices,
  value,
  onValueChange,
  current,
  prefix = "",
  triggerClassName,
}: Props) {
  const options = versionOptions(choices.catalog, choices.selectable, current);
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={triggerClassName}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            {prefix}
            {o.value}
            {o.note ? ` (${o.note})` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
