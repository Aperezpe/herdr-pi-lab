// The lab report: Markdown beside the role's expectations, plus a screenshot of the lab window.
import fs from 'node:fs';
import path from 'node:path';
import * as core from './core.mjs';

const stamp = d => d.toISOString().replace(/[:]/g, '').replace(/\..*$/, '').replace('T', '-');
const fence = s => '~~~text\n' + String(s).replace(/~~~/g, '~ ~ ~').replace(/\s+$/, '') + '\n~~~';

export function writeReport(id, { summary, screens }) {
  const run = core.readRun(id), state = core.readState(id);
  const dir = path.join(run.roleDir, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, stamp(new Date()) + '-' + id);
  const shot = base + '.png';
  let shotOk = false;
  try { core.app(id, ['shot', shot], { timeout: 15000 }); shotOk = fs.existsSync(shot); } catch {}
  const passed = state.items.filter(i => i.verdict === 'pass').length;
  const lines = [
    `# ${run.role} · lab report`,
    '',
    `**${passed === state.items.length ? 'All expectations met' : `${state.items.length - passed} of ${state.items.length} expectations failed`}** · ${new Date().toLocaleString()} · run \`${id}\``,
    '',
    summary,
    '',
    `Role: \`${run.command || '/role ' + run.role}\`${run.customJob ? ' (job from role.md)' : ' (starter role)'} · Guest model: \`${run.model}\` · Tester model: \`${run.testerModel}\``,
    `Expectations: \`${path.relative(run.project, run.expectations)}\``,
    '',
  ];
  for (const i of state.items) {
    lines.push(`## ${i.verdict === 'pass' ? '✓' : '✗'} ${i.id} · ${i.title}`, '', i.reason || '', '');
    for (const e of i.evidence || []) lines.push(`- ${e.pane}: “${e.quote}”`);
    for (const a of i.absent || []) lines.push(`- Not on ${a.pane}: “${a.text}”`);
    for (const o of i.observed || []) lines.push(`- Lab check ${o.ok ? '✓' : '✗'} ${o.kind === 'see' ? 'shows' : 'does not show'} on ${o.pane}: “${o.text}”`);
    if (i.tester && i.tester !== i.verdict) lines.push(`- The Tester said ${i.tester}; the lab's own checks decided ${i.verdict}.`);
    lines.push('');
  }
  if (shotOk) lines.push(`![The lab window at the end of the run](${path.basename(shot)})`, '');
  lines.push('## What each pane showed', '');
  for (const [k, s] of Object.entries(screens)) lines.push(`### ${k}`, '', fence(s.length > 8000 ? '…' + s.slice(-8000) : s), '');
  const file = base + '.md';
  fs.writeFileSync(file, lines.join('\n'));
  return { file, shot: shotOk ? shot : undefined };
}
