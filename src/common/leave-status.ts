/**
 * Leave statuses are stored upper-case (APPROVED, REJECTED, ...), but older
 * rows may still hold the legacy "Approved"/"Rejected" spelling. Compare
 * case-insensitively so dashboards count both.
 */
export const isApprovedStatus = (status: string | null | undefined): boolean =>
  (status ?? '').toUpperCase() === 'APPROVED';

export const isRejectedStatus = (status: string | null | undefined): boolean =>
  (status ?? '').toUpperCase() === 'REJECTED';
