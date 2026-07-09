// Human categories that hide the raw backend rules. Both the Rules board and
// the Permissions view are grouped through here so the user sees "Git & GitHub"
// with a simple green/yellow/red posture, not 26 raw Bash(...) lines.

// ── Rules board: rule ID → category ──────────────────────────────────────
export const RULE_CATEGORIES = [
  { key: 'files', name: 'Files & folders', icon: 'folder-2', desc: 'Reading and changing files on your projects.',
    ids: ['G-01', 'G-04', 'R-04'] },
  { key: 'git', name: 'Git & GitHub', icon: 'code-2', desc: 'Commits, pushing, remotes, and repo settings.',
    ids: ['G-02', 'Y-01', 'Y-02', 'R-03', 'R-05', 'R-06', 'R-09'] },
  { key: 'deploy', name: 'Deploy & production', icon: 'server-2', desc: 'Going live, production data, and the prod→dev sync.',
    ids: ['Y-03', 'R-07', 'G-09', 'R-10'] },
  { key: 'secrets', name: 'Secrets & keys', icon: 'lock', desc: 'Passwords, tokens, and .env files.',
    ids: ['R-01', 'R-02'] },
  { key: 'build', name: 'Build & terminal', icon: 'bolt', desc: 'Tests, builds, installs, and dev tunnels.',
    ids: ['G-03', 'Y-06', 'G-10'] },
  { key: 'services', name: 'Services, publishing & spending', icon: 'layers', desc: 'Outside apps, publishing, money, and automation.',
    ids: ['Y-04', 'Y-05', 'Y-09', 'Y-10', 'Y-11', 'Y-12'] },
  { key: 'foundation', name: 'The foundation itself', icon: 'settings', desc: 'The AI’s own rules, memory, logs, and banner.',
    ids: ['G-05', 'G-06', 'G-07', 'G-08', 'Y-07', 'Y-08', 'R-08'] },
];

const RULE_ID_TO_CAT = (() => {
  const m = {};
  for (const c of RULE_CATEGORIES) for (const id of c.ids) m[id] = c.key;
  return m;
})();

const CAT_BY_KEY = Object.fromEntries(RULE_CATEGORIES.map((c) => [c.key, c]));

// The category a rule belongs to (for chips + filtering). Falls back to Other.
export function ruleCategory(id) {
  return CAT_BY_KEY[RULE_ID_TO_CAT[id]] || { key: 'other', name: 'Other', icon: 'widget-2' };
}

// Bucket the board sections (green/yellow/red) into categories.
// Returns [{ ...category, green:[rows], yellow:[rows], red:[rows], total }]
export function groupRules(sections) {
  const cats = new Map(RULE_CATEGORIES.map((c) => [c.key, { ...c, green: [], yellow: [], red: [] }]));
  const other = { key: 'other', name: 'Other', icon: 'widget-2', desc: 'Rules added recently.', green: [], yellow: [], red: [] };
  for (const color of ['green', 'yellow', 'red']) {
    for (const row of sections[color].rows) {
      const cat = cats.get(row.category || RULE_ID_TO_CAT[row.id]) || other;
      cat[color].push(row);
    }
  }
  const out = [...cats.values(), other]
    .map((c) => ({ ...c, total: c.green.length + c.yellow.length + c.red.length }))
    .filter((c) => c.total > 0);
  return out;
}

// ── Permissions: raw rule string → tool category ─────────────────────────
const PERM_MATCHERS = [
  { key: 'git', name: 'Git & GitHub', icon: 'code-2', test: (r) => /^Bash\((git|gh) /.test(r) },
  { key: 'packages', name: 'Packages & scripts', icon: 'box', test: (r) => /^Bash\((npm|npx|prisma|node|pnpm|yarn) /.test(r) || /^Bash\((npm|prisma)\)/.test(r) || /Bash\(npm /.test(r) },
  { key: 'deploy', name: 'Deploy & tunnels', icon: 'server-2', test: (r) => /^Bash\((vercel|npx vercel|cloudflared|netlify) /.test(r) || /vercel/.test(r) },
  { key: 'files', name: 'Files & secrets', icon: 'lock', test: (r) => /^(Read|Edit|Write)\(/.test(r) },
  { key: 'web', name: 'Web & network', icon: 'magnifer', test: (r) => /^(WebFetch|WebSearch|Bash\(curl|Bash\(wget)/.test(r) },
  { key: 'apps', name: 'Connected apps', icon: 'layers', test: (r) => /^mcp__/.test(r) },
  { key: 'system', name: 'System', icon: 'monitor', test: (r) => /^Bash\((netstat|taskkill|kill|lsof|rm) /.test(r) },
];

export const PERM_CATEGORY_ORDER = [...PERM_MATCHERS.map((m) => m.key), 'other'];

export function classifyPermRule(rule) {
  for (const m of PERM_MATCHERS) if (m.test(rule)) return m.key;
  return 'other';
}

export const PERM_CATEGORY_META = (() => {
  const meta = {};
  for (const m of PERM_MATCHERS) meta[m.key] = { name: m.name, icon: m.icon };
  meta.other = { name: 'Other', icon: 'widget-2' };
  return meta;
})();

// ── Plain-English permission labels (grade-6) ────────────────────────────
// Turn a raw rule like "Bash(git push *)" into { label, desc } a non-coder
// can read. Ordered: most specific first. Anything unmatched falls back to a
// humanised guess so a new rule is never shown as raw syntax alone.
const FRIENDLY_RULES = [
  // Full-access wildcards (the "production" profile) — read clearly, not as "*".
  [/^Bash\(\*\)$/, 'Run any terminal command', 'Full terminal access — anything except the commands blocked below.'],
  [/^Read\(\*\)$/, 'Read any file', 'Open any file in the project, except the protected ones below.'],
  [/^(Edit|Write)\(\*\)$/, 'Change any file', 'Create or edit any file, except the protected ones below.'],
  // Git — danger first so force-push beats plain push
  [/^Bash\(git push (--force|-f)/, 'Force-overwrite history', 'Replace what’s on GitHub — this can erase saved work. Rarely needed.'],
  [/^Bash\(git push/, 'Upload to GitHub', 'Send your saved checkpoints up to the online backup.'],
  [/^Bash\(git pull/, 'Get the latest', 'Download the newest changes from the online copy.'],
  [/^Bash\(git init/, 'Start version history', 'Begin tracking changes for a project folder.'],
  [/^Bash\(git status/, 'Check what changed', 'See which files were edited since the last save.'],
  [/^Bash\(git diff/, 'See the exact edits', 'View line-by-line what was added or removed.'],
  [/^Bash\(git log/, 'See the history', 'Look through the list of past checkpoints.'],
  [/^Bash\(git show/, 'Open a checkpoint', 'Read the details of one saved change.'],
  [/^Bash\(git add/, 'Pick changes to save', 'Mark files to include in the next checkpoint.'],
  [/^Bash\(git restore/, 'Undo file changes', 'Put a file back to its last saved state.'],
  [/^Bash\(git commit/, 'Save a checkpoint', 'Record your current changes in the project’s history.'],
  [/^Bash\(git branch/, 'Manage versions', 'List or create separate lines of work.'],
  [/^Bash\(git (checkout|switch)/, 'Switch versions', 'Move between different lines of work.'],
  [/^Bash\(git remote/, 'Link to GitHub', 'Connect the project to its online home.'],
  [/^Bash\(git config/, 'Change git settings', 'Edit how git is set up on this computer.'],
  [/^Bash\(git -c/, 'Run git with custom settings', 'Use git with one-off settings applied.'],
  [/^Bash\(gh repo create/, 'Make a GitHub repo', 'Create a new online home for a project.'],
  [/^Bash\(gh repo edit/, 'Change repo settings', 'Edit an online project’s settings.'],
  [/^Bash\(gh repo delete/, 'Delete a GitHub repo', 'Permanently remove an online project.'],
  // Packages & build
  [/^Bash\(npm publish/, 'Publish a package', 'Release your code publicly for others to install.'],
  [/^Bash\(npm (install|i) -g/, 'Install a global tool', 'Add a tool to the whole computer, not just one project.'],
  [/^Bash\(npm ci\)/, 'Install exact building blocks', 'Download the project’s locked set of code libraries.'],
  [/^Bash\(npm install/, 'Install building blocks', 'Download the code libraries the project needs.'],
  [/^Bash\(npm test/, 'Run the tests', 'Check that the code still works the way it should.'],
  [/^Bash\(npm run/, 'Run project commands', 'Start the project’s own build, dev, and helper scripts.'],
  [/^Bash\((npx )?prisma/, 'Update the database', 'Set up and change the project’s database structure.'],
  [/^Bash\(npx next/, 'Run the website framework', 'Build and preview the Next.js site.'],
  [/^Bash\(npx tsc/, 'Check the code types', 'Make sure the code has no type mistakes.'],
  [/^Bash\(npx eslint/, 'Check code style', 'Scan the code for mistakes and messy patterns.'],
  [/^Bash\(npx shadcn/, 'Add interface pieces', 'Pull in ready-made UI components.'],
  // Deploy & tunnels
  [/^Bash\((npx )?vercel/, 'Put the site online', 'Deploy the project to the web with Vercel.'],
  [/^Bash\(cloudflared/, 'Open a preview tunnel', 'Make your local site viewable from another device.'],
  // Web
  [/^Bash\(curl/, 'Fetch from the web', 'Download data or a page from a web address.'],
  [/^WebFetch/, 'Read a web page', 'Open and read a page from the internet.'],
  // Files & secrets
  [/^Read\(\*\.pem\)|^Read\(id_rsa/, 'Read security keys', 'Open the private key files used for secure logins.'],
  [/^Read\(secrets\//, 'Read the secrets folder', 'Open files kept in the protected secrets folder.'],
  [/^(Edit|Write)\(\.env/, 'Change secret files', 'Edit the files that store passwords and API keys.'],
  [/^Read\(\.env/, 'Read secret files', 'Open the files that store passwords and API keys.'],
  // System
  [/^Bash\(netstat/, 'Check network ports', 'See which ports programs are using.'],
  [/^Bash\(taskkill/, 'Force-stop a program', 'Shut down a stuck program on this computer.'],
  [/^Bash\((rm -rf|rm -fr)/, 'Force-delete files', 'Permanently erase files and folders — no undo.'],
];

function prettyService(raw) {
  const cleaned = raw.replace(/^claude_ai_/, '').replace(/^plugin_/, '').replace(/_/g, ' ');
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function friendlyPermRule(rule) {
  for (const [re, label, desc] of FRIENDLY_RULES) {
    if (re.test(rule)) return { label, desc };
  }
  const mcp = rule.match(/^mcp__([a-z0-9_]+?)__(.+)$/i);
  if (mcp) {
    const svc = prettyService(mcp[1]);
    const act = mcp[2].replace(/_/g, ' ');
    return { label: `${svc}: ${act}`, desc: `Use the ${svc} connection to ${act}.` };
  }
  const rw = rule.match(/^(Read|Edit|Write)\((.+)\)$/);
  if (rw) {
    const verb = rw[1] === 'Read' ? 'Read' : 'Change';
    return { label: `${verb} certain files`, desc: `${verb} files matching ${rw[2]}.` };
  }
  const bash = rule.match(/^Bash\((.+)\)$/);
  if (bash) return { label: 'Run a terminal command', desc: `Runs: ${bash[1]}` };
  return { label: rule, desc: '' };
}

// Group a profile's permissions {allow,ask,deny} into categories.
// Returns ordered [{ key, name, icon, rules:[{ rule, color, group }] }]
export function groupPermissions(permissions) {
  const buckets = new Map();
  const push = (group, color, rule) => {
    const key = classifyPermRule(rule);
    if (!buckets.has(key)) buckets.set(key, { key, ...PERM_CATEGORY_META[key], rules: [] });
    buckets.get(key).rules.push({ rule, color, group });
  };
  for (const rule of permissions.allow || []) push('allow', 'green', rule);
  for (const rule of permissions.ask || []) push('ask', 'yellow', rule);
  for (const rule of permissions.deny || []) push('deny', 'red', rule);
  return PERM_CATEGORY_ORDER
    .filter((k) => buckets.has(k))
    .map((k) => buckets.get(k));
}
