export function trustHistogram(history) {
  const buckets = [
    { label: '0-20', min: 0, max: 20, count: 0 },
    { label: '21-40', min: 21, max: 40, count: 0 },
    { label: '41-60', min: 41, max: 60, count: 0 },
    { label: '61-80', min: 61, max: 80, count: 0 },
    { label: '81-100', min: 81, max: 100, count: 0 }
  ];
  for (const h of history) {
    if (typeof h.trustScore !== 'number') continue;
    for (const b of buckets) {
      if (h.trustScore >= b.min && h.trustScore <= b.max) { b.count++; break; }
    }
  }
  return buckets;
}

export function ratingCounts(history) {
  const r = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const x of history) if (r[x.rating] !== undefined) r[x.rating]++;
  return r;
}

export function sentimentCounts(history) {
  const s = {};
  for (const x of history) {
    const k = x.sentimentLabel || 'unknown';
    s[k] = (s[k] || 0) + 1;
  }
  return s;
}
