import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UNCATEGORIZED, categoryOptions, filterHistoryRecords, recordCategory,
  recordVerdict, verdictCounts, hasActiveFilters, matchesQuery
} from '../../frontend/src/lib/historyFilters.js';

const records = [
  { id: 'h1', text: 'Amazing earbuds', rating: 5, productCategory: 'Electronics', prediction: 'fake' },
  { id: 'h2', text: 'Battery died quickly', rating: 1, productCategory: 'Electronics', prediction: 'genuine' },
  { id: 'h3', text: 'Lovely serum', rating: 5, productCategory: 'Beauty and Skincare', prediction: 'genuine' },
  { id: 'h4', text: 'Legacy row with no metadata', rating: 4, prediction: 'fake' },
  { id: 'h5', text: 'Legacy row without verdict', rating: 3 }
];

test('recordCategory falls back to Uncategorized for legacy rows', () => {
  assert.equal(recordCategory(records[3]), UNCATEGORIZED);
  assert.equal(recordCategory({ productCategory: '   ' }), UNCATEGORIZED);
  assert.equal(recordCategory({ productCategory: 'Books' }), 'Books');
});

test('recordVerdict only accepts the two trained classes', () => {
  assert.equal(recordVerdict(records[0]), 'fake');
  assert.equal(recordVerdict(records[4]), null);
  assert.equal(recordVerdict({ prediction: 'suspicious' }), null);
  assert.equal(recordVerdict({ prediction: 'FAKE' }), 'fake');
});

test('category filter uses the stored category field', () => {
  const out = filterHistoryRecords(records, { category: 'Electronics' });
  assert.deepEqual(out.map((r) => r.id), ['h1', 'h2']);
});

test('legacy rows match the Uncategorized option', () => {
  const out = filterHistoryRecords(records, { category: UNCATEGORIZED });
  assert.deepEqual(out.map((r) => r.id), ['h4', 'h5']);
});

test('verdict filter uses the saved prediction label', () => {
  assert.deepEqual(filterHistoryRecords(records, { verdict: 'fake' }).map((r) => r.id), ['h1', 'h4']);
  assert.deepEqual(filterHistoryRecords(records, { verdict: 'genuine' }).map((r) => r.id), ['h2', 'h3']);
});

test('category and verdict combine instead of resetting each other', () => {
  const out = filterHistoryRecords(records, { category: 'Electronics', verdict: 'genuine' });
  assert.deepEqual(out.map((r) => r.id), ['h2']);
  const none = filterHistoryRecords(records, { category: 'Beauty and Skincare', verdict: 'fake' });
  assert.equal(none.length, 0);
});

test('search combines with both selectors and matches products/ratings', () => {
  assert.deepEqual(
    filterHistoryRecords(records, { category: 'Electronics', query: 'earbuds' }).map((r) => r.id),
    ['h1']
  );
  assert.deepEqual(filterHistoryRecords(records, { query: '5' }).map((r) => r.id), ['h1', 'h3']);
  assert.deepEqual(filterHistoryRecords(records, { verdict: 'genuine', query: 'serum' }).map((r) => r.id), ['h3']);
  assert.equal(matchesQuery(records[0], 'electronics'), true);
  assert.equal(matchesQuery(records[0], 'beauty'), false);
});

test('empty search and empty selectors return every record', () => {
  assert.equal(filterHistoryRecords(records, {}).length, records.length);
  assert.equal(filterHistoryRecords(records, { query: '   ' }).length, records.length);
});

test('verdict counts keep unpredicted legacy rows separate', () => {
  assert.deepEqual(verdictCounts(records), { total: 5, fake: 2, genuine: 2, unpredicted: 1 });
  assert.deepEqual(verdictCounts([]), { total: 0, fake: 0, genuine: 0, unpredicted: 0 });
});

test('categoryOptions sorts and only includes Uncategorized when needed', () => {
  assert.deepEqual(categoryOptions(records), ['Beauty and Skincare', 'Electronics', UNCATEGORIZED]);
  assert.deepEqual(categoryOptions([{ productCategory: 'A' }, { productCategory: 'B' }]), ['A', 'B']);
});

test('hasActiveFilters treats whitespace search as inactive', () => {
  assert.equal(hasActiveFilters({}), false);
  assert.equal(hasActiveFilters({ query: '   ' }), false);
  assert.equal(hasActiveFilters({ verdict: 'fake' }), true);
  assert.equal(hasActiveFilters({ category: 'Electronics' }), true);
  assert.equal(hasActiveFilters({ query: 'x' }), true);
});
