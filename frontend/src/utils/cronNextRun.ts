/**
 * Expand a single cron field into the set of matching integer values.
 * Handles: *, *\/N, N, N-M, N-M/S, and comma-separated combos.
 */
function expandCronField(field: string, min: number, max: number): number[] {
  const values = new Set<number>();
  const normalize = (v: number) => (min === 0 && max === 6 && v === 7 ? 0 : v);

  for (const part of field.split(',')) {
    if (part === '*') {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (part.startsWith('*/')) {
      const step = parseInt(part.slice(2));
      if (isNaN(step) || step <= 0) continue;
      for (let i = min; i <= max; i += step) values.add(normalize(i));
    } else if (part.includes('-')) {
      const [rangePart, stepPart] = part.split('/');
      const [lo, hi] = rangePart.split('-').map(Number);
      const step = stepPart ? parseInt(stepPart) : 1;
      if (isNaN(lo) || isNaN(hi) || isNaN(step)) continue;
      for (let i = lo; i <= hi; i += step) values.add(normalize(i));
    } else {
      const v = parseInt(part);
      if (!isNaN(v)) values.add(normalize(v));
    }
  }
  return [...values].filter(v => v >= min && v <= max).sort((a, b) => a - b);
}

/**
 * Calculate a human-readable "in Xd Yh" / "in Xh Ym" / "in X min" string
 * for the next matching time of a 5-field cron expression.
 */
export function calculateNextRun(cronExpression: string): string {
  try {
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length < 5) return 'Invalid schedule';

    const minutes = expandCronField(parts[0], 0, 59);
    const hours = expandCronField(parts[1], 0, 23);
    const daysOfMonth = expandCronField(parts[2], 1, 31);
    const months = expandCronField(parts[3], 1, 12);
    const daysOfWeek = expandCronField(parts[4], 0, 6);

    if (!minutes.length || !hours.length) return 'Invalid schedule';

    const now = new Date();
    const candidate = new Date(now);
    candidate.setSeconds(0);
    candidate.setMilliseconds(0);
    candidate.setMinutes(candidate.getMinutes() + 1);

    const maxIter = 400 * 24 * 60;
    for (let i = 0; i < maxIter; i++) {
      const m = candidate.getMinutes();
      const h = candidate.getHours();
      const dom = candidate.getDate();
      const mon = candidate.getMonth() + 1;
      const dow = candidate.getDay();

      const domIsWildcard = parts[2] === '*';
      const dowIsWildcard = parts[4] === '*';
      const domMatch = daysOfMonth.includes(dom);
      const dowMatch = daysOfWeek.includes(dow);
      const dayMatch =
        domIsWildcard && dowIsWildcard
          ? true
          : domIsWildcard
            ? dowMatch
            : dowIsWildcard
              ? domMatch
              : (domMatch || dowMatch);

      if (
        minutes.includes(m) &&
        hours.includes(h) &&
        (parts[3] === '*' || months.includes(mon)) &&
        dayMatch
      ) {
        const diff = candidate.getTime() - now.getTime();
        const totalMin = Math.floor(diff / (1000 * 60));
        const d = Math.floor(totalMin / (60 * 24));
        const hh = Math.floor((totalMin % (60 * 24)) / 60);
        const mm = totalMin % 60;

        if (d > 0) return `in ${d}d ${hh}h`;
        if (hh > 0) return `in ${hh}h ${mm}m`;
        return `in ${mm} min`;
      }
      candidate.setMinutes(candidate.getMinutes() + 1);
    }

    return 'Unable to calculate';
  } catch {
    return 'Unable to calculate';
  }
}
