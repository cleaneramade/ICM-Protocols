// Integration → domain map + logo source chain. A connection can carry a custom
// logo URL (a direct image link the owner pasted); otherwise logos are pulled
// automatically from keyless sources by the connection's domain.
export const INTEGRATION_DOMAINS = {
  'Gmail': 'gmail.com',
  'GitHub': 'github.com',
  'Vercel': 'vercel.com',
  'Supabase': 'supabase.com',
  'Resend': 'resend.com',
  'GoDaddy': 'godaddy.com',
  'Twingate': 'twingate.com',
  'Cloudflare': 'cloudflare.com',
  'Notion': 'notion.so',
  'Stripe': 'stripe.com',
  'Google Calendar': 'calendar.google.com',
  'Google Drive': 'drive.google.com',
  'Brave Search': 'brave.com',
};

// Simple per-integration bucket labels (the description lives in the board).
export const BUCKET_LABELS = {
  'Gmail':    { read: 'Read emails',   write: 'Compose & organize', full: 'Trash & delete' },
  'Supabase': { read: 'Read data',     write: 'Edit data',          full: 'Delete & production' },
  'Vercel':   { read: 'View projects', write: 'Deploy previews',     full: 'Production & delete' },
  'Stripe':   { read: 'View payments', write: 'Create & refund',     full: 'Live & delete' },
  'Twingate': { read: 'View network',  write: 'Grant access',        full: 'Revoke & delete' },
};
const GENERIC_LABELS = { read: 'Read', write: 'Write', full: 'Full access' };

export function bucketLabel(name, bucket) {
  return (BUCKET_LABELS[name] || GENERIC_LABELS)[bucket] || GENERIC_LABELS[bucket];
}

export function domainFor(name) {
  if (INTEGRATION_DOMAINS[name]) return INTEGRATION_DOMAINS[name];
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return slug ? slug + '.com' : null;
}

// Pinned logos (inline SVG data URIs) that always win over fetched ones.
const LOGO_OVERRIDES = {
  // Stripe blurple "S" mark
  'Stripe': 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="26" fill="#635BFF"/><text x="64" y="94" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="88" font-weight="700" fill="#fff">S</text></svg>'
  ),
};

// Ordered list of logo URLs to try (first that loads wins). A custom URL the
// owner pasted wins; if it fails to load the chain falls through to the pinned
// override (if any) and the keyless domain sources, so a bad URL never leaves a
// connection logo-less.
export function logoSources(name, customUrl) {
  const out = [];
  if (customUrl) out.push(customUrl);
  if (LOGO_OVERRIDES[name]) out.push(LOGO_OVERRIDES[name]);
  const domain = domainFor(name);
  if (domain) {
    out.push(`https://unavatar.io/${domain}?fallback=false`);
    out.push(`https://icons.duckduckgo.com/ip3/${domain}.ico`);
  }
  return out;
}
