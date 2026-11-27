/**
 * Canonical Semester / Term Offering tag helpers for Course & Subject catalogs.
 * Empty string / null means "All Semesters / Terms (Full Session)" — 100% backwards
 * compatible with all existing K-12 and tertiary subjects.
 */

export type CanonicalSemesterTag = '' | '1ST' | '2ND' | '3RD';

export function normalizeSemesterTag(raw: unknown): CanonicalSemesterTag {
  if (raw === undefined || raw === null) return '';
  const text = String(raw).trim().toLowerCase();
  if (!text || text === 'all' || text === 'full' || text === 'both' || text === 'any' || text.includes('all ')) {
    return '';
  }

  // 1st Semester / First Term / Harmattan / Trimester 1
  if (
    text === '1' ||
    text === '1st' ||
    text === 's1' ||
    text === 'sem1' ||
    text === 't1' ||
    /\b(1st|first|harmattan|alpha|semester\s*1|term\s*1|trimester\s*1)\b/i.test(text)
  ) {
    return '1ST';
  }

  // 2nd Semester / Second Term / Rain / Omega / Trimester 2
  if (
    text === '2' ||
    text === '2nd' ||
    text === 's2' ||
    text === 'sem2' ||
    text === 't2' ||
    /\b(2nd|second|rain|omega|semester\s*2|term\s*2|trimester\s*2)\b/i.test(text)
  ) {
    return '2ND';
  }

  // 3rd Term / Third Trimester / Summer / 3rd Semester
  if (
    text === '3' ||
    text === '3rd' ||
    text === 's3' ||
    text === 'sem3' ||
    text === 't3' ||
    /\b(3rd|third|summer|semester\s*3|term\s*3|trimester\s*3)\b/i.test(text)
  ) {
    return '3RD';
  }

  return '';
}

export interface SemesterOption {
  value: CanonicalSemesterTag;
  label: string;
}

export function getSemesterTagOptions(
  cycleLabel: string,
  isTertiary: boolean,
  customCycleLabels?: string[]
): SemesterOption[] {
  const plural = cycleLabel.endsWith('s') ? cycleLabel : `${cycleLabel}s`;
  const firstLabel =
    customCycleLabels?.[0] || (isTertiary ? `1st ${cycleLabel}` : `1st ${cycleLabel}`);
  const secondLabel =
    customCycleLabels?.[1] || (isTertiary ? `2nd ${cycleLabel}` : `2nd ${cycleLabel}`);
  const thirdLabel =
    customCycleLabels?.[2] ||
    (isTertiary && cycleLabel.toLowerCase().includes('semester')
      ? `3rd / Summer ${cycleLabel}`
      : `3rd ${cycleLabel}`);

  const options: SemesterOption[] = [
    { value: '', label: `All ${plural} (Full Session)` },
    { value: '1ST', label: firstLabel },
    { value: '2ND', label: secondLabel },
  ];

  // Always allow 3rd option for K-12, Trimesters, or 3+ cycle institutions
  if (!isTertiary || (customCycleLabels && customCycleLabels.length >= 3) || cycleLabel.toLowerCase().includes('trimester')) {
    options.push({ value: '3RD', label: thirdLabel });
  } else {
    options.push({ value: '3RD', label: thirdLabel });
  }

  return options;
}

export function formatSemesterTagLabel(
  rawTag: string | null | undefined,
  cycleLabel: string,
  customCycleLabels?: string[]
): string {
  const canonical = normalizeSemesterTag(rawTag);
  const plural = cycleLabel.endsWith('s') ? cycleLabel : `${cycleLabel}s`;
  if (!canonical) return `All ${plural}`;
  if (canonical === '1ST') return customCycleLabels?.[0] || `1st ${cycleLabel}`;
  if (canonical === '2ND') return customCycleLabels?.[1] || `2nd ${cycleLabel}`;
  if (canonical === '3RD') return customCycleLabels?.[2] || `3rd ${cycleLabel}`;
  return `All ${plural}`;
}

/**
 * Checks whether a subject's semester_tag matches a selected academic term/semester name.
 * A subject with no semester_tag ('') matches EVERY term/semester (backwards-compatible).
 */
export function termMatchesSemesterTag(
  termName: string | null | undefined,
  subjectSemesterTag: string | null | undefined
): boolean {
  const subTag = normalizeSemesterTag(subjectSemesterTag);
  if (!subTag) return true; // Applies across all semesters/terms
  const termTag = normalizeSemesterTag(termName);
  if (!termTag) return true; // Unknown custom term name -> don't hide courses
  return subTag === termTag;
}
