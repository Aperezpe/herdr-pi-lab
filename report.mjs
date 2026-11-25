// The lab report: Markdown beside the agent's (or widget's) expectations, plus a screenshot of the lab window.
// The folder is run.roleDir in the real project: agents/<agent>/reports/ or widgets/<name>/reports/.
import fs from 'node:fs';
import path from 'node:path';
import * as core from './core.mjs';

const stamp = d => d.toISOString().replace(/[:]/g, '').replace(/\..*$/, '').replace('T', '-');
const fence = s => '~~~text\n' + String(s).replace(/~~~/g, '~ ~ ~').replace(/\s+$/, '') + '\n~~~';

export function writeReport(id, { summary, screens }) {
  const run = core.readRun(id), state = core.readState(id);
  // reportDir: sealed cases keep their reports beside the cases, never in the project.
  const dir = run.reportDir || path.join(run.roleDir, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, stamp(new Date()) + '-' + id);
  const shot = base + '.png';
  let shotOk = false;
  try { core.app(id, ['shot', shot], { timeout: 15000 }); shotOk = fs.existsSync(shot); } catch {}
  const passed = state.items.filter(i => i.verdict === 'pass').length;
  const failed = state.items.filter(i => i.verdict === 'fail').length, unproven = state.items.length - passed - failed;
  const head = passed === state.items.length ? 'All expectations met'
    : [failed && `${failed} of ${state.items.length} expectations failed`, unproven && `${unproven} unproven (the lab could not see enough to judge)`].filter(Boolean).join(', ');
  const lines = [
    `# ${run.role} · lab report`,
    '',
    `**${head}** · ${new Date().toLocaleString()} · run \`${id}\``,
    '',
    summary,
    '',
    run.kind === 'mod'
      ? `Mod: \`${run.mod.name}\` in the lab window${run.mod.layout ? ` with the \`${run.mod.layout}\` layout` : ''} · Installed: ${run.mod.installed.join(', ')} · Guest Main model: \`${run.model}\` · Tester model: \`${run.testerModel}\``
      : run.kind === 'widget'
      ? `Widget: \`${run.widget.name}\` on ${run.widget.sample ? 'its saved sample' : run.widget.live ? 'live data inside the lab ("lab": "live")' : 'its command line, run in the project copy'} · Widget model: \`${run.widget.model}\`${run.widget.override ? ` (--widget-model, this run only; widget.json says \`${run.widget.settingsModel}\`)` : ''} · Guest Main model: \`${run.model}\` · Tester model: \`${run.testerModel}\``
      : `Role: \`${run.command || '/agent ' + run.role}\`${run.customJob ? ' (job from agent.md)' : ' (starter agent)'} · Guest model: \`${run.model}\` · Tester model: \`${run.testerModel}\``,
    `Expectations: \`${run.kind === 'mod' ? run.expectations : path.relative(run.project, run.expectations)}\``,
    '',
  ];
  for (const i of state.items) {
    lines.push(`## ${i.verdict === 'pass' ? '✓' : i.verdict === 'unproven' ? '?' : '✗'} ${i.id} · ${i.title}`, '', i.reason || '', '');
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
