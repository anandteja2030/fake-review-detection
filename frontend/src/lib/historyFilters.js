/**
 * Prediction-history filtering — pure functions used by the History page and
 * the Analytics category explorer.
 *
 * Why this exists: the previous implementation passed `category`/`verdict`
 * into `useFetch(fn)` without a dependency list. `useFetch` defaults to
 * `deps = []`, so its effect ran exactly once and the selectors never
 * triggered a refetch. Filtering now happens over the already-loaded records,
 * so every control updates immediately and selectors combine correctly.
 *
 * Legacy records (saved before product metadata existed) have no
 * `productCategory`; they are treated as UNCATEGORIZED. Records without a
 * `prediction` never match a fake/genuine filter and are counted separately.
 */

export const UNCATEGORIZED = 'Uncategorized';

const text = (v) => (typeof v === 'string' ? v : '');

/** Category of a record, with an honest fallback for legacy rows. */
export function recordCategory(record) {
  const category = text(record?.productCategory).trim();
  return category || UNCATEGORIZED;
}

/** Binary verdict of a record, or null when the record has none. */
export function recordVerdict(record) {
  const p = text(record?.prediction).toLowerCase();
  return p === 'fake' || p === 'genuine' ? p : null;
}

/** Categories present in the records, sorted, with UNCATEGORIZED present only
 *  when at least one legacy record needs it. */
export function categoryOptions(records = []) {
  const seen = new Set(records.map(recordCategory));
  const named = [...seen].filter((c) => c !== UNCATEGORIZED).sort((a, b) => a.localeCompare(b));
  return seen.has(UNCATEGORIZED) ? [...named, UNCATEGORIZED] : named;
}

/** True when query matches any user-visible field of the record. */
export function matchesQuery(record, query) {
  const q = text(query).trim().toLowerCase();
  if (!q) return true;
  const verdict = recordVerdict(record);
  const haystack = [
    text(record?.text),
    text(record?.productName),
    recordCategory(record),
    verdict || '',
    record?.rating != null ? String(record.rating) : ''
  ].join(' ').toLowerCase();
  return haystack.includes(q);
}

/** Apply category + verdict + free-text search together. */
export function filterHistoryRecords(records = [], { category = '', verdict = '', query = '' } = {}) {
  return records.filter((record) => {
    if (category && recordCategory(record) !== category) return false;
    if (verdict && recordVerdict(record) !== verdict) return false;
    return matchesQuery(record, query);
  });
}

/** Verdict counts for a set of records. `unpredicted` keeps legacy rows visible
 *  instead of silently folding them into Genuine. */
export function verdictCounts(records = []) {
  let fake = 0;
  let genuine = 0;
  for (const record of records) {
    const v = recordVerdict(record);
    if (v === 'fake') fake += 1;
    else if (v === 'genuine') genuine += 1;
  }
  return { total: records.length, fake, genuine, unpredicted: records.length - fake - genuine };
}

/** True when any filter is narrowing the list. */
export function hasActiveFilters({ category = '', verdict = '', query = '' } = {}) {
  return Boolean(category || verdict || text(query).trim());
}
