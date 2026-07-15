// Appenders for the brain's two logs. Formats match the documented ones.
import { PATHS } from './config.js';
import { appendTracked } from './fsio.js';

function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

// - YYYY-MM-DD HH:MM | ui | action | target | note
export async function logActivity(action, target, note) {
  const { date, time } = now();
  const clean = (s) => String(s).replace(/[\r\n|]+/g, ' ').trim();
  const line = `- ${date} ${time} | ui | ${clean(action)} | ${clean(target)} | ${clean(note)}`;
  return appendTracked(PATHS.activityLog, line);
}

export async function logMemoryChange({ title, color, trigger, rules, files }) {
  const { date } = now();
  const clean = (s) => String(s).replace(/\r?\n/g, ' ').trim();
  const block = [
    '',
    `## ${date} - ${clean(title)}`,
    '',
    '- Scope: Global',
    `- Color: ${clean(color || 'Green (owner edit via Protocols UI)')}`,
    `- Trigger: ${clean(trigger || 'Protocols UI save')}`,
    '- Normalized rule:' + (rules && rules.length === 1 ? ' ' + clean(rules[0]) : ''),
    ...(rules && rules.length > 1 ? rules.map((r) => `  - ${clean(r)}`) : []),
    `- Files changed: ${clean(files)}`,
  ].join('\n');
  return appendTracked(PATHS.memoryChanges, block);
}
