// Helpers for table labels shared by the dashboard and the waiter app.

// "Table 2" before "Table 10": compare digit runs numerically, the rest as
// case-insensitive text.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function compareTableLabels(a: string, b: string): number {
  return collator.compare(a, b);
}

export function sortByLabel<T extends { label: string }>(tables: T[]): T[] {
  return [...tables].sort((x, y) => compareTableLabels(x.label, y.label));
}

// Turn what an owner typed into the "add tables" box into labels:
//   "1-12"            → "1" … "12"
//   "A1-A6"           → "A1" … "A6"
//   "Patio 1, Patio 2" → ["Patio 1", "Patio 2"]
// Lines and commas separate entries. A range is <prefix><from>-<to> or
// <prefix><from>-<prefix><to>; the prefix keeps its own spacing ("T1" stays
// "T1", "Patio 1" stays "Patio 1").
export function expandTableLabels(input: string, max = 300): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (label: string) => {
    const l = label.trim();
    if (!l || seen.has(l)) return;
    seen.add(l);
    out.push(l);
  };

  for (const rawPart of input.split(/[\n,]/)) {
    const part = rawPart.trim();
    if (!part) continue;
    const range = /^([^\d]*?)(\d+)\s*(?:-|–|to)\s*([^\d]*?)(\d+)$/i.exec(part);
    if (range) {
      const [, prefixA, fromStr, prefixB, toStr] = range;
      const sameSide =
        prefixB.trim() === "" ||
        prefixB.trim().toLowerCase() === prefixA.trim().toLowerCase();
      const from = Number(fromStr);
      const to = Number(toStr);
      if (sameSide && Number.isFinite(from) && Number.isFinite(to) && from <= to && to - from < 10_000) {
        for (let n = from; n <= to && out.length < max; n++) {
          push(`${prefixA}${n}`);
        }
        continue;
      }
    }
    push(part);
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}
