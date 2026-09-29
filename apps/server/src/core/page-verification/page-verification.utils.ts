import { PeriodUnit, VerificationState } from './dto/page-verification.dto';

export const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

export function addPeriod(from: Date, amount: number, unit: PeriodUnit): Date {
  const date = new Date(from.getTime());
  switch (unit) {
    case 'day':
      date.setUTCDate(date.getUTCDate() + amount);
      break;
    case 'week':
      date.setUTCDate(date.getUTCDate() + amount * 7);
      break;
    case 'month':
      date.setUTCMonth(date.getUTCMonth() + amount);
      break;
    case 'year':
      date.setUTCFullYear(date.getUTCFullYear() + amount);
      break;
  }
  return date;
}

export function computeVerificationState(
  verification: {
    type: string;
    status: string | null;
    verifiedAt: Date | string | null;
    expiresAt: Date | string | null;
  },
  now: Date = new Date(),
): VerificationState {
  if (verification.type === 'approval') {
    const status = verification.status as VerificationState | null;
    return status &&
      ['draft', 'in_approval', 'approved', 'obsolete'].includes(status)
      ? status
      : 'draft';
  }

  if (!verification.verifiedAt || !verification.expiresAt) return 'unverified';
  const expiresAt = new Date(verification.expiresAt).getTime();
  if (expiresAt <= now.getTime()) return 'expired';
  if (expiresAt - now.getTime() <= EXPIRING_SOON_MS) return 'expiring';
  return 'verified';
}
