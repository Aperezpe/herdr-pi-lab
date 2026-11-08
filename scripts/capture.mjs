#!/usr/bin/env node
// Capture a real /lab session for lessons: open a Herdr Lab window running Pi with /lab and /role
// in PROJECT (a throwaway checkout you own), type into it, wait, and save window shots and pane text.
//   node scripts/capture.mjs open PROJECT [--model provider/id] [--thinking level]  → {"id","terminal"}
//   node scripts/capture.mjs send ID TEXT            type one line into Main, as a person would
//   node scripts/capture.mjs wait ID [--seconds N]   until Main is quiet; prints its screen
//   node scripts/capture.mjs shot ID OUT/NAME        OUT/NAME.png (window) and OUT/NAME.txt (Main's text)
//   node scripts/capture.mjs transcript ID OUT.txt   Main's whole conversation from its Pi session
//   node scripts/capture.mjs stop ID
// Set HERDR_PI_LAB_BEHIND=1 so this window and every lab it starts open behind your windows.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as core from '../core.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (k, d) => rest.includes(k) ? rest[rest.indexOf(k) + 1] : d;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const main = id => core.readRun(id).terminals.Main;

if (cmd === 'open') {
  const project = path.resolve(rest[0]);
  const model = flag('--model', 'anthropic/claude-sonnet-5-5');
  const id = 'lab-' + randomBytes(3).toString('hex');
  fs.mkdirSync(path.join(core.HOME, id), { recursive: true });
  core.writeRun(id, { id, role: 'capture', project, projectName: 'host', created: new Date().toISOString(), phase: 'capture', terminals: {} });
  const d = core.dirs(id);
  for (const p of [d.logs, d.config, d.sock]) fs.mkdirSync(p, { recursive: true });
  core.profile(d.agent);
  fs.mkdirSync(path.join(d.config, 'herdr-core'), { recursive: true });
  fs.writeFileSync(path.join(d.config, 'herdr-core', 'config.toml'), 'notes = false\n');
  const a = core.labApp();
  core.writeRun(id, { app: { bin: a.bin, bundle: a.bundle, version: a.version } });
  core.hc(id, ['server', 'start']);
  core.inheritLook(d.app, core.which('hc'));
  const e = core.env(id), vars = ['HC_SESSION', 'XDG_STATE_HOME', 'XDG_CONFIG_HOME', 'HERDR_APP_HOME', 'HERDR_APP_NO_SOUND', 'HERDR_TELEMETRY', 'PI_CODING_AGENT_DIR', 'PI_SKIP_VERSION_CHECK'];
  const behind = process.env.HERDR_PI_LAB_BEHIND === '1' ? ['-g'] : [];
  spawnSync('/usr/bin/open', ['-n', ...behind, '-a', a.bundle, ...vars.flatMap(k => ['--env', `${k}=${e[k]}`])], { env: e });
  for (let i = 0; i < 240 && !core.appJson(id, ['status'], { check: false }); i++) await sleep(500);
  const argv = [...core.piCommand(), '--no-extensions', '-e', path.join(core.HERE, 'index.ts'), '-e', core.roleExtension(project), '--no-skills', '--no-prompt-templates', '--name', 'Main', '--model', model, ...(flag('--thinking') ? ['--thinking', flag('--thinking')] : [])];
  const sp = core.appJson(id, ['do', 'space.new', JSON.stringify({ machine: '', name: flag('--space', path.basename(project)), folder: project, argv })]);
  core.writeRun(id, { terminals: { Main: sp.terminal }, model });
  await core.piReady(id, sp.terminal, 90);
  console.log(JSON.stringify({ id, terminal: sp.terminal, project, model }));
} else if (cmd === 'send') {
  core.hc(rest[0], ['send', main(rest[0]), rest.slice(1).join(' '), '--json'], { timeout: 20000 });
  console.log('sent');
} else if (cmd === 'wait') {
  const id = rest[0];
  await sleep(3000);
  const r = await core.settle(id, [main(id)], { quiet: Number(flag('--quiet', 8)), seconds: Number(flag('--seconds', 1500)) });
  console.log(JSON.stringify({ settled: r.settled }));
  console.log(core.screen(id, main(id)));
} else if (cmd === 'shot') {
  const [id, out] = rest; fs.mkdirSync(path.dirname(out), { recursive: true });
  core.app(id, ['shot', out + '.png']);
  fs.writeFileSync(out + '.txt', core.screen(id, main(id)));
  console.log('captured', out);
} else if (cmd === 'transcript') {
  const [id, out] = rest;
  fs.writeFileSync(out, core.transcriptText(core.transcript(id, 'Main')));
  // Keep the raw Pi sessions too (tool calls, lab results): the lab's folder is removed on stop.
  const root = path.join(core.dirs(id).agent, 'sessions'), raw = out.replace(/\.txt$/, '') + '-sessions';
  if (fs.existsSync(root)) fs.cpSync(root, raw, { recursive: true });
  console.log('wrote', out, fs.existsSync(raw) ? raw : '');
} else if (cmd === 'stop') {
  console.log(JSON.stringify(await core.stop(rest[0])));
} else {
  console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').filter(l => l.startsWith('//')).join('\n'));
}
