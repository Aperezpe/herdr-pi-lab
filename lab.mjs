#!/usr/bin/env node
// Herdr Pi Lab from a shell or CI. JSON out; exit 0 pass, 1 an expectation failed, 2 the lab could not run.
import fs from 'node:fs';
import path from 'node:path';
import * as core from './core.mjs';
import { parse, locate } from './expectations.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flags = {}, pos = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith('--')) { const k = a.slice(2); if (['behind', 'wait', 'keep', 'keep-on-error'].includes(k)) flags[k] = true; else flags[k] = rest[++i]; }
  else pos.push(a);
}
const print = v => process.stdout.write(JSON.stringify(v, null, 2) + '\n');
const help = `herdr-pi-lab — grow and black-box test Pi roles in a private Herdr

  lab.mjs doctor [--project DIR]
  lab.mjs check ROLE [--project DIR]            parse the expectations, start nothing
  lab.mjs test ROLE --model provider/id [--tester-model provider/id] [--thinking LEVEL]
                    [--project DIR] [--behind] [--wait [--keep]] [--role-extension DIR]
  lab.mjs status RUN | list | stop RUN|all | leftovers

test opens a Herdr Lab window and returns its run at once; --wait blocks until
the Tester finishes, prints every verdict, and stops the lab unless --keep.`;

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
    case 'test': {
      const run = await core.start({ project, role: pos[0], model: flags.model, thinking: flags.thinking, testerModel: flags['tester-model'], testerThinking: flags['tester-thinking'] || flags.thinking, background: flags.behind, keepOnError: flags['keep-on-error'], roleExtension: flags['role-extension'] },
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
