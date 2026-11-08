// Herdr Pi Lab core: a private Herdr (its own core, app home, Pi profile and
// project copy) with the role under test and a black-box Tester.
// Every hc and herdr-app call goes through env(run), so nothing here can reach
// the everyday Herdr core or window.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse, locate, job as roleJob, access as roleAccess, slug, panes as extraPanes } from './expectations.mjs';

export const VERSION = '0.1.0';
export const HERE = path.dirname(fileURLToPath(import.meta.url));
// Short on purpose: guest pane headers show their folder, e.g. ~/.herdr-lab/lab-1a2b3c/rentaplace.
export const HOME = process.env.HERDR_PI_LAB_HOME || path.join(os.homedir(), '.herdr-lab');
const mac = process.platform === 'darwin';
const BUNDLE_ID = 'dev.herdr.lab';
// macOS limits a Unix socket path to 103 bytes; keep core state short.
const SOCK_ROOT = path.join(mac ? '/private/tmp' : (process.env.XDG_RUNTIME_DIR || '/tmp'), 'hpl');

const mkdir = p => fs.mkdirSync(p, { recursive: true, mode: 0o700 });
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, v) => { mkdir(path.dirname(p)); const t = p + '.' + process.pid + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(t, p); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const ID_RE = /^lab-[0-9a-f]{6}$/;
// Roles /role already knows; any other name needs role.md.
export const STARTER_ROLES = ['critic', 'notes', 'research'];

export function dirs(id) {
  if (!ID_RE.test(id)) throw Error(`Not a lab run ID: ${id}`);
  const root = path.join(HOME, id);
  const name = readJson(path.join(root, 'run.json'), {}).projectName || 'project';
  return { root, run: path.join(root, 'run.json'), state: path.join(root, 'state.json'), project: path.join(root, name), agent: path.join(root, 'pi-agent'), app: path.join(root, 'app'), config: path.join(root, 'config'), logs: path.join(root, 'logs'), sock: path.join(SOCK_ROOT, id) };
}

/** The environment for one lab: the caller's ordinary variables minus anything that names another Herdr core, window or Pi profile. */
export function env(id, extra = {}) {
  const d = dirs(id), e = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(HC_|HERDR_(?!PI_LAB_)|PI_|XDG_(STATE|CONFIG|RUNTIME)_)/.test(k) && k !== 'TMUX') e[k] = v;
  return { ...e, HC_SESSION: id, XDG_STATE_HOME: path.join(d.sock, 'st'), XDG_CONFIG_HOME: d.config, HERDR_APP_HOME: d.app, HERDR_APP_NO_SOUND: '1', HERDR_TELEMETRY: '0', PI_CODING_AGENT_DIR: d.agent, PI_SKIP_VERSION_CHECK: '1', HERDR_PI_LAB_RUN: id, ...extra };
}
const socket = id => path.join(dirs(id).sock, 'st', 'herdr-core', id, id + '.sock');
export const coreUp = id => fs.existsSync(socket(id));

function run(cmd, args, { id, timeout = 30000, check = true, input } = {}) {
  const r = spawnSync(cmd, args, { env: id ? env(id) : process.env, encoding: 'utf8', timeout, input, maxBuffer: 64 << 20 });
  if (check && (r.error || r.status !== 0)) throw Error(`${path.basename(cmd)} ${args.slice(0, 2).join(' ')}: ${(r.error?.message || r.stderr || r.stdout || 'failed').trim().slice(0, 600)}`);
  return r.stdout || '';
}
// Output is one JSON document, or several JSON lines (hc send: receipt, then result). Take the last.
const parseJson = s => { const t = String(s).trim(); try { return JSON.parse(t); } catch {} const lines = t.split('\n').filter(Boolean); try { return JSON.parse(lines.at(-1)); } catch { return undefined; } };

export function which(name) {
  if (name === 'pi' && process.env.HERDR_PI_LAB_PI) return process.env.HERDR_PI_LAB_PI;
  // Personal wrappers in ~/.pi/bin can rewrite the profile; the lab starts the stock Pi.
  const wrappers = path.join(os.homedir(), '.pi', 'bin');
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (name === 'pi' && path.resolve(dir) === wrappers) continue;
    const p = path.join(dir, name);
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch {}
  }
}

/**
 * How to start the stock Pi as one process. /role matches its pane by the terminal's foreground
 * pid, so a shell shim that forks node would never match: start node and Pi's CLI directly.
 */
export function piCommand() {
  const cliRe = /pi-coding-agent.*\.(?:js|mjs)$/;
  if (process.env.HERDR_PI_LAB_PI) return [process.env.HERDR_PI_LAB_PI];
  if (cliRe.test(process.argv[1] || '') && fs.existsSync(process.argv[1])) return [process.execPath, process.argv[1]];
  const shim = which('pi'); if (!shim) throw Error('pi not on PATH.');
  const real = fs.realpathSync(shim);
  if (cliRe.test(real)) return [process.execPath, real];
  const text = fs.readFileSync(real, 'utf8').slice(0, 20000);
  const m = text.match(/"([^"]*\/node)"\s+"\$basedir\/([^"]*cli\.js)"/);
  if (m) { const cli = path.join(path.dirname(real), m[2]); if (fs.existsSync(cli)) return [m[1], cli]; }
  return [real];
}

// ---------- the lab's own Herdr app ----------

function sourceApp() {
  if (process.env.HERDR_PI_LAB_APP) return process.env.HERDR_PI_LAB_APP;
  if (mac) {
    for (const p of [path.join(os.homedir(), 'Applications/Herdr.app'), '/Applications/Herdr.app']) if (fs.existsSync(p)) return p;
    const cli = which('herdr-app');
    if (cli) { const real = fs.realpathSync(cli); const i = real.indexOf('.app/'); if (i > 0) return real.slice(0, i + 4); }
    throw Error('Herdr.app not found in ~/Applications or /Applications. Install the Herdr desktop app first.');
  }
  const cli = which('herdr-app'); if (!cli) throw Error('herdr-app not found on PATH. Install the Herdr desktop app first.'); return cli;
}

/** A cached copy of Herdr with its own identity, so macOS never confuses it with your everyday Herdr. */
export function labApp() {
  const src = sourceApp();
  if (!mac) return { bin: src, version: run(src, ['--version']).trim(), bundle: null, source: src };
  const plist = path.join(src, 'Contents/Info.plist');
  const version = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist]).trim();
  const exe = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', plist]).trim();
  const dest = path.join(HOME, 'app', version, 'Herdr Lab.app');
  const bin = path.join(dest, 'Contents/MacOS', exe);
  const ready = path.join(HOME, 'app', version, '.ready');
  if (!fs.existsSync(ready)) {
    fs.rmSync(path.dirname(dest), { recursive: true, force: true });
    mkdir(path.dirname(dest));
    run('/usr/bin/ditto', [src, dest], { timeout: 120000 });
    const p = path.join(dest, 'Contents/Info.plist');
    for (const [k, v] of [['CFBundleIdentifier', BUNDLE_ID], ['CFBundleName', 'Herdr Lab'], ['CFBundleDisplayName', 'Herdr Lab']]) {
      const has = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Print :${k}`, p]).status === 0;
      run('/usr/libexec/PlistBuddy', ['-c', has ? `Set :${k} ${v}` : `Add :${k} string ${v}`, p]);
    }
    // A changed Info.plist invalidates the original signature; sign the copy for this Mac only.
    run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', dest], { timeout: 120000 });
    fs.writeFileSync(ready, JSON.stringify({ source: src, version, bundleId: BUNDLE_ID }) + '\n');
  }
  return { bin, version, bundle: dest, source: src };
}

export function inheritLook(appHome, core) {
  const daily = path.join(os.homedir(), '.config', 'herdr-app');
  const src = readJson(path.join(daily, 'settings.json'), {});
  const keep = ['font', 'font_size', 'ui_font', 'zoom', 'theme', 'minimum_contrast', 'option_as_alt', 'appearance', 'colors', 'terminal_padding', 'divider', 'scrollback_lines'];
  const look = Object.fromEntries(keep.filter(k => k in src).map(k => [k, src[k]]));
  writeJson(path.join(appHome, 'settings.json'), { ...look, core, telemetry: false, sounds: { enabled: false }, updates: { check: false } });
  writeJson(path.join(appHome, 'shared.json'), { 'frame.welcomed': 'skipped' });
  for (const n of ['keys.json', 'update-notes.json']) if (fs.existsSync(path.join(daily, n))) fs.copyFileSync(path.join(daily, n), path.join(appHome, n));
  const themes = path.join(daily, 'themes');
  if (fs.existsSync(themes)) fs.cpSync(themes, path.join(appHome, 'themes'), { recursive: true, filter: s => !fs.lstatSync(s).isSymbolicLink() });
}

// ---------- the guest project and Pi profile ----------

// The role under test must not read its own expectations or reports: roles/ and expectations stay out.
const SKIP = /(^|\/)(roles|reports|\.git|node_modules|\.pi|\.cache|dist|build|\.next|\.venv|__pycache__)(\/|$)|(^|\/)\.env|(auth|credentials?|secrets?|tokens?)\.(json|txt|ya?ml)$|\.(pem|key|p12)$/i;
function copyProject(project, dest) {
  mkdir(dest);
  let files = [];
  const git = spawnSync('git', ['-C', project, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (git.status === 0) files = git.stdout.split('\0').filter(Boolean).filter(f => !/(^|\/)expectations\.md$/i.test(f));
  let bytes = 0, copied = 0;
  for (const f of files) {
    if (SKIP.test(f)) continue;
    const a = path.join(project, f); let s; try { s = fs.lstatSync(a); } catch { continue; }
    if (!s.isFile() || s.size > 2 << 20) continue;
    if ((bytes += s.size) > 40 << 20) break;
    mkdir(path.dirname(path.join(dest, f))); fs.copyFileSync(a, path.join(dest, f)); copied++;
  }
  spawnSync('git', ['init', '-q'], { cwd: dest });
  // One commit, so roles that ask Git (which commit, what changed, git add) see a real repository.
  const who = ['-c', 'user.name=Herdr Lab', '-c', 'user.email=lab@herdr.invalid', '-c', 'commit.gpgsign=false'];
  spawnSync('git', ['add', '-A'], { cwd: dest });
  const commit = spawnSync('git', [...who, 'commit', '-q', '--no-verify', '-m', 'Lab copy'], { cwd: dest });
  return { copied, bytes, git: git.status === 0, commit: commit.status === 0 };
}

export function profile(agentDir) {
  mkdir(agentDir);
  const daily = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
  // Links, not copies: your model logins stay in one place and are never duplicated.
  for (const f of ['auth.json', 'models.json']) { const a = path.join(daily, f); if (fs.existsSync(a)) fs.symlinkSync(a, path.join(agentDir, f)); }
  const s = readJson(path.join(daily, 'settings.json'), {});
  const keep = ['lastChangelogVersion', 'warnings', 'enabledModels', 'modelThinkingLevels', 'theme', 'quietStartup', 'defaultThinkingLevel'];
  writeJson(path.join(agentDir, 'settings.json'), { ...Object.fromEntries(keep.filter(k => k in s).map(k => [k, s[k]])), enableInstallTelemetry: false, quietStartup: true });
}

/** Find the /role extension the guest should load: explicit, the project's own copy, then installed packages. */
export function roleExtension(project, explicit) {
  const ok = d => d && fs.existsSync(path.join(d, 'index.ts')) && /herdr-pi-role|temporary-role/.test(readJson(path.join(d, 'package.json'), {}).name || path.basename(d));
  const candidates = [explicit, process.env.HERDR_PI_LAB_ROLE_EXTENSION,
    path.join(project, '.pi/extensions/temporary-role'), path.join(project, '.pi/extensions/herdr-pi-role'),
    path.join(project, '.pi/git/github.com/johnlindquist/herdr-pi-role'),
    path.join(os.homedir(), '.pi/agent/git/github.com/johnlindquist/herdr-pi-role'),
    path.join(os.homedir(), '.pi/agent/extensions/temporary-role')];
  for (const c of candidates) if (c && ok(path.resolve(c))) return path.resolve(c);
  throw Error('The /role extension was not found in this project. Install it here first (pi install --local git:github.com/johnlindquist/herdr-pi-role), or pass --role-extension PATH.');
}

// ---------- run registry ----------

export const readRun = id => readJson(dirs(id).run, undefined);
export const readState = id => readJson(dirs(id).state, undefined);
export const writeRun = (id, patch) => { const cur = readRun(id) || {}; const next = { ...cur, ...patch, updated: new Date().toISOString() }; writeJson(dirs(id).run, next); return next; };
export const writeState = (id, v) => writeJson(dirs(id).state, v);

export function list() {
  const root = HOME;
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter(n => ID_RE.test(n)).map(id => {
    const r = readRun(id) || { id }, s = readState(id);
    return { id, role: r.role, project: r.project, phase: r.phase, started: r.created, core: coreUp(id) ? 'running' : 'stopped', result: s?.result, counts: s ? tally(s) : undefined };
  }).sort((a, b) => String(b.started).localeCompare(String(a.started)));
}
export function tally(s) {
  const c = { pass: 0, fail: 0, pending: 0, total: s.items?.length || 0 };
  for (const i of s.items || []) c[i.verdict === 'pass' ? 'pass' : i.verdict === 'fail' ? 'fail' : 'pending']++;
  return c;
}

// ---------- terminals ----------

export const hc = (id, args, opt = {}) => run(which('hc') || 'hc', args, { id, ...opt });
export const hcJson = (id, args, opt) => parseJson(hc(id, [...args, '--json'], opt));
export const app = (id, args, opt = {}) => run(readRun(id).app.bin, args, { id, ...opt });
export const appJson = (id, args, opt) => parseJson(app(id, args, opt));

export function screen(id, t) { return hc(id, ['read', t], { check: false, timeout: 15000 }).replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, ''); }
export function term(id, t) { return hcJson(id, ['get', t], { check: false }) || {}; }

/**
 * What a guest pane has shown since it started, from its Pi session: prompts and replies as text.
 * A fullscreen pane only keeps its latest lines on screen; this keeps the whole conversation.
 * For the role, everything up to and including its own setup (the forked history and its job)
 * is left out, so the Tester still never sees the role's instructions.
 */
export function transcript(id, pane) {
  const root = path.join(dirs(id).agent, 'sessions');
  if (!fs.existsSync(root)) return [];
  const files = fs.readdirSync(root).flatMap(d => { const p = path.join(root, d); return fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter(f => f.endsWith('.jsonl')).map(f => path.join(p, f)) : []; });
  for (const f of files) {
    const entries = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return {}; } });
    const names = entries.filter(e => e.type === 'session_info').map(e => e.name);
    if (String(names.at(-1)).toLowerCase() !== String(pane).toLowerCase()) continue;
    let from = 0;
    const owner = entries.findIndex(e => e.type === 'custom' && e.customType === 'temporary-role.owner.v1');
    if (owner >= 0) from = owner + 1;
    else { const info = entries.findIndex(e => e.type === 'session_info'); from = Math.max(0, info); }
    const out = [];
    for (const e of entries.slice(from)) {
      if (e.type === 'message') {
        const m = e.message || {};
        const text = typeof m.content === 'string' ? m.content : (m.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
        if (!text.trim() || !['user', 'assistant'].includes(m.role)) continue;
        out.push({ at: e.timestamp, who: m.role === 'user' ? 'typed' : pane, text: text.trim() });
      } else if (e.type === 'custom_message' && e.customType === 'temporary-role.observation') out.push({ at: e.timestamp, who: 'lab', text: '(Main\'s new conversation reached this role)' });
      else if (e.type === 'custom' && e.customType === 'temporary-role.note.v1') { const t = e.data?.text || e.data?.message; out.push({ at: e.timestamp, who: 'lab', text: `(a role note arrived and waits for the next prompt${t ? `: ${String(t).slice(0, 300)}` : ''})` }); }
    }
    return out;
  }
  return [];
}
export const transcriptText = items => items.map(i => `[${i.who}] ${i.text}`).join('\n\n');

/** Terminal addresses shown in the lab window, with their Herdr pane ids. */
export function windowPanes(id) {
  const ls = appJson(id, ['ls'], { check: false }) || {};
  const out = [];
  for (const sp of ls.spaces || []) for (const tab of sp.tabs || []) for (const t of tab.terminals || []) if (t.pane) out.push({ terminal: t.terminal, pane: t.pane, app: t.app, space: sp.id, tab: tab.id });
  return out;
}

async function until(test, seconds, what) {
  const end = Date.now() + seconds * 1000;
  for (;;) { const v = await test(); if (v) return v; if (Date.now() > end) throw Error(`Timed out after ${seconds}s waiting for ${what}.`); await sleep(250); }
}
const stateOf = g => (g?.status && typeof g.status === 'object' ? g.status.state : g?.status);
const idle = g => ['idle', 'done'].includes(stateOf(g));
export async function piReady(id, t, seconds = 60) {
  return until(() => { const g = term(id, t); return idle(g) && /\S/.test(screen(id, t)) && g; }, seconds, `Pi in ${t}`);
}

/** Wait until every listed terminal has been quiet for `quiet` seconds (a watching role reacts after Main). */
export async function settle(id, terminals, { quiet = 4, seconds = 240 } = {}) {
  const end = Date.now() + seconds * 1000;
  let last = '', since = Date.now();
  for (;;) {
    const gs = terminals.map(t => term(id, t));
    const sig = gs.map(g => `${stateOf(g)}:${g.turn}`).join('|');
    const busy = gs.some(g => !idle(g));
    if (sig !== last) { last = sig; since = Date.now(); }
    if (!busy && Date.now() - since >= quiet * 1000) return { settled: true, terminals: Object.fromEntries(terminals.map((t, i) => [t, gs[i]])) };
    if (Date.now() > end) return { settled: false, terminals: Object.fromEntries(terminals.map((t, i) => [t, gs[i]])) };
    await sleep(400);
  }
}

/** Type one line into a guest pane exactly as a person would, then let the lab settle. */
export async function type(id, terminal, text, all, opt = {}) {
  hc(id, ['send', terminal, text, '--json'], { timeout: 20000 });
  // A prompt starts a turn; a slash command may not. Give either a moment to begin.
  await sleep(1500);
  return settle(id, all, opt);
}

// ---------- lifecycle ----------

export function doctor(project = process.cwd()) {
  const checks = [];
  const add = (name, fn) => { try { checks.push({ name, ok: true, detail: fn() }); } catch (e) { checks.push({ name, ok: false, detail: e.message }); } };
  add('platform', () => { if (!mac && process.platform !== 'linux') throw Error('macOS or Linux is required.'); return process.platform; });
  add('hc', () => { const p = which('hc'); if (!p) throw Error('hc (herdr-core) not on PATH.'); return run(p, ['--version']).trim(); });
  add('herdr app', () => { const s = sourceApp(); return s; });
  add('pi', () => { const p = which('pi'); if (!p) throw Error('pi not on PATH.'); return run(p, ['--version']).trim(); });
  add('/role extension', () => roleExtension(project));
  add('lab app copy', () => { const r = path.join(HOME, 'app'); return fs.existsSync(r) ? fs.readdirSync(r).join(', ') || 'none yet' : 'made on first start'; });
  return { ok: checks.every(c => c.ok), checks };
}

/**
 * Start a lab for one role. Steps: copy the project, start a private core and Herdr Lab window,
 * open guest Main, run the Before steps, open the role with /role, then open the Tester below it.
 */
export async function start(o, progress = () => {}) {
  const project = path.resolve(o.project || process.cwd());
  const role = String(o.role || '').trim();
  if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(role)) throw Error('Name the role to test, e.g. /lab test Critic (one word, up to 32 characters).');
  const loc = o.expectations ? { file: path.resolve(o.expectations), dir: path.dirname(path.resolve(o.expectations)) } : locate(project, role);
  if (loc.missing) throw Error(`No expectations for ${role} yet. Write ${path.relative(project, loc.file)}, or run /lab new ${role} to write them together.`);
  const markdown = fs.readFileSync(loc.file, 'utf8');
  const spec = parse(markdown, role);
  const customJob = roleJob(loc.dir);
  // /role gives any other name a placeholder job, so a new role must have its role.md before the lab runs.
  if (!customJob && !STARTER_ROLES.includes(role.toLowerCase())) throw Error(`${role} has no role.md yet. Write ${path.relative(project, path.join(loc.dir, 'role.md'))} with a "## Job" section first (or run /lab new ${role}).`);
  const ext = roleExtension(project, o.roleExtension);
  if (!o.model) throw Error('Choose the model the guest uses (provider/id).');
  const piBin = piCommand();
  const hcBin = which('hc'); if (!hcBin) throw Error('hc not on PATH.');

  const id = 'lab-' + randomBytes(3).toString('hex');
  mkdir(path.join(HOME, id));
  writeJson(path.join(HOME, id, 'run.json'), { id, projectName: (path.basename(project).toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || 'project').slice(0, 40) });
  const d = dirs(id);
  mkdir(d.root); mkdir(d.logs); mkdir(d.config); mkdir(d.sock);
  fs.writeFileSync(path.join(d.root, 'expectations.md'), markdown);
  const projectName = (path.basename(project).toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || 'project').slice(0, 40);
  const base = { id, version: VERSION, role, project, projectName, expectations: loc.file, roleDir: loc.dir, customJob: !!customJob, model: o.model, roleModel: o.roleModel || 'fast', testerModel: o.testerModel || o.model, created: new Date().toISOString(), phase: 'starting', terminals: {} };
  writeRun(id, base);
  writeState(id, { id, role, title: spec.title, items: spec.items.map(i => ({ id: i.id, title: i.title, verdict: null })), result: null });
  try {
    progress('Copying the project');
    const copied = copyProject(project, d.project);
    profile(d.agent);
    fs.cpSync(ext, path.join(d.root, 'role-extension'), { recursive: true, filter: s => !/node_modules|\.git$/.test(s) });
    mkdir(path.join(d.config, 'herdr-core'));
    fs.writeFileSync(path.join(d.config, 'herdr-core', 'config.toml'), 'notes = false\n');

    progress('Preparing Herdr Lab');
    const a = labApp();
    writeRun(id, { app: { bin: a.bin, bundle: a.bundle, version: a.version }, copied });
    hc(id, ['server', 'start'], { timeout: 20000 });
    inheritLook(d.app, hcBin);

    progress('Opening the Herdr Lab window');
    const vars = ['HC_SESSION', 'XDG_STATE_HOME', 'XDG_CONFIG_HOME', 'HERDR_APP_HOME', 'HERDR_APP_NO_SOUND', 'HERDR_TELEMETRY', 'PI_CODING_AGENT_DIR', 'PI_SKIP_VERSION_CHECK', 'HERDR_PI_LAB_RUN'];
    const e = env(id), log = path.join(d.logs, 'app.log');
    // HERDR_PI_LAB_BEHIND=1 opens every lab behind your windows (for unattended runs and captures).
    const behind = o.background || process.env.HERDR_PI_LAB_BEHIND === '1';
    if (a.bundle) run('/usr/bin/open', ['-n', ...(behind ? ['-g'] : []), '-a', a.bundle, ...vars.flatMap(k => ['--env', `${k}=${e[k]}`]), '--stdout', log, '--stderr', log], { id });
    else { const fd = fs.openSync(log, 'a'); const { spawn } = await import('node:child_process'); spawn(a.bin, [], { env: e, detached: true, stdio: ['ignore', fd, fd] }).unref(); }
    // The first launch of a freshly signed copy can take a while for macOS to verify.
    await until(() => appJson(id, ['status'], { check: false, timeout: 5000 }), 120, 'the Herdr Lab window');
    writeRun(id, { appPid: findAppPid(id) });

    progress('Starting guest Main');
    const think = o.thinking ? ['--thinking', o.thinking] : [];
    // Guest Main reads but doesn't run commands or edit: the lab tests the role, not Main's coding.
    // Guest Main stays read-only even for a work role: in one run a writable Main fixed the bug itself.
    const work = roleAccess(loc.dir) === 'work';
    const mainTools = o.mainTools || 'read,grep,find,ls';
    const mainArgv = [...piBin, '--no-extensions', '-e', path.join(d.root, 'role-extension'), '--tools', mainTools, '--no-skills', '--no-prompt-templates', '--no-themes', '--name', 'Main', '--model', o.model, ...think];
    const space = appJson(id, ['do', 'space.new', JSON.stringify({ machine: '', name: `Lab · ${role}`, folder: d.project, argv: mainArgv })], { timeout: 20000 });
    if (!space?.terminal) throw Error('Herdr Lab did not confirm guest Main.');
    const main = space.terminal;
    hc(id, ['label', main, 'lab.pane=Main'], { check: false });
    writeRun(id, { phase: 'main', terminals: { Main: main }, space: space.space });
    await piReady(id, main, 90);

    // Run lines set up the copy (plant a bug, seed data) before Main's first prompt; the lab runs them itself, not a model.
    const setup = [];
    for (const step of spec.before.filter(s => s.kind === 'run')) {
      progress(`Before: ${step.text.slice(0, 60)}`);
      const r = spawnSync('/bin/sh', ['-c', step.text], { cwd: d.project, env: env(id), encoding: 'utf8', timeout: 120000 });
      setup.push({ command: step.text, status: r.status, output: ((r.stdout || '') + (r.stderr || '')).slice(-2000) });
      writeRun(id, { setup });
      if (r.status !== 0) throw Error(`Before (line ${step.line}): "${step.text}" exited ${r.status ?? r.signal}: ${((r.stderr || r.stdout || '').trim().slice(-400)) || 'no output'}`);
    }
    for (const step of spec.before.filter(s => s.kind === 'do')) {
      if (step.pane !== 'Main') throw Error(`Before steps run in Main only (line ${step.line}).`);
      progress(`Before: ${step.text.slice(0, 60)}`);
      await type(id, main, step.text, [main], { quiet: 2 });
    }

    progress(`Opening ${role} with /role`);
    const known = new Set(windowPanes(id).map(p => p.terminal));
    // Roles are quick visual support and default to a fast model in /role (John, 2026-11-07); test them on what people will use.
    // A role whose role.md says "Access: work" changes files or runs commands, so it opens with --work.
    const cmd = `/role ${work ? '--work ' : ''}${role} --model ${o.roleModel || 'fast'}${customJob ? ' ' + customJob : ''}`;
    hc(id, ['send', main, cmd, '--json'], { timeout: 20000 });
    const opened = await until(() => windowPanes(id).find(p => !known.has(p.terminal)), 60, `the ${role} pane (check guest Main for an error)`);
    hc(id, ['label', opened.terminal, `lab.pane=${role}`], { check: false });
    await piReady(id, opened.terminal, 90);
    await settle(id, [main, opened.terminal], { quiet: 3, seconds: 120 });
    const terminals = { Main: main, [role]: opened.terminal };
    writeRun(id, { phase: 'role', terminals, command: cmd });

    progress('Opening the Tester');
    const testerArgv = [...piBin, '--no-extensions', '-e', path.join(HERE, 'tester', 'index.ts'), '--tools', 'lab_do,lab_look,lab_find,lab_verdict,lab_finish',
      '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-mcp', '--no-session', '--name', 'Tester',
      '--model', o.testerModel || o.model, ...(o.testerThinking ? ['--thinking', o.testerThinking] : []),
      '--append-system-prompt', path.join(HERE, 'tester', 'prompt.md'), '--lab-run', id, 'Begin the black-box test.'];
    const before = new Set(windowPanes(id).map(p => p.terminal));
    appJson(id, ['do', 'pane.split', JSON.stringify({ pane: opened.pane, direction: 'down', argv: testerArgv })], { timeout: 20000 });
    const tester = await until(() => windowPanes(id).find(p => !before.has(p.terminal)), 30, 'the Tester pane');
    hc(id, ['label', tester.terminal, 'lab.pane=Tester'], { check: false });
    for (const name of extraPanes(spec, role)) progress(`Note: the file names a pane "${name}" that this lab does not open.`);
    writeRun(id, { phase: 'testing', terminals: { ...terminals, Tester: tester.terminal } });
    progress('Tester running');
    return readRun(id);
  } catch (err) {
    writeRun(id, { phase: 'failed', error: err.message });
    if (!o.keepOnError) await stop(id).catch(() => {});
    err.run = id; throw err;
  }
}

function findAppPid(id) {
  const home = dirs(id).app;
  const out = spawnSync('/bin/ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8' }).stdout || '';
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/); if (!m || !/Herdr Lab\.app|herdr-app/.test(m[2])) continue;
    const e = spawnSync('/bin/ps', ['eww', '-p', m[1], '-o', 'command='], { encoding: 'utf8' }).stdout || '';
    if (e.includes(`HERDR_APP_HOME=${home}`)) return Number(m[1]);
  }
}

/** Stop exactly one lab: its terminals, its window, its core and its files. Reports are kept in the project. */
export async function stop(id, { keepFiles = false } = {}) {
  const d = dirs(id), r = readRun(id);
  if (!r) throw Error(`No lab named ${id}. /lab list shows the labs on this computer.`);
  const done = [];
  if (coreUp(id)) {
    for (const t of (hcJson(id, ['ls'], { check: false })?.terminals || [])) { hc(id, ['kill', t.address], { check: false }); }
    done.push('terminals ended');
  }
  const pid = r.appPid || findAppPid(id);
  if (pid && r.app) {
    app(id, ['do', 'app.quit'], { check: false, timeout: 5000 });
    for (let i = 0; i < 30 && alive(pid); i++) await sleep(200);
    if (alive(pid) && findAppPid(id) === pid) process.kill(pid, 'SIGTERM');
    done.push('window closed');
  }
  if (coreUp(id)) { hc(id, ['server', 'stop'], { check: false }); for (let i = 0; i < 50 && coreUp(id); i++) await sleep(100); done.push('core stopped'); }
  fs.rmSync(d.sock, { recursive: true, force: true });
  if (!keepFiles) fs.rmSync(d.root, { recursive: true, force: true }); else writeRun(id, { phase: 'stopped' });
  return { id, stopped: true, done, removed: keepFiles ? d.sock : d.root };
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

/** Anything a lab left running or on disk; must be empty after every stop. */
export function leftovers() {
  const runs = list().filter(r => r.core === 'running');
  const out = spawnSync('/bin/ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8' }).stdout || '';
  const procs = out.split('\n').filter(l => (l.includes(HOME + path.sep + 'lab-')) || l.includes('Herdr Lab.app')).map(l => l.trim()).filter(l => !l.includes('/bin/ps'));
  const sockets = fs.existsSync(SOCK_ROOT) ? fs.readdirSync(SOCK_ROOT) : [];
  return { runs: runs.map(r => r.id), processes: procs, sockets };
}

export { slug, parse, locate };
