/**
 * Alexvya Platform — Monetary Display Formatters
 * Stage 2.10: Customer Transactions & History
 * 
 * STRICT INVARIANT:
 * These formatters are for presentation only.
 * They must NEVER be used to compute authoritative financial balances or deductions.
 */

export function formatKoboAsNaira(kobo: number | null | undefined): string {
  if (kobo === null || kobo === undefined || isNaN(kobo)) {
    return '₦0.00';
  }
  const naira = Math.abs(kobo) / 100;
  const formatted = naira.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return kobo < 0 ? `-₦${formatted}` : `₦${formatted}`;
}

export function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return d.toLocaleString('en-NG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}
