/**
 * Product metadata (name + category) for review entries.
 *
 * IMPORTANT: categories are review METADATA for organization, filtering, and
 * display. They are NOT model features — the trained pipeline classifies from
 * review text (and uses star rating only for the rating/sentiment-gap signal).
 */

export const PRODUCT_CATEGORIES = [
  'Electronics',
  'Mobile Phones and Accessories',
  'Computers and Laptops',
  'Beauty and Skincare',
  'Face Creams and Serums',
  'Lotions and Moisturizers',
  'Hair Care',
  'Health and Personal Care',
  'Clothing and Fashion',
  'Shoes and Accessories',
  'Home and Kitchen',
  'Furniture and Home Decor',
  'Food and Beverages',
  'Books and Stationery',
  'Toys and Games',
  'Sports and Fitness',
  'Other'
];

export const MAX_PRODUCT_NAME = 120;
export const MAX_CATEGORY = 60;

/**
 * Validates and normalizes optional/required product metadata for one entry.
 * Returns { errors: string[], productName: string|null, productCategory: string|null }.
 * `requireCategory` is true for the multi-review batch workflow.
 */
export function normalizeProductMeta(body = {}, { requireCategory = false } = {}) {
  const errors = [];
  let productName = null;
  let productCategory = null;

  if (body.productName !== undefined && body.productName !== null && String(body.productName).trim() !== '') {
    const name = String(body.productName).trim();
    if (name.length > MAX_PRODUCT_NAME) errors.push(`productName: exceeds ${MAX_PRODUCT_NAME} character limit`);
    else productName = name;
  }

  const rawCategory = body.productCategory !== undefined && body.productCategory !== null
    ? String(body.productCategory).trim() : '';
  if (rawCategory) {
    if (rawCategory.length > MAX_CATEGORY) errors.push(`productCategory: exceeds ${MAX_CATEGORY} character limit`);
    else productCategory = rawCategory;
  } else if (requireCategory) {
    errors.push('productCategory: required (choose a category or enter a custom one)');
  }

  return { errors, productName, productCategory };
}

/** Honest fallback label for records stored before category metadata existed. */
export const UNCATEGORIZED = 'Uncategorized';
