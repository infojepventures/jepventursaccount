export function parseAmountToCents(input: string): number | null {
  const s = input.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const dot = s.indexOf('.');
  const whole = dot === -1 ? s : s.slice(0, dot);
  const frac = dot === -1 ? '' : s.slice(dot + 1);
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function formatRM(cents: number): string {
  const s = formatCents(cents);
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const dot = body.indexOf('.');
  const grouped = body.slice(0, dot).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `RM ${neg ? '-' : ''}${grouped}${body.slice(dot)}`;
}

export function sumCents(items: { amountCents: number }[]): number {
  return items.reduce((sum, i) => sum + i.amountCents, 0);
}
