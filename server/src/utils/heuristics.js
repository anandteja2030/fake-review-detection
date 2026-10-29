export const POSITIVE_WORDS = new Set([
  'good','great','excellent','amazing','awesome','fantastic','wonderful','perfect','best',
  'love','loved','lovely','beautiful','brilliant','superb','outstanding','incredible',
  'recommend','recommended','recommendation','happy','satisfied','pleased','delightful',
  'impressed','impressive','premium','quality','reliable','worthy','worth','bargain','glad',
  'smooth','sturdy','comfortable','fast','efficient','flawless','must','bought','buy'
]);

export const NEGATIVE_WORDS = new Set([
  'bad','terrible','awful','horrible','worst','poor','disappointing','disappointed','disappointment',
  'hate','hated','broken','broke','defective','damaged','waste','useless','worthless','cheap',
  'unreliable','slow','uncomfortable','flimsy','fail','failed','failure','refund','return','returned',
  'regret','scam','fake','faulty','snap','cracked','stopped','never','avoid','unhappy','sad','angry'
]);

export const PROMOTIONAL_PATTERNS = [
  /\bhighly recommended\b/i, /\bmust buy\b/i, /\bmust have\b/i, /\bbest (purchase|product|deal|price)\b/i,
  /\b(stop|don't|do not) (wait|hesitate|scroll)[!.]?\b/i, /\blimited time\b/i, /\bact now\b/i,
  /\bdelete (this )?review\b/i, /\bdisclaimer: i (received|was given|got)\b/i, /\bfive stars?\b/i,
  /\bchanged my life\b/i, /\blife[- ]saver\b/i, /\bgodsend\b/i, /\blife[- ]changing\b/i,
  /\b100% (satisfied|guaranteed|recommend)\b/i, /\bincredible value\b/i, /\bresponse direct(ly)? from\b/i,
  /\bgame[- ]changer\b/i, /\bunbeatable\b/i, /\bbuy (it|now)!\b/i
];

export const CERTAINTY_WORDS = new Set([
  'definitely','absolutely','totally','completely','certainly','obviously','undoubtedly',
  'perfectly','literally','extremely','amazingly','wonderfully','one hundred'
]);

export const cleanText = (text) => {
  return String(text || '')
    .replace(/http\S+|www\.\S+/g, ' ')
    .replace(/[^\p{L}\p{N}'\-\s,.;:!?%]/gu, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
};

export const tokenize = (text) => (cleanText(text) ? cleanText(text).split(' ') : []);

export const countMatches = (words, set) => words.reduce((n, w) => (set.has(w) ? n + 1 : n), 0);

export const patternFlags = (text) =>
  PROMOTIONAL_PATTERNS.map((p) => ({ pattern: p.source, sample: (text.match(p) || [])[0] || null }))
    .filter((m) => m.sample !== null);
