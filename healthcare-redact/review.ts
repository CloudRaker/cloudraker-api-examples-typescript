/**
 * A finished redaction turned into something reviewable: what was removed, what
 * was left, and both files side by side. The only redaction-specific file —
 * page.ts renders whatever this returns.
 */

export type Entity = { label: string; count: number };
export type Check = { ok: boolean | null; label: string; detail?: string };
export type Preview = { name: string; url: string; kind: "pdf" | "audio" | "other" };
export type Review = {
  entities: Entity[];
  total: number;
  skipped: number;
  checks: Check[];
  before: Preview | null;
  after: Preview | null;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export function kindOf(nameOrType: string): Preview["kind"] {
  const s = nameOrType.toLowerCase();
  if (s.includes("pdf")) return "pdf";
  if (s.includes("audio") || /\.(mp3|m4a|wav|aac|ogg|mp4|mov)$/.test(s)) return "audio";
  return "other";
}

/** `entities` is keyed by display name — "Person names", "Date of birth". */
function entitiesOf(output: Record<string, unknown>): Entity[] {
  const raw = output.entities;
  if (!isRecord(raw)) return [];
  return Object.entries(raw)
    .map(([label, count]) => ({ label, count: typeof count === "number" ? count : 0 }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count);
}

/**
 * `skipped` counts inputs where nothing matched, so no redacted copy was written
 * — a clean file, not a leftover. There is no signal for "found but not removed".
 */
/** A label, and optionally the figures behind it. */
type Said = [string, string?];

function checks(entities: Entity[], skipped: number, after: Preview | null): Check[] {
  const total = entities.reduce((n, e) => n + e.count, 0);
  const clean = skipped > 0 && total === 0;
  const spread = `${total} item${total === 1 ? "" : "s"} across ${entities.length} categor${entities.length === 1 ? "y" : "ies"}`;

  // The wording follows the outcome, so a ✗ never reads as a claim that held.
  // `fail` is null where a check has no failing case — only a result or nothing.
  const say = (ok: boolean | null, pass: Said, fail: Said | null, absent: string): Check => {
    if (ok === null) return { ok, label: absent };
    const [text, detail] = ok ? pass : (fail ?? pass);
    return detail ? { ok, label: text, detail } : { ok, label: text };
  };

  return [
    say(
      total > 0 ? true : null,
      ["personal information was removed", spread],
      null,
      "nothing matched — the file was already clean, or the categories missed it",
    ),
    say(
      clean ? null : !!after?.url,
      ["the redacted file is ready to download", after?.name],
      ["no redacted file came back"],
      "no redacted copy was made, because there was nothing to remove",
    ),
  ];
}

export function review(run: unknown, before: Preview | null): Review | null {
  const output = (run as { output?: unknown })?.output;
  if (!isRecord(output)) return null;
  const file = isRecord(output.file) ? output.file : undefined;
  const name = String(file?.name ?? "");
  const after: Preview | null = file
    ? { name, url: String(file.url ?? ""), kind: kindOf(name) }
    : null;
  const entities = entitiesOf(output);
  const skipped = typeof output.skipped === "number" ? output.skipped : 0;
  return {
    entities,
    total: entities.reduce((n, e) => n + e.count, 0),
    skipped,
    checks: checks(entities, skipped, after),
    before,
    after,
  };
}
