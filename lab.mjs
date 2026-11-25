#!/usr/bin/env node
// Herdr Pi Lab from a shell or CI. JSON out; exit 0 pass, 1 an expectation failed, 2 the lab could not run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as core from './core.mjs';
import { parse, locate, locateWidget } from './expectations.mjs';
import { adHocCheck, headline, locateScenarios, parseScenarios, pickChecks } from './scenarios.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flags = {}, pos = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith('--')) { const k = a.slice(2); if (['behind', 'wait', 'keep', 'keep-on-error', 'detached', 'sealed'].includes(k)) flags[k] = true; else flags[k] = rest[++i]; }
  else pos.push(a);
}
const print = v => process.stdout.write(JSON.stringify(v, null, 2) + '\n');
const help = `herdr-pi-lab — grow and black-box test Pi agents in a private Herdr

  lab.mjs doctor [--project DIR]
  lab.mjs check ROLE [--project DIR]            parse the expectations, start nothing
  lab.mjs test AGENT --model provider/id [--agent-model provider/id|main|fast] [--tester-model provider/id] [--thinking LEVEL]
                    [--project DIR] [--behind] [--wait [--keep]] [--agent-extension DIR]
  lab.mjs test WIDGET --model provider/id [--widget-model provider/id] [--tester-model provider/id] [--project DIR] [--behind] [--wait [--keep]]
                    a widget in widgets/<name>/ with expectations.md; --widget-model is for this run only
  lab.mjs test lab-scenarios.md [CHECK] --model provider/id [--project DIR] [--behind|--detached] [--keep]
                    run the checks in a scenarios file (CHECK: a number, "first", or words such as /split)
  lab.mjs test --say "Open a pane, run ls, close the pane." --model provider/id
                    run one check described in plain words
  lab.mjs test AGENT --cases FILE [--sealed] [--runs N] --model provider/id [--agent-model ...] [--tester-model ...]
                    run expectations kept outside the project, N times (default 3). With --sealed, print only
                    "✓|✗ agent · sealed case N · P of R passed"; reports, progress and errors go beside FILE only
  lab.mjs scenarios [FILE] [CHECK] [--project DIR]   parse the checks, start nothing
  lab.mjs status RUN | list | stop RUN|all | leftovers

test opens a Herdr Lab window and returns its run at once; --wait blocks until
the Tester finishes, prints every verdict, and stops the lab unless --keep.
A check always waits for the lab agent, prints every step, and stops the lab unless --keep.
--detached runs a check with no window: panes are terminals in the lab's own core, so there
is no screenshot and /split (which needs a Herdr pane) cannot open one.`;

try {
  const project = path.resolve(flags.project || process.cwd());
  switch (cmd) {
    case undefined: case 'help': case '--help': console.log(help); break;
    case 'doctor': { const d = core.doctor(project); print(d); process.exitCode = d.ok ? 0 : 2; break; }
    case 'check': { const loc = locate(project, pos[0]); print({ file: loc.file, ...parse(fs.readFileSync(loc.file, 'utf8'), pos[0]) }); break; }
    case 'list': print(core.list()); break;
    case 'leftovers': print(core.leftovers()); break;
    case 'status': print({ run: core.readRun(pos[0]), state: core.readState(pos[0]), core: core.coreUp(pos[0]) ? 'running' : 'stopped' }); break;
    case 'stop': { const ids = pos[0] === 'all' ? core.list().map(r => r.id) : [pos[0]]; const out = []; for (const id of ids) out.push(await core.stop(id)); print(out); break; }
    case 'scenarios': print(pickChecks(parseScenarios(fs.readFileSync(locateScenarios(project, pos[0]), 'utf8')), pos.slice(1).join(' '))); break;
    case 'test': {
      if (flags.cases) { await runCases(project); break; }
      if (flags.say || /\.md$/i.test(pos[0] || '')) {
        const file = flags.say ? undefined : locateScenarios(project, pos[0]);
        const checks = flags.say ? [{ ...adHocCheck(flags.say), adHoc: true }] : pickChecks(parseScenarios(fs.readFileSync(file, 'utf8')), pos.slice(1).join(' '));
        const out = [];
        for (const check of checks) {
          const { outcome } = await core.startCheck({ project, check, source: file ? `${path.relative(project, file)} · ${check.id} · ${check.title}` : undefined, model: flags.model, background: flags.behind, detached: flags.detached, keep: flags.keep, keepOnError: flags['keep-on-error'], seconds: Number(flags.timeout || 900) },
            step => process.stderr.write(`· ${step}\n`));
          const o = await outcome;
          out.push({ run: o.run, check: `${check.id} · ${check.title}`, result: o.result, headline: o.error ? undefined : headline(check, o.items), report: o.report, shot: o.shot, steps: o.items, error: o.error });
        }
        print(out);
        process.exitCode = out.every(o => o.result === 'pass') ? 0 : out.some(o => o.result === 'unfinished') ? 2 : 1;
        break;
      }
      // A widget in widgets/<name>/ with expectations, and no agent of that name, is tested as a widget.
      const w = locateWidget(project, pos[0] || '');
      const start = w && !w.missing && locate(project, pos[0]).missing ? core.startWidget : core.start;
      const run = await start({ project, role: pos[0], model: flags.model, widgetModel: flags['widget-model'], roleModel: flags['agent-model'] || flags['role-model'], thinking: flags.thinking, testerModel: flags['tester-model'], testerThinking: flags['tester-thinking'] || flags.thinking, background: flags.behind, keepOnError: flags['keep-on-error'], roleExtension: (flags['agent-extension'] || flags['role-extension']) },
        step => process.stderr.write(`· ${step}\n`));
      if (!flags.wait) { print({ started: true, run: run.id, terminals: run.terminals }); break; }
      const end = Date.now() + Number(flags.timeout || 900) * 1000;
      let s;
      for (;;) {
        s = core.readState(run.id); const r = core.readRun(run.id);
        if (s?.report || r?.phase === 'failed' || Date.now() > end) break;
        await new Promise(res => setTimeout(res, 2000));
      }
      const r = core.readRun(run.id);
      print({ run: run.id, result: s?.result || 'unfinished', report: s?.report, shot: s?.shot, items: s?.items, error: r?.error });
      if (!flags.keep) await core.stop(run.id);
      process.exitCode = s?.result === 'pass' ? 0 : s?.result === 'fail' ? 1 : 2;
      break;
    }
    default: console.error(help); process.exitCode = 2;
  }
} catch (e) { print({ error: e.message, run: e.run }); process.exitCode = 2; }

/**
 * Run one agent's cases from a file outside the project, --runs times, one lab per run.
 * --sealed: stdout gets one bare line per case and nothing else; titles, questions, verdict reasons, progress
 * and errors go to a details file beside the cases, and the labs themselves live in a .lab folder there.
 */
async function runCases(project) {
  const role = String(pos[0] || '').trim();
  const runs = Math.max(1, Number(flags.runs || 3) | 0);
  const sealed = !!flags.sealed;
  const given = path.resolve(String(flags.cases).replace(/^~(?=\/|$)/, os.homedir()));
  const name = (role ? slugOf(role) : 'agent');
  let file, home, details, log = [], results = [], count = 0, early;
  const say = sealed ? s => log.push(`${new Date().toISOString()} ${s}`) : s => process.stderr.write(`· ${s}\n`);
  try {
    early = 'the cases file';
    file = fs.realpathSync(given);
    home = path.dirname(file);
    const inProject = rel => !rel.startsWith('..') && !path.isAbsolute(rel);
    if (inProject(path.relative(fs.realpathSync(project), file))) throw Error('The cases file is inside the project. Keep it in a folder outside it.');
    details = path.join(home, 'reports', `${new Date().toISOString().replace(/[:]/g, '').replace(/\..*$/, '').replace('T', '-')}-${name}-cases.json`);
    if (sealed) core.useHome(path.join(home, '.lab'));
    early = undefined;
    count = parse(fs.readFileSync(file, 'utf8'), role).items.length;
    for (let k = 1; k <= runs; k++) {
      let id, row = { n: k };
      try {
        say(`run ${k} of ${runs}`);
        const run = await core.start({ project, role, cases: file, reportDir: path.dirname(details), model: flags.model, roleModel: flags['agent-model'] || flags['role-model'], thinking: flags.thinking, testerModel: flags['tester-model'], testerThinking: flags['tester-thinking'] || flags.thinking, background: sealed || flags.behind, keepOnError: flags['keep-on-error'], roleExtension: flags['agent-extension'] || flags['role-extension'] }, say);
        id = row.run = run.id;
        const end = Date.now() + Number(flags.timeout || 900) * 1000;
        let s;
        for (;;) {
          s = core.readState(id); const r = core.readRun(id);
          if (s?.report || r?.phase === 'failed' || Date.now() > end) { row.error = r?.error || (s?.report ? undefined : 'timed out'); break; }
          await new Promise(res => setTimeout(res, 2000));
        }
        Object.assign(row, { result: s?.result || 'unfinished', report: s?.report, items: s?.items || [] });
      } catch (e) { row.run ||= e.run; row.result = 'unfinished'; row.error = e.message; id ||= e.run; }
      finally { if (id && !flags.keep) await core.stop(id).catch(e => { row.stopError = e.message; }); }
      results.push(row);
    }
  } catch (e) { log.push(`error: ${e.message}`); if (early) early = e.message; if (!sealed) throw e; }
  const passes = Array.from({ length: count }, (_, i) => results.filter(r => r.items?.find(it => it.id === i + 1)?.verdict === 'pass').length);
  const lines = passes.map((p, i) => `${p === runs ? '✓' : '✗'} ${name} · ${sealed ? 'sealed ' : ''}case ${i + 1} · ${p} of ${runs} passed`);
  if (details) {
    fs.mkdirSync(path.dirname(details), { recursive: true, mode: 0o700 });
    fs.writeFileSync(details, JSON.stringify({ cases: file, agent: role, runs, model: flags.model, finished: new Date().toISOString(), lines, results, log }, null, 2) + '\n', { mode: 0o600 });
  }
  // A case set that never ran must not look like a pass.
  if (!count) lines.push(`✗ ${name} · ${sealed ? 'sealed ' : ''}cases did NOT run${early ? ` · ${early}` : details ? ' · details beside the cases' : ''}`);
  // early: failed before the file was read, so the message holds no case text.
  if (sealed) process.stdout.write(lines.join('\n') + '\n');
  else print({ lines, details, results });
  process.exitCode = !count || results.every(r => r.result === 'unfinished') ? 2 : passes.every(p => p === runs) ? 0 : 1;
}
function slugOf(s) { return String(s).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''); }
