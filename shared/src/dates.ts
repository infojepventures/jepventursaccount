// Malaysia is UTC+8 all year (no DST), so a fixed offset is exact.
const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;

function mytParts(d: Date) {
  const m = new Date(d.getTime() + MYT_OFFSET_MS);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return {
    yyyy: String(m.getUTCFullYear()),
    MM: p2(m.getUTCMonth() + 1),
    dd: p2(m.getUTCDate()),
    HH: p2(m.getUTCHours()),
    mm: p2(m.getUTCMinutes()),
    ss: p2(m.getUTCSeconds()),
  };
}

export function formatYyyyMm(d: Date): string {
  const p = mytParts(d);
  return `${p.yyyy}${p.MM}`;
}

export function formatYmd(d: Date): string {
  const p = mytParts(d);
  return `${p.yyyy}-${p.MM}-${p.dd}`;
}

export function formatYmdHms(d: Date): string {
  const p = mytParts(d);
  return `${p.yyyy}-${p.MM}-${p.dd} ${p.HH}:${p.mm}:${p.ss}`;
}

export function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
