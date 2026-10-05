// What deleting one thing takes with it. The server describes it as a removal
// plan; the confirm dialog shows the plan and sends back the options the admin
// ticked. Pure, shared by the server functions, the dialog and the tests.

/** A group of concrete things, listed by name. */
export type RemovalGroup = {
  label: string;
  items: string[];
};

/** Something the admin may also remove. Configuration starts ticked, data unticked. */
export type RemovalOption<K extends string = string> = RemovalGroup & {
  key: K;
  defaultOn: boolean;
};

export type RemovalPlan<K extends string = string> = {
  /** Text the admin must type to confirm, or null when a click is enough. */
  confirm: string | null;
  /** Removed with it no matter what: nothing works without it. */
  alsoRemoved: RemovalGroup[];
  options: RemovalOption<K>[];
  /** What stays, or anything else worth knowing before deleting. */
  notes: string[];
};

export function initialSelection<K extends string>(plan: RemovalPlan<K>): K[] {
  return plan.options.filter((o) => o.defaultOn).map((o) => o.key);
}

export function toggleOption<K extends string>(selection: readonly K[], key: K, on: boolean): K[] {
  const rest = selection.filter((k) => k !== key);
  return on ? [...rest, key] : rest;
}

/** A group only when it has something in it. */
export function group(label: string, items: readonly string[]): RemovalGroup[] {
  return items.length ? [{ label, items: [...items] }] : [];
}

/** An option only when it has something in it. */
export function option<K extends string>(
  key: K,
  label: string,
  items: readonly string[],
  defaultOn: boolean,
): RemovalOption<K>[] {
  return items.length ? [{ key, label, items: [...items], defaultOn }] : [];
}

/** The keys the admin asked for that the plan actually offers. */
export function chosen<K extends string>(plan: RemovalPlan<K>, requested: readonly K[]): Set<K> {
  const offered = new Set(plan.options.map((o) => o.key));
  return new Set(requested.filter((k) => offered.has(k)));
}

/** Throws unless `typed` matches what the plan asks to type. */
export function assertConfirmed(plan: RemovalPlan, typed: string | undefined): void {
  if (plan.confirm !== null && (typed ?? "").trim() !== plan.confirm) {
    throw new Error(`Type ${plan.confirm} to confirm`);
  }
}
