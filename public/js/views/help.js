// Help view — short, plain-language guide: how to open the app, how each
// section works, and copy-paste prompts so an AI can set everything up.
// All static content rendered through el()/textContent; the only
// interactivity is the copy buttons.
import { el, icon, toast } from '../ui.js';

let container = null;

export async function helpView(root) {
  container = root;
  render();
}

async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied', what + ' is on your clipboard. Paste it to your AI.');
  } catch {
    toast('Copy failed', 'Select the text and copy it yourself.', 'err');
  }
}

// The prompt itself — just the dark recess, no header bar. Copying lives in
// the card's title row as an icon button.
function promptBox(text) {
  return el('div', { class: 'help-prompt' },
    el('pre', { class: 'help-prompt-text mono', text }),
  );
}

// Cards are subgrids: each part (head / text / bullets / prompt) sits in a
// shared row track, so cards in the same row keep identical section heights.
// The span must equal the number of parts this card actually has.
function card({ iconName, title, what, how, prompt, promptName, span, primary }) {
  const parts = [
    el('div', { class: 'help-card-head' },
      el('span', { class: 'cat-icon' }, icon(iconName, { size: 18 })),
      el('span', { class: 'cat-name grow', text: title }),
      prompt ? el('button', {
        class: 'icon-btn' + (primary ? ' help-copy-brand' : ''),
        type: 'button', title: 'Copy prompt', 'aria-label': 'Copy prompt',
        onclick: () => copyText(prompt, promptName || title + ' prompt'),
      }, icon('copy', { size: 16 })) : null,
    ),
    what ? el('p', { class: 'help-what', text: what }) : null,
    how && how.length ? el('ul', { class: 'help-how' }, ...how.map((h) => el('li', { text: h }))) : null,
    prompt ? promptBox(prompt) : null,
  ].filter(Boolean);
  return el('div', {
    class: 'cm-soft-card help-card' + (span ? ' help-span' : ''),
    style: 'grid-row: span ' + parts.length,
  }, ...parts);
}

const MASTER_PROMPT = `Help me set up my ICM Protocols panel — the dashboard that controls what you (my AI) may do. Two ground rules first:
- Keep the standard ICM Protocols structure exactly as shipped. Read docs/BLUEPRINT.md in the app folder and follow it. If the folders don't exist yet, run: node tools/init-brain.mjs
- I may not know what to allow or block. You lead: suggest safe defaults, explain each one in a single plain sentence, and let me say yes or change it. Never leave me with an open question I can't answer.

Ask me short questions, one topic at a time. After each topic, tell me exactly what to put in that section (or set it yourself if you can).

1. Me: What do I build? What tools do I use (hosting, database, email)?
2. Rules: Build three lists. GREEN = do it and tell me. YELLOW = ask me first (pushing, deploys, sending anything, spending money). RED = never (secrets, force-push, production data, deleting things). Suggest a starter board, then refine it with me.
3. Connections: For each app you can touch, set read / write / delete to allow, ask, or block. Default: read = allow, write = ask, delete = block.
4. Secrets: Which projects have .env files? Confirm the rules: never committed to git, never repeated back in chat, never logged. You may read them to work — never edit or reveal them.
5. Skills: Ask which tasks I repeat, then draft a slash-command skill for each (name, when to use it, steps).
6. Security: Pick an audit schedule per project. Check with me: two-factor login is on, backups exist, no secrets in git, servers only listen on localhost.
7. Permissions: Match my profiles (prototype = loose, production = strict, client work = strictest) to the rules from step 2.

Finish with a checklist I can verify page by page.`;

const SECTIONS = [
  {
    iconName: 'widget-2', title: 'Rules',
    what: 'Three lists that control your AI. Green = just do it. Yellow = ask first. Red = never.',
    how: [
      'Add a rule in plain words. It gets a number for life.',
      'Press Update foundation to save it for real.',
    ],
    prompt: `Help me build my AI rules board. Ask what I build, then suggest rules in three lists: GREEN (do it and report), YELLOW (ask me first — pushing code, deploys, publishing, sending emails, spending money), RED (never — secrets, force-push, production data, deleting things). One short sentence per rule. Refine with me until I approve.`,
  },
  {
    iconName: 'layers', title: 'Connections',
    what: 'What each connected app (email, database, hosting) may do.',
    how: [
      'Open an app. Flip each part to allow, ask, or block.',
      'Safe default: read = allow, write = ask, delete = block.',
      'Logos appear on their own. For sharper ones, paste a free Brandfetch ID in the logo settings.',
    ],
    prompt: `Help me set app permissions for my AI. For each app I name, split it into read / write / delete and suggest allow, ask, or block. Start from read = allow, write = ask, delete = block. Go app by app.`,
  },
  {
    iconName: 'code-2', title: 'Skills',
    what: 'Shortcut commands for your AI terminal. Made here, ready next launch.',
    how: [
      'New skill asks for a name, what it does, and the steps.',
      'Deleting a skill archives it — nothing is lost.',
    ],
    prompt: `Help me make AI skills (slash-commands). Ask which tasks I repeat — deploys, setups, reports. For each, draft: a short name, one line saying when to use it, and the steps. One job per skill.`,
  },
  {
    iconName: 'database', title: 'Secrets',
    what: 'Your keys and passwords. Hidden by default. They never leave this computer.',
    how: [
      'Pick a project, then a file, then edit keys.',
      'Set a reveal password (8+ characters) the first time.',
      'Your AI may read keys to work — never edit or repeat them.',
    ],
    prompt: `Help me clean up my project secrets. Ask which projects have .env files. Check each one is gitignored, with a safe .env.example (names only, no values). Suggest clear key names like RESEND_API_KEY. Remember: you may read secrets to work, never edit or repeat them.`,
  },
  {
    iconName: 'folder-2', title: 'Memory',
    what: 'The notes and rules your AI reads every session.',
    how: [
      'Pick a file in the tree and edit it. Every save keeps a backup.',
      'System files ask twice before saving.',
    ],
    prompt: `Help me write my AI's memory files. Ask me: how I like to work, my code style, my design taste, and mistakes to never repeat. Then draft short markdown notes — one topic each, written as clear instructions to the AI, each under one page.`,
  },
  {
    iconName: 'shield-check', title: 'Security',
    what: 'A safety score for each project, built from real audits.',
    how: [
      'The /security-audit skill comes bundled — run it in your AI terminal and this page updates itself.',
      'Open a project to see problems, fixes, and history.',
    ],
    prompt: `Act as my security auditor. Check this project for: secrets in git (history too), missing .gitignore lines, servers open beyond localhost, risky dependencies, and missing backups. For each finding give: severity, file and line, what could go wrong, and the fix. Fix what I approve.`,
  },
  {
    iconName: 'lock', title: 'Permissions',
    what: 'The exact allow / ask / block lists your AI runs under.',
    how: [
      'Three profiles: prototype (loose), production (strict), client work (strictest).',
      'Flip a rule with the toggle. Save with the floating pill.',
    ],
    prompt: `Review my AI permission profiles (prototype, production, client-work). Flag anything risky sitting in allow (deletes, force-push, publishing, spending) and anything harmless stuck in ask. Explain each change in one line first.`,
  },
];

function render() {
  const wrap = el('div', { class: 'help-page' });

  wrap.append(card({
    iconName: 'question-circle', title: 'What is this?',
    what: 'This panel controls your AI helper. Each page edits the real files the AI reads.',
    how: [
      'Changes count on the AI’s NEXT session — restart the CLI after big edits.',
      'First time? Go top to bottom: Rules → Connections → Skills → Secrets → Memory → Security → Permissions.',
      'Everything stays on this computer.',
    ],
  }));

  wrap.append(card({
    iconName: 'monitor', title: 'Open the app',
    what: 'Needs Node 20 or newer (free at nodejs.org). Works the same on every computer.',
    how: [
      'First time? Run: node tools/init-brain.mjs — it builds the standard folders with starter rules. It never touches files you already have.',
      'Then run: node server.js',
      'Your browser opens on its own. If not, go to http://127.0.0.1:7717 — that address always means "this computer", so nothing goes online.',
      'On Windows you can also double-click "Start ICM Protocols.cmd".',
      'Custom folder locations: copy data/app-config.example.json to app-config.json and edit the paths.',
    ],
  }));

  wrap.append(card({
    iconName: 'magic-stick-3', title: 'Let AI set it up', span: true, primary: true,
    what: 'Copy this prompt into your AI (Claude Code or any chat AI). It asks you simple questions, then fills in every page with you.',
    prompt: MASTER_PROMPT, promptName: 'The master setup prompt',
  }));

  wrap.append(el('div', { class: 'cm-h4 help-section-title help-span' },
    el('span', { text: 'Page by page' }),
    el('span', { class: 'sec-count-pill', text: String(SECTIONS.length) })));
  for (const s of SECTIONS) wrap.append(card(s));

  container.append(wrap);
}
