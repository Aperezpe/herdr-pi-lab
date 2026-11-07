#!/usr/bin/env node
// Capture /lab's built-in guidance in a real Herdr Lab window: examples after a space,
// dim hints, Tab completion and --help. Writes PNG window shots and the pane text.
//   node scripts/showcase.mjs <project-with-roles> <out-dir> [--model provider/id]
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import * as core from '../core.mjs';

const [project, out] = process.argv.slice(2).map(p => path.resolve(p));
const model = process.argv.includes('--model') ? process.argv[process.argv.indexOf('--model') + 1] : 'anthropic/claude-haiku-5-5';
fs.mkdirSync(out, { recursive: true });
const id = 'lab-' + randomBytes(3).toString('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(path.join(core.HOME, id), { recursive: true });
core.writeRun(id, { id, role: 'showcase', project, projectName: path.basename(project), created: new Date().toISOString(), phase: 'showcase', terminals: {} });
const d = core.dirs(id);
for (const p of [d.logs, d.config, d.sock, d.project]) fs.mkdirSync(p, { recursive: true });
fs.cpSync(project, d.project, { recursive: true, filter: s => !/\/(\.git|\.pi|node_modules|reports)(\/|$)/.test(s) });
core.profile(d.agent);
fs.mkdirSync(path.join(d.config, 'herdr-core'), { recursive: true });
fs.writeFileSync(path.join(d.config, 'herdr-core', 'config.toml'), 'notes = false\n');
const a = core.labApp();
core.writeRun(id, { app: { bin: a.bin, bundle: a.bundle, version: a.version } });
core.hc(id, ['server', 'start']);
core.inheritLook(d.app, core.which('hc'));
const e = core.env(id), vars = ['HC_SESSION', 'XDG_STATE_HOME', 'XDG_CONFIG_HOME', 'HERDR_APP_HOME', 'HERDR_APP_NO_SOUND', 'HERDR_TELEMETRY', 'PI_CODING_AGENT_DIR', 'PI_SKIP_VERSION_CHECK'];
const { spawnSync } = await import('node:child_process');
spawnSync('/usr/bin/open', ['-n', '-g', '-a', a.bundle, ...vars.flatMap(k => ['--env', `${k}=${e[k]}`])], { env: e });
for (let i = 0; i < 240 && !core.appJson(id, ['status'], { check: false }); i++) await sleep(500);
core.writeRun(id, {});
const roleExt = core.roleExtension(project);
const argv = [...core.piCommand(), '--no-extensions', '-e', path.join(core.HERE, 'index.ts'), '-e', roleExt, '--no-skills', '--no-prompt-templates', '--name', 'Main', '--model', model];
const sp = core.appJson(id, ['do', 'space.new', JSON.stringify({ machine: '', name: path.basename(project).replace(/^./, c => c.toUpperCase()), folder: d.project, argv })]);
const t = sp.terminal;
core.writeRun(id, { terminals: { Main: t } });
await core.piReady(id, t, 90);
await sleep(1500);
const keys = (...k) => core.hc(id, ['keys', t, ...k]);
const typeText = async s => { for (const ch of s) { keys(ch === ' ' ? 'space' : /[A-Z]/.test(ch) ? 'shift+' + ch.toLowerCase() : ch); await sleep(60); } await sleep(700); };
const shot = async name => { await sleep(900); core.app(id, ['shot', path.join(out, name + '.png')]); fs.writeFileSync(path.join(out, name + '.txt'), core.screen(id, t)); console.log('captured', name); };
const clear = async () => { keys('esc'); await sleep(200); keys('ctrl+u'); await sleep(200); for (let i = 0; i < 40; i++) keys('backspace'); await sleep(400); };
if (process.argv.includes('--open-only')) { console.log(JSON.stringify({ id, terminal: t, project: d.project })); process.exit(0); }
try {
  await typeText('/lab'); await shot('01-lab-typed-hint');
  await typeText(' '); await shot('02-space-examples');
  keys('down'); await sleep(300); await shot('03-examples-second-selected');
  keys('tab'); await sleep(500); await shot('04-tab-inserted-example');
  await clear(); await typeText('/lab test '); await shot('05-test-role-choices');
  keys('tab'); await sleep(500); await shot('06-test-role-tab');
  await typeText('--model '); await shot('07-model-hint');
  await clear(); await typeText('/lab new '); await shot('08-new-hint');
  await typeText('Concierge'); await shot('09-new-role-hint');
  await clear(); await typeText('/lab --help'); await shot('10-help-typed');
  keys('enter'); await sleep(1500); await shot('11-help-guide');
  await clear(); await typeText('/lab doctor'); keys('enter'); await sleep(2500); await shot('12-doctor');
} finally {
  if (!process.argv.includes('--keep')) console.log(JSON.stringify(await core.stop(id)));
  else console.log('kept', id);
}
