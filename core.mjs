// Herdr Pi Lab core: a private Herdr (its own core, app home, Pi profile and
// project copy) with the agent under test and a black-box Tester.
// Every hc and herdr-app call goes through env(run), so nothing here can reach
// the everyday Herdr core or window.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse, locate, locateWidget, locateMod, job as roleJob, access as roleAccess, slug, panes as extraPanes } from './expectations.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8')).version; } catch { return 'unknown'; } })();
// The lab's own folder. Short on purpose: lab pane headers show the project copy, e.g. ~/.lab/rentaplace.
export let HOME = process.env.HERDR_PI_LAB_HOME || path.join(os.homedir(), '.lab');
/** Move this process's labs (runs, project copies, app state) to dir; the lab window and its Tester inherit it. Sealed cases use a folder inside the sealed folder. */
export function useHome(dir) { HOME = path.resolve(dir); process.env.HERDR_PI_LAB_HOME = HOME; }
// Labs started before 0.4.0 lived in ~/.herdr-lab; /lab list and /lab stop still find them.
const LEGACY_HOME = process.env.HERDR_PI_LAB_HOME ? undefined : path.join(os.homedir(), '.herdr-lab');
const rootOf = id => { const here = path.join(HOME, id); return !fs.existsSync(here) && LEGACY_HOME && fs.existsSync(path.join(LEGACY_HOME, id)) ? path.join(LEGACY_HOME, id) : here; };
const mac = process.platform === 'darwin';
const BUNDLE_ID = 'dev.herdr.lab';
// macOS limits a Unix socket path to 103 bytes; keep core state short.
const SOCK_ROOT = path.join(mac ? '/private/tmp' : (process.env.XDG_RUNTIME_DIR || '/tmp'), 'hpl');

const mkdir = p => fs.mkdirSync(p, { recursive: true, mode: 0o700 });
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, v) => { mkdir(path.dirname(p)); const t = p + '.' + process.pid + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(t, p); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const ID_RE = /^lab-[0-9a-f]{6}$/;
// Agents /agent already knows; any other name needs agent.md.
export const STARTER_ROLES = ['critic', 'notes', 'research'];

export function dirs(id) {
  if (!ID_RE.test(id)) throw Error(`Not a lab run ID: ${id}`);
  const root = rootOf(id);
  const r = readJson(path.join(root, 'run.json'), {});
  return { root, run: path.join(root, 'run.json'), state: path.join(root, 'state.json'), project: r.copy || path.join(root, r.projectName || 'project'), agent: path.join(root, 'pi-agent'), app: path.join(root, 'app'), config: path.join(root, 'config'), logs: path.join(root, 'logs'), sock: path.join(SOCK_ROOT, id) };
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
 * How to start the stock Pi as one process. /agent matches its pane by the terminal's foreground
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

// What the lab copies, decided in one place (labCopies).
// Left out everywhere: every expectations.md and lab-scenarios.md, reports, agents/ and roles/, Git and build
// folders, secrets-looking files. The agent under test must never read a test: its own or another agent's.
// The one exception: the files directly inside the tested agent's own folder (agents/<agent>/agent.md,
// memories.md, glossary.md, owns.txt, whatever it keeps there) are copied, because that folder is the agent:
// /agent opens agents/<name>/agent.md, and a job that says "the glossary beside this file" needs the glossary.
// Still withheld from that folder: any file with "expectation" in its name, and every subfolder (reports/).
const TESTS = /(^|\/)(expectations|lab-scenarios)\.md$/i;
const AGENT_FOLDERS = /(^|\/)(agents|roles)(\/|$)/i;
const SKIP = /(^|\/)(reports|lab-reports|\.git|node_modules|\.pi|\.cache|dist|build|\.next|\.venv|__pycache__)(\/|$)|(^|\/)\.env|(auth|credentials?|secrets?|tokens?)\.(json|txt|ya?ml)$|\.(pem|key|p12)$/i;
/**
 * Does this project file (a path relative to the project) go into the lab's copy?
 * agentFolder is the tested agent's folder relative to the project ("agents/booking"); a check has none.
 */
export function labCopies(file, agentFolder) {
  const f = String(file).replace(/\\/g, '/');
  if (TESTS.test(f) || SKIP.test(f)) return false;
  if (!AGENT_FOLDERS.test(f)) return true;
  const own = String(agentFolder || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!/^(agents|roles)\/[^/]+$/i.test(own) || !f.toLowerCase().startsWith(own.toLowerCase() + '/')) return false;
  const name = f.slice(own.length + 1);
  return !name.includes('/') && !/expectation/i.test(name);
}
/**
 * Copy the project for a lab. withheld: extra files (relative paths) that never go in, such as an expectations file under another name.
 * prepare(dest) runs on the copy before its one commit, so what it changes never shows as a change made during the run.
 */
export function copyProject(project, dest, agentFolder, withheld = [], prepare) {
  const never = new Set(withheld.map(w => String(w).replace(/\\/g, '/').toLowerCase()));
  mkdir(dest);
  let files = [];
  const git = spawnSync('git', ['-C', project, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (git.status === 0) files = git.stdout.split('\0').filter(Boolean);
  let bytes = 0, copied = 0;
  for (const f of files) {
    if (!labCopies(f, agentFolder) || never.has(f.toLowerCase())) continue;
    const a = path.join(project, f); let s; try { s = fs.lstatSync(a); } catch { continue; }
    if (!s.isFile() || s.size > 2 << 20) continue;
    if ((bytes += s.size) > 40 << 20) break;
    mkdir(path.dirname(path.join(dest, f))); fs.copyFileSync(a, path.join(dest, f)); copied++;
  }
  if (prepare) prepare(dest);
  spawnSync('git', ['init', '-q'], { cwd: dest });
  // One commit, so agents that ask Git (which commit, what changed, git add) see a real repository.
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

/** Where Pi keeps personal packages: PI_CODING_AGENT_DIR when set, else ~/.pi/agent. */
const piAgentDir = () => process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');

/** Find the /agent extension the guest should load: explicit, the project's own copy, then installed packages. */
export function roleExtension(project, explicit) {
  const ok = d => d && fs.existsSync(path.join(d, 'index.ts')) && /herdr-pi-role|temporary-role/.test(readJson(path.join(d, 'package.json'), {}).name || path.basename(d));
  const candidates = [explicit, process.env.HERDR_PI_LAB_ROLE_EXTENSION,
    path.join(project, '.pi/extensions/temporary-role'), path.join(project, '.pi/extensions/herdr-pi-role'),
    path.join(project, '.pi/git/github.com/johnlindquist/herdr-pi-role'),
    path.join(piAgentDir(), 'git/github.com/johnlindquist/herdr-pi-role'),
    path.join(piAgentDir(), 'extensions/temporary-role')];
  for (const c of candidates) if (c && ok(path.resolve(c))) return path.resolve(c);
  throw Error('The /agent extension was not found in this project. Install it here first (pi install --local git:github.com/johnlindquist/herdr-pi-role), or pass --agent-extension PATH.');
}

// ---------- run registry ----------

export const readRun = id => readJson(dirs(id).run, undefined);
export const readState = id => readJson(dirs(id).state, undefined);
export const writeRun = (id, patch) => { const cur = readRun(id) || {}; const next = { ...cur, ...patch, updated: new Date().toISOString() }; writeJson(dirs(id).run, next); return next; };
export const writeState = (id, v) => writeJson(dirs(id).state, v);

/** Where a lab's project copy goes: ~/.lab/<project>, or ~/.lab/<project>-<run> while another lab holds that name. */
export function copyPlace(id, project, home = HOME) {
  const projectName = (path.basename(project).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^\.+/, '') || 'project').slice(0, 40);
  const plain = path.join(home, projectName);
  const taken = projectName === 'app' || ID_RE.test(projectName) || fs.existsSync(plain);
  return { projectName, copy: taken ? `${plain}-${id.slice(4)}` : plain };
}
/** Only a folder directly inside the lab's folder that is not a run or the app copy may be removed as a project copy. */
export const isCopyPlace = (copy, home = HOME) => !!copy && path.dirname(copy) === home && path.basename(copy) !== 'app' && !ID_RE.test(path.basename(copy));
/** Register a new run: its scratch folder and the place of its project copy. */
function claim(id, project) {
  mkdir(path.join(HOME, id));
  const place = copyPlace(id, project);
  writeJson(path.join(HOME, id, 'run.json'), { id, ...place });
  return place.projectName;
}

export function list() {
  const ids = [HOME, LEGACY_HOME].filter(r => r && fs.existsSync(r)).flatMap(r => fs.readdirSync(r).filter(n => ID_RE.test(n)));
  return [...new Set(ids)].map(id => {
    const r = readRun(id) || { id }, s = readState(id);
    return { id, role: r.role, project: r.project, phase: r.phase, started: r.created, core: coreUp(id) ? 'running' : 'stopped', result: s?.result, counts: s ? tally(s) : undefined };
  }).sort((a, b) => String(b.started).localeCompare(String(a.started)));
}
export function tally(s) {
  const c = { pass: 0, fail: 0, unproven: 0, pending: 0, total: s.items?.length || 0 };
  for (const i of s.items || []) c[['pass', 'fail', 'unproven'].includes(i.verdict) ? i.verdict : 'pending']++;
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
 * For the agent, everything up to and including its own setup (the forked history and its job)
 * is left out, so the Tester still never sees the agent's instructions.
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
      else if (e.type === 'custom' && e.customType === 'temporary-role.note.v1') { const t = e.data?.text || e.data?.message; out.push({ at: e.timestamp, who: 'lab', text: `(an agent note arrived and waits for the next prompt${t ? `: ${String(t).slice(0, 300)}` : ''})` }); }
      // A note from a widget panel (the /widget extension's inbox): it waits for the next prompt, like an /agent note.
      else if (e.type === 'custom' && e.customType === 'widget.note.v1') { const d = e.data || {}; out.push({ at: e.timestamp, who: 'lab', text: `(a note from the ${d.from || 'widget'} panel arrived and waits for the next prompt:\n${String(d.text || '').slice(0, 8000)})` }); }
      // Any other message an extension put on Main's screen (display: true): what Main was given, in full, so it can be
      // quoted after it scrolls away. A fullscreen pane keeps only its last lines; this keeps the record.
      else if (e.type === 'custom_message' && e.display) {
        const t = typeof e.content === 'string' ? e.content : (e.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
        if (t.trim()) out.push({ at: e.timestamp, who: 'lab', text: `(shown in ${pane} with the next prompt, from ${e.customType}:\n${t.trim().slice(0, 8000)})` });
      }
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

/** Wait until every listed terminal has been quiet for `quiet` seconds (a watching agent reacts after Main). */
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

/**
 * Check the lab workspace (Herdr and its command line) and the lab harness (Pi) before a first lab.
 * A missing /agent or /split is a note, not a failure: the first check in lab-scenarios.md needs neither.
 */
export function doctor(project = process.cwd()) {
  const checks = [];
  const add = (part, name, fn, optional) => { try { checks.push({ part, name, ok: true, detail: fn() }); } catch (e) { checks.push({ part, name, ok: !!optional, ...(optional ? { note: true } : {}), detail: e.message }); } };
  add('workspace', 'platform', () => { if (!mac && process.platform !== 'linux') throw Error('macOS or Linux is required.'); return process.platform; });
  add('workspace', 'hc', () => { const p = which('hc'); if (!p) throw Error('hc (herdr-core), the Herdr command-line tool, is not on PATH. Install Herdr, then make sure `hc --version` works in this shell.'); return run(p, ['--version']).trim(); });
  add('workspace', 'herdr app', () => sourceApp());
  add('workspace', 'lab app copy', () => { const r = path.join(HOME, 'app'); return fs.existsSync(r) ? fs.readdirSync(r).join(', ') || 'none yet' : 'made on first start'; });
  add('harness', 'pi', () => { const p = which('pi'); if (!p) throw Error('pi is not on PATH. Install Pi, then make sure `pi --version` works in this shell.'); return run(p, ['--version']).trim(); });
  add('harness', '/agent extension', () => { try { return roleExtension(project); } catch { throw Error('not installed in this project yet. /lab new and /lab test <Agent> need it: pi install --local git:github.com/johnlindquist/herdr-pi-role. The checks in lab-scenarios.md run without it.'); } }, true);
  add('harness', '/split extension', () => { const hit = carriedExtensions(project).find(e => /herdr-pi-split/.test(e)); if (!hit) throw Error('not found. The /split check needs it: pi install git:github.com/johnlindquist/herdr-pi-split.'); return hit; }, true);
  const ready = part => checks.filter(c => c.part === part).every(c => c.ok);
  const workspace = ready('workspace'), harness = ready('harness');
  return { ok: workspace && harness, headline: doctorHeadline(workspace, harness), workspace, harness, checks };
}
/** The line /lab doctor leads with, as in the lesson's video: "Lab workspace ready · lab harness ready". */
export const doctorHeadline = (workspace, harness) => `Lab workspace ${workspace ? 'ready' : 'not ready'} · lab harness ${harness ? 'ready' : 'not ready'}`;
/** /lab doctor as text: the headline, one line per check (✓ fine, ✗ fix this, ○ a note), then what to do next. */
export function doctorText(d) {
  return [d.headline, ...d.checks.map(c => `${c.note ? '○' : c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`), d.ok ? 'Ready for /lab test or /lab new.' : 'Fix the ✗ lines, then run /lab doctor again.'].join('\n');
}

/**
 * The isolation step shared by every lab: copy the project, make the scratch Pi profile, start a
 * private core and (unless detached) the Herdr Lab window. A detached lab has no window at all.
 */
async function openLab(id, project, o, progress) {
  const d = dirs(id);
  progress('Copying the project');
  const copied = copyProject(project, d.project, o.agentFolder, o.withheld, o.prepare);
  profile(d.agent);
  mkdir(path.join(d.config, 'herdr-core'));
  fs.writeFileSync(path.join(d.config, 'herdr-core', 'config.toml'), 'notes = false\n');

  if (o.detached) { hc(id, ['server', 'start'], { timeout: 20000 }); writeRun(id, { copied, detached: true }); return; }
  progress('Preparing Herdr Lab');
  const a = labApp();
  writeRun(id, { app: { bin: a.bin, bundle: a.bundle, version: a.version }, copied });
  hc(id, ['server', 'start'], { timeout: 20000 });
  inheritLook(d.app, which('hc'));
  // Mods the run needs (a widget's panel) go into the lab's own app folder only, never the everyday one.
  for (const m of o.mods || []) fs.cpSync(m.from, path.join(d.app, 'mods', m.name), { recursive: true, filter: src => !/(^|\/)(reports|expectations\.md)(\/|$)/.test(path.relative(m.from, src)) });
  for (const l of o.layouts || []) {
    mkdir(path.join(d.app, 'layouts'));
    const to = path.join(d.app, 'layouts', `${l.name}.json`);
    fs.copyFileSync(l.from, to);
    // The layout root's "toast" picks the mod that shows notifications; lab-toast also records them for the Tester.
    if (o.recordToasts) writeJson(to, { ...readJson(to, {}), toast: 'lab-toast' });
  }

  progress('Opening the Herdr Lab window');
  const e = env(id), log = path.join(d.logs, 'app.log');
  const vars = ['HC_SESSION', 'XDG_STATE_HOME', 'XDG_CONFIG_HOME', 'HERDR_APP_HOME', 'HERDR_APP_NO_SOUND', 'HERDR_TELEMETRY', 'PI_CODING_AGENT_DIR', 'PI_SKIP_VERSION_CHECK', 'HERDR_PI_LAB_RUN', ...(e.HERDR_PI_LAB_HOME ? ['HERDR_PI_LAB_HOME'] : [])];
  // HERDR_PI_LAB_BEHIND=1 opens every lab behind your windows (for unattended runs and captures).
  const behind = o.background || process.env.HERDR_PI_LAB_BEHIND === '1';
  if (a.bundle) run('/usr/bin/open', ['-n', ...(behind ? ['-g'] : []), '-a', a.bundle, ...vars.flatMap(k => ['--env', `${k}=${e[k]}`]), '--stdout', log, '--stderr', log], { id });
  else { const fd = fs.openSync(log, 'a'); const { spawn } = await import('node:child_process'); spawn(a.bin, [], { env: e, detached: true, stdio: ['ignore', fd, fd] }).unref(); }
  // The first launch of a freshly signed copy can take a while for macOS to verify.
  await until(() => appJson(id, ['status'], { check: false, timeout: 5000 }), 120, 'the Herdr Lab window');
  writeRun(id, { appPid: findAppPid(id) });
  if (o.layout) {
    app(id, ['do', 'layout.switch', JSON.stringify({ name: o.layout })], { timeout: 15000 });
    await until(() => appJson(id, ['status'], { check: false, timeout: 5000 })?.layout === o.layout, 30, `the ${o.layout} layout`);
  }
}

/**
 * Start a lab for one agent. Steps: copy the project, start a private core and Herdr Lab window,
 * open guest Main, run the Before steps, open the agent with /agent, then open the Tester below it.
 */
export async function start(o, progress = () => {}) {
  const project = path.resolve(o.project || process.cwd());
  const role = String(o.role || '').trim();
  if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(role)) throw Error('Name the agent to test, e.g. /lab test Critic (one word, up to 32 characters).');
  // o.cases: an expectations file kept outside the project (sealed cases). The agent's own folder still comes from the project.
  const loc = o.cases ? { file: path.resolve(o.cases), dir: locate(project, role).dir }
    : o.expectations ? { file: path.resolve(o.expectations), dir: path.dirname(path.resolve(o.expectations)) } : locate(project, role);
  if (!o.cases && loc.missing) throw Error(`No expectations for ${role} yet. Write ${path.relative(project, loc.file)}, or run /lab new ${role} to write them together.`);
  const markdown = fs.readFileSync(loc.file, 'utf8');
  const spec = parse(markdown, role);
  const customJob = roleJob(loc.dir);
  // /agent gives any other name a placeholder job, so a new agent must have its agent.md before the lab runs.
  if (!customJob && !STARTER_ROLES.includes(role.toLowerCase())) throw Error(`${role} has no agent.md yet. Write ${path.relative(project, path.join(loc.dir, 'agent.md'))} with a "## Job" section first (or run /lab new ${role}).`);
  const ext = roleExtension(project, o.roleExtension);
  if (!o.model) throw Error('Choose the model the guest uses (provider/id).');
  const piBin = piCommand();
  const hcBin = which('hc'); if (!hcBin) throw Error('hc not on PATH.');

  const id = 'lab-' + randomBytes(3).toString('hex');
  const projectName = claim(id, project);
  const d = dirs(id);
  mkdir(d.root); mkdir(d.logs); mkdir(d.config); mkdir(d.sock);
  fs.writeFileSync(path.join(d.root, 'expectations.md'), markdown);
  const base = { id, version: VERSION, role, project, projectName, expectations: loc.file, roleDir: loc.dir, ...(o.reportDir ? { reportDir: path.resolve(o.reportDir) } : {}), customJob: !!customJob, model: o.model, roleModel: o.roleModel || 'fast', testerModel: o.testerModel || o.model, created: new Date().toISOString(), phase: 'starting', terminals: {} };
  writeRun(id, base);
  writeState(id, { id, role, title: spec.title, items: spec.items.map(i => ({ id: i.id, title: i.title, verdict: null })), result: null });
  try {
    // The tested agent's own folder goes into the copy (its job, glossary, memories), never its expectations: see labCopies.
    await openLab(id, project, { background: o.background, agentFolder: path.relative(project, loc.dir), withheld: o.cases ? [] : [path.relative(project, loc.file)] }, progress);
    fs.cpSync(ext, path.join(d.root, 'role-extension'), { recursive: true, filter: s => !/node_modules|\.git$/.test(s) });

    progress('Starting guest Main');
    const think = o.thinking ? ['--thinking', o.thinking] : [];
    // Guest Main reads but doesn't run commands or edit: the lab tests the agent, not Main's coding.
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

    await before(id, spec, main, progress);

    progress(`Opening ${role} with /agent`);
    const known = new Set(windowPanes(id).map(p => p.terminal));
    // Agents are quick visual support and default to a fast model in /agent (John, 2026-11-07); test them on what people will use.
    // An agent whose agent.md says "Access: work" changes files or runs commands, so it opens with --work.
    const cmd = `/agent ${work ? '--work ' : ''}${role} --model ${o.roleModel || 'fast'}${customJob ? ' ' + customJob : ''}`;
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
    const panesBefore = new Set(windowPanes(id).map(p => p.terminal));
    appJson(id, ['do', 'pane.split', JSON.stringify({ pane: opened.pane, direction: 'down', argv: testerArgv })], { timeout: 20000 });
    const tester = await until(() => windowPanes(id).find(p => !panesBefore.has(p.terminal)), 30, 'the Tester pane');
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

/** Run lines set up the copy (plant a bug, seed data) before Main's first prompt; the lab runs them itself, not a model. Then Main's Do lines. */
async function before(id, spec, main, progress) {
  const d = dirs(id), setup = [];
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
  if (!keepFiles) {
    // The project copy sits beside the run's scratch folder: remove only the copy this run recorded.
    if (isCopyPlace(r.copy)) fs.rmSync(r.copy, { recursive: true, force: true });
    fs.rmSync(d.root, { recursive: true, force: true });
  } else writeRun(id, { phase: 'stopped' });
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

// ---------- checks: a lab agent drives the lab from plain words ----------

/** Extensions that carry over into the lab's harness panes: /split and /agent, wherever this computer has them. */
export function carriedExtensions(project) {
  const found = [];
  for (const [name, re] of [['herdr-pi-split', /herdr-pi-split/], ['herdr-pi-role', /herdr-pi-role|temporary-role/]]) {
    const candidates = [path.join(project, '.pi/extensions', name), path.join(project, '.pi/git/github.com/johnlindquist', name),
      path.join(piAgentDir(), 'git/github.com/johnlindquist', name), path.join(piAgentDir(), 'extensions', name), path.join(HERE, '..', name)];
    const hit = candidates.find(c => fs.existsSync(path.join(c, 'index.ts')) && re.test(readJson(path.join(c, 'package.json'), {}).name || path.basename(c)));
    if (hit) found.push(path.resolve(hit));
  }
  for (const extra of (process.env.HERDR_PI_LAB_EXTENSIONS || '').split(path.delimiter).filter(Boolean)) if (fs.existsSync(extra)) found.push(path.resolve(extra));
  return [...new Set(found)];
}

const CAPTURED = id => path.join(dirs(id).root, 'captured.txt');
/** Everything the lab itself saw or did in a check. A step's quote must come from here. */
export const captured = id => { try { return fs.readFileSync(CAPTURED(id), 'utf8'); } catch { return ''; } };
export function record(id, text) { fs.appendFileSync(CAPTURED(id), text.replace(/\s+$/, '') + '\n'); return text; }

/** Panes in the lab now: the ones the lab agent opened by name (P1, P2…), any other by its terminal address. */
export function labPanes(id) {
  const r = readRun(id), names = Object.fromEntries(Object.entries(r.terminals || {}).map(([k, t]) => [t, k]));
  const live = r.detached ? (hcJson(id, ['ls'], { check: false })?.terminals || []).map(t => ({ terminal: t.address })) : windowPanes(id);
  return live.map(p => ({ name: names[p.terminal] || p.terminal, terminal: p.terminal, pane: p.pane }));
}
export function paneNamed(id, name) {
  const all = labPanes(id), want = String(name).trim().toLowerCase();
  const hit = all.find(p => p.name.toLowerCase() === want || p.terminal.toLowerCase() === want);
  if (!hit) throw Error(`No pane called "${name}". Panes now: ${all.map(p => p.name).join(', ') || 'none'}.`);
  return hit;
}
const paneList = id => labPanes(id).map(p => p.name).join(', ') || 'none';

/** Open a pane in the lab workspace running a shell or the harness (Pi with the carried-over extensions). */
export async function openPane(id, program = 'shell') {
  const r = readRun(id), d = dirs(id);
  if (!['shell', 'harness'].includes(program)) throw Error('A pane runs "shell" or "harness".');
  const argv = program === 'shell' ? [process.env.SHELL || '/bin/sh']
    : [...piCommand(), '--no-extensions', ...(r.extensions || []).flatMap(e => ['-e', e]), '--no-skills', '--no-prompt-templates', '--no-themes', '--model', r.model];
  const name = 'P' + ((r.paneCount || 0) + 1);
  const before = new Set(labPanes(id).map(p => p.terminal));
  if (r.detached) hc(id, ['run', '--bg', '--json', '--no-parent', '--cwd', d.project, '--label', `lab.pane=${name}`, ...argv], { timeout: 20000 });
  else if (!before.size) {
    const space = appJson(id, ['do', 'space.new', JSON.stringify({ machine: '', name: 'Lab', folder: d.project, argv })], { timeout: 20000 });
    if (!space?.terminal) throw Error('Herdr Lab did not confirm the pane.');
    writeRun(id, { space: space.space });
  } else {
    // pane.split has no folder argument; pass the folder as data, never as shell source.
    const from = labPanes(id).at(-1);
    appJson(id, ['do', 'pane.split', JSON.stringify({ pane: from.pane, direction: 'right', argv: ['/bin/sh', '-c', 'cd "$1" && shift && exec "$@"', 'lab', d.project, ...argv] })], { timeout: 20000 });
  }
  const opened = await until(() => labPanes(id).find(p => !before.has(p.terminal)), 30, 'the new pane');
  if (!r.detached) hc(id, ['label', opened.terminal, `lab.pane=${name}`], { check: false });
  writeRun(id, { paneCount: (r.paneCount || 0) + 1, terminals: { ...(readRun(id).terminals || {}), [name]: opened.terminal } });
  await until(() => /\S/.test(screen(id, opened.terminal)), 60, `${name} to show something`);
  return record(id, `[lab] opened pane ${name} (${program}) · panes now: ${paneList(id)}`);
}

export async function closePane(id, name) {
  const p = paneNamed(id, name), r = readRun(id);
  if (r.detached) { hc(id, ['kill', p.terminal], { check: false }); hc(id, ['rm', p.terminal], { check: false }); }
  else app(id, ['do', 'pane.close', JSON.stringify({ pane: p.pane })], { timeout: 15000 });
  await until(() => !labPanes(id).some(x => x.terminal === p.terminal), 20, `${p.name} to close`);
  return record(id, `[lab] closed pane ${p.name} · panes now: ${paneList(id)}`);
}

/** Wait until no pane's screen has changed for `quiet` seconds, so a shell, a picker and a working agent all count. */
export async function still(id, { quiet = 2, seconds = 120 } = {}) {
  const end = Date.now() + seconds * 1000;
  let last = '', since = Date.now();
  for (;;) {
    const sig = labPanes(id).map(p => p.terminal + screen(id, p.terminal)).join('\u0000');
    if (sig !== last) { last = sig; since = Date.now(); }
    if (Date.now() - since >= quiet * 1000) return true;
    if (Date.now() > end) return false;
    await sleep(400);
  }
}

// A fullscreen harness pads its screen with blank rows; squeeze them so the conversation above the prompt stays in view.
const lastLines = (s, n) => s.split('\n').map(l => l.trimEnd()).filter((l, i, a) => l || a[i - 1]).join('\n').replace(/\s+$/, '').split('\n').slice(-n).join('\n');
/** Read panes the way a person would: the end of each screen, kept as evidence. */
export function readPanes(id, only, lines = 40) {
  const panes = only ? [paneNamed(id, only)] : labPanes(id);
  return record(id, [`[lab] panes now: ${paneList(id)}`, ...panes.map(p => `--- ${p.name}: end of screen ---\n${lastLines(screen(id, p.terminal), lines) || '(blank)'}`)].join('\n'));
}
export async function typeInPane(id, name, text) {
  const p = paneNamed(id, name);
  hc(id, ['send', p.terminal, text, '--json'], { timeout: 20000 });
  await sleep(1000);
  const quiet = await still(id);
  return `typed in ${p.name}: ${text}${quiet ? '' : '  (still changing after 2 minutes)'}\n` + readPanes(id);
}
export async function pressKeys(id, name, keys) {
  const p = paneNamed(id, name);
  hc(id, ['keys', p.terminal, ...keys, '--json'], { timeout: 20000 });
  await sleep(1000);
  await still(id);
  return `pressed in ${p.name}: ${keys.join(' ')}\n` + readPanes(id);
}
/** A screenshot of the lab window. A detached lab has no window, and says so. */
export function screenshot(id) {
  const r = readRun(id), d = dirs(id);
  if (r.detached) return record(id, '[lab] screenshot unavailable: this lab is detached and has no window');
  const n = (r.shots || []).length + 1, file = path.join(d.root, `shot-${n}.png`);
  app(id, ['shot', file], { timeout: 15000 });
  if (!fs.existsSync(file)) throw Error('Herdr Lab did not save the screenshot.');
  writeRun(id, { shots: [...(r.shots || []), file] });
  return record(id, `[lab] screenshot saved: shot-${n}.png (${fs.statSync(file).size} bytes)`);
}

/**
 * Start a lab for one check: isolate as always, open one shell pane (P1), then run the lab agent
 * in the background (a headless Pi with only the lab's driving tools). Returns the run and a
 * promise of the outcome; the lab is stopped when the lab agent finishes unless keep is set.
 */
export async function startCheck(o, progress = () => {}) {
  const project = path.resolve(o.project || process.cwd());
  const check = o.check;
  if (!check?.steps?.length) throw Error('startCheck needs a check with steps.');
  if (!o.model) throw Error('Choose the model the lab agent uses (provider/id).');
  const piBin = piCommand();
  if (!which('hc')) throw Error('hc not on PATH.');
  const id = 'lab-' + randomBytes(3).toString('hex');
  const projectName = claim(id, project);
  const d = dirs(id);
  mkdir(d.logs); mkdir(d.config); mkdir(d.sock); mkdir(path.join(d.root, 'lab-agent'));
  writeRun(id, { id, version: VERSION, kind: 'check', role: `check ${check.id}`, check, source: o.source || 'asked in plain words', project, projectName, model: o.model, extensions: carriedExtensions(project), created: new Date().toISOString(), phase: 'starting', terminals: {} });
  writeState(id, { id, kind: 'check', title: check.title, items: check.steps.map(s => ({ id: s.id, title: s.text, verdict: null })), result: null });
  try {
    await openLab(id, project, { background: o.background, detached: o.detached }, progress);
    progress('Opening the first lab pane');
    await openPane(id, 'shell');
    writeRun(id, { phase: 'testing' });
    progress('Lab agent running');
  } catch (err) {
    writeRun(id, { phase: 'failed', error: err.message });
    if (!o.keepOnError) await stop(id).catch(() => {});
    err.run = id; throw err;
  }
  const log = fs.openSync(path.join(d.logs, 'lab-agent.log'), 'a');
  const { spawn } = await import('node:child_process');
  // The lab agent starts in an empty folder with no file, shell or web tools: zero knowledge of what it tests.
  const child = spawn(piBin[0], [...piBin.slice(1), '-p', '--no-extensions', '-e', path.join(HERE, 'checker', 'index.ts'), '--tools', 'lab_open,lab_type,lab_keys,lab_read,lab_shot,lab_close,lab_step,lab_finish',
    '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-mcp', '--no-session', '--model', o.model,
    '--append-system-prompt', path.join(HERE, 'checker', 'prompt.md'), '--lab-run', id, checkPrompt(id)], { cwd: path.join(d.root, 'lab-agent'), env: env(id), stdio: ['ignore', log, log] });
  const outcome = new Promise(resolve => {
    const timer = setTimeout(() => child.kill('SIGTERM'), (o.seconds || 900) * 1000);
    child.on('error', e => finish(e.message));
    child.on('exit', code => finish(code === 0 ? undefined : `the lab agent exited ${code}`));
    let done = false;
    async function finish(problem) {
      if (done) return; done = true; clearTimeout(timer); fs.closeSync(log);
      const s = readState(id) || {}, items = s.items || [];
      const error = s.report ? undefined : `The lab agent stopped before finishing (${problem || 'no report'}). Its log: ${tailFile(path.join(d.logs, 'lab-agent.log'))}`;
      if (error) writeRun(id, { phase: 'failed', error });
      if (!o.keep) await stop(id).catch(() => {});
      resolve({ run: id, check, result: error ? 'unfinished' : s.result, report: s.report, shot: s.shot, summary: s.summary, items, error, stopped: !o.keep });
    }
  });
  return { run: readRun(id), outcome };
}
/** The lab agent's only message: the check in plain words and the lab as it stands. */
const checkPrompt = id => { const c = readRun(id).check; return `Run this check in the lab.\n\n${c.title}\n${c.steps.map(s => `${s.id}. ${s.text}`).join('\n')}\n\n${readPanes(id)}`; };
const tailFile = f => { try { return fs.readFileSync(f, 'utf8').trim().slice(-600) || 'empty'; } catch { return 'missing'; } };

// ---------- widgets: test a /widget panel the way a person uses it ----------

/** Where the everyday Herdr app keeps its mods; the widget panel is copied from here into the lab. */
const dailyAppHome = () => path.join(os.homedir(), '.config', 'herdr-app');
/** The project's /widget extension (index.ts and runner.mjs). */
export function widgetExtension(project) {
  const dir = path.join(project, '.pi', 'extensions', 'widget');
  if (!fs.existsSync(path.join(dir, 'index.ts')) || !fs.existsSync(path.join(dir, 'runner.mjs'))) throw Error(`The /widget extension was not found in ${path.join(project, '.pi/extensions/widget')}.`);
  return dir;
}
export function widgetMod() {
  const dir = path.join(dailyAppHome(), 'mods', 'widget');
  if (!fs.existsSync(path.join(dir, 'main.js'))) throw Error(`The widget panel (Herdr mod) was not found in ${dir}.`);
  return dir;
}
const SOURCE_WORDS = { command: 'a command line', script: 'a script', mcp: 'an MCP call' };
/**
 * Which data a widget reads in the lab: its saved sample whenever it has one. Without a sample only a
 * command-line source runs, and it runs in the project copy; a script or MCP source may read outside
 * the project (other sessions, herdr, a server), so the lab refuses it rather than read the live source.
 * "lab": "live" in widget.json says the source reads only what the lab owns (the project copy, guest
 * Main's Pi session under PI_CODING_AGENT_DIR), so it runs live in the lab even with a sample.
 */
export function widgetData(cfg, hasSample) {
  if (cfg?.lab === 'live') return { sample: false, live: true };
  if (hasSample) return { sample: true };
  const type = cfg?.source?.type;
  if (type === 'command') return { sample: false };
  return { error: `reads its data with ${SOURCE_WORDS[type] || 'an unknown source'} and has no saved sample. The lab never reads a live source outside the project: save one first with /widget sample ${cfg?.name || '<name>'}.` };
}

const widgetDir = id => { const r = readRun(id); return path.join(dirs(id).project, 'widgets', r.widget.name); };
const HISTORY = id => path.join(dirs(id).root, 'widget-shown.txt');
/** What the widget panel shows now, as text (the panel writes it in a lab). Every new view is kept in the run's history. */
export function widgetShown(id) {
  let now = '';
  try { now = fs.readFileSync(path.join(widgetDir(id), 'state', 'shown.txt'), 'utf8').trimEnd(); } catch {}
  const r = readRun(id);
  if (now && now !== r.widgetLast) { fs.appendFileSync(HISTORY(id), `--- ${new Date().toISOString().slice(11, 19)} ---\n${now}\n`); writeRun(id, { widgetLast: now }); }
  return now;
}
/** Everything the panel has shown since it opened, oldest first. */
export const widgetHistory = id => { widgetShown(id); try { return fs.readFileSync(HISTORY(id), 'utf8'); } catch { return ''; } };
// Busy while a refresh runs (state/status.json) or any other background action says so (state/busy.json, the one
// contract for widget actions that outlive a key press, such as gathering context before a send).
const widgetBusy = (id, shown) => fs.existsSync(path.join(widgetDir(id), 'state', 'status.json')) || fs.existsSync(path.join(widgetDir(id), 'state', 'busy.json')) || /· refreshing$/m.test(shown.split('\n')[0] || '') || shown.split('\n').at(-1) === '…';

/** Wait until the widget is quiet (no refresh, no action running, its text unchanged) and the listed terminals are idle. */
export async function widgetSettle(id, terminals = [], { quiet = 3, seconds = 300 } = {}) {
  const end = Date.now() + seconds * 1000;
  let last = '', since = Date.now();
  for (;;) {
    const shown = widgetShown(id), gs = terminals.map(t => term(id, t));
    const sig = shown + '\u0000' + gs.map(g => `${stateOf(g)}:${g.turn}`).join('|');
    if (sig !== last) { last = sig; since = Date.now(); }
    const busy = !shown || widgetBusy(id, shown) || gs.some(g => !idle(g));
    if (!busy && Date.now() - since >= quiet * 1000) return { settled: true, shown };
    if (Date.now() > end) return { settled: false, shown };
    await sleep(400);
  }
}

/**
 * After Main did something, wait for the widget's next refresh to start and finish, as a person would
 * before reading the panel. A widget with manual refresh only is not waited for.
 */
export async function widgetNextRefresh(id, since, terminals = []) {
  const cfg = readJson(path.join(widgetDir(id), 'widget.json'), {}), secs = Number(cfg.refresh_seconds) || 0;
  // A widget on its saved sample can't show anything new after a Main step, so there is no refresh to wait for.
  if (!secs || readRun(id)?.widget?.sample) return { waited: false };
  const last = () => Date.parse(readJson(path.join(widgetDir(id), 'state', 'last.json'), {})?.at || '') || 0;
  const end = Date.now() + (secs + 60) * 1000;
  while (last() < since && Date.now() < end) { widgetShown(id); await sleep(500); }
  const r = await widgetSettle(id, terminals);
  return { waited: true, refreshed: last() >= since, settled: r.settled };
}

const KEY_RE = /^([a-z0-9]|up|down|enter)$/;
/** Press the widget's own keys, one after another, as a person would with the panel focused. */
export async function widgetPress(id, keys) {
  const bad = keys.filter(k => !KEY_RE.test(String(k).toLowerCase()));
  if (bad.length) throw Error(`Not a key the panel reads: ${bad.join(', ')}. Use one letter or digit, up, down or enter.`);
  widgetShown(id);
  fs.appendFileSync(HISTORY(id), `--- ${new Date().toISOString().slice(11, 19)} · the Tester pressed ${keys.join(' ')} ---\n`);
  for (const k of keys) { app(id, ['do', `widget.press-${String(k).toLowerCase()}`], { timeout: 10000 }); await sleep(300); }
}
/** Click one of the panel's buttons: an action chip by its label, "Refresh", or a row ("item 2"). */
export async function widgetClick(id, what) {
  const w = String(what).trim(), row = w.match(/^(?:item|row)\s*#?(\d+)$/i);
  if (row) { widgetShown(id); fs.appendFileSync(HISTORY(id), `--- ${new Date().toISOString().slice(11, 19)} · the Tester clicked item ${row[1]} ---\n`); app(id, ['do', `widget.click-item-${row[1]}`], { timeout: 10000 }); return `item ${row[1]}`; }
  const cfg = readJson(path.join(widgetDir(id), 'widget.json'), {});
  if (/^refresh( from sample)?$/i.test(w)) { await widgetPress(id, ['r']); return 'Refresh'; }
  const a = (cfg.actions || []).find(x => x.label.toLowerCase() === w.toLowerCase());
  if (!a) throw Error(`The panel has no button "${w}". Buttons: ${[...(cfg.actions || []).map(x => x.label), 'Refresh', 'item <n>'].join(', ')}.`);
  await widgetPress(id, [a.key]);
  return a.label;
}

/** Project files changed in the copy since the lab started: Git status and diff, leaving out the widget's own state/ folder. */
export function projectChanges(id) {
  const d = dirs(id), r = readRun(id), state = `widgets/${r.widget?.name}/state/`;
  const git = args => spawnSync('git', ['-C', d.project, ...args], { encoding: 'utf8', maxBuffer: 16 << 20 }).stdout || '';
  const files = git(['status', '--porcelain', '-uall']).split('\n').filter(Boolean).filter(l => !l.slice(3).startsWith(state));
  if (!files.length) return 'No project file changed.';
  const out = [`Changed project files (${files.length}):`, ...files];
  for (const l of files) {
    const f = l.slice(3);
    const diff = l.startsWith('??') ? (() => { try { return `new file ${f}:\n` + fs.readFileSync(path.join(d.project, f), 'utf8').slice(0, 1500); } catch { return ''; } })() : git(['diff', '--no-color', '--', f]).slice(0, 1500);
    if (diff.trim()) out.push('', diff.trimEnd());
  }
  return out.join('\n');
}
/** The saved sample the widget reads in this lab. */
export function widgetSample(id) {
  const r = readRun(id);
  if (!r.widget?.sample) return 'This widget runs without a saved sample: it reads a command line in the project copy.';
  try { return fs.readFileSync(path.join(widgetDir(id), 'sample.txt'), 'utf8'); } catch { return '(the sample is missing)'; }
}

/**
 * Start a lab for one widget: copy the project, install the panel in the lab window only, open guest Main
 * with the /widget extension, run the Before steps, open the widget beside Main on its saved sample, then
 * open the Tester below it. o.widgetModel sets the judging model for this run only (in the copy's widget.json).
 */
export async function startWidget(o, progress = () => {}) {
  const project = path.resolve(o.project || process.cwd());
  const name = slug(o.role);
  const loc = locateWidget(project, name);
  if (!loc) throw Error(`No widget ${name}: widgets/${name}/widget.json is missing.`);
  if (loc.missing) throw Error(`No expectations for the ${name} widget yet. Write widgets/${name}/expectations.md.`);
  const cfg = readJson(loc.config, undefined);
  if (!cfg) throw Error(`widgets/${name}/widget.json is not valid JSON.`);
  const data = widgetData({ ...cfg, name }, fs.existsSync(loc.sample));
  if (data.error) throw Error(`The ${name} widget ${data.error}`);
  const markdown = fs.readFileSync(loc.file, 'utf8');
  const spec = parse(markdown, name);
  const ext = widgetExtension(project), mod = widgetMod();
  if (!o.model) throw Error('Choose the model guest Main uses (provider/id).');
  if (o.widgetModel && !/^[\w.-]+\/[\w.:-]+$/.test(o.widgetModel)) throw Error(`--widget-model takes provider/id, e.g. anthropic/claude-haiku-4-5 (got "${o.widgetModel}").`);
  const piBin = piCommand();
  if (!which('hc')) throw Error('hc not on PATH.');

  const id = 'lab-' + randomBytes(3).toString('hex');
  const projectName = claim(id, project);
  const d = dirs(id);
  mkdir(d.root); mkdir(d.logs); mkdir(d.config); mkdir(d.sock);
  fs.writeFileSync(path.join(d.root, 'expectations.md'), markdown);
  const widget = { name, sample: data.sample, live: !!data.live, model: o.widgetModel || cfg.model, settingsModel: cfg.model, override: !!o.widgetModel, source: cfg.source?.type };
  writeRun(id, { id, version: VERSION, kind: 'widget', role: name, widget, project, projectName, expectations: loc.file, roleDir: loc.dir, model: o.model, testerModel: o.testerModel || o.model, created: new Date().toISOString(), phase: 'starting', terminals: {} });
  writeState(id, { id, kind: 'widget', role: name, title: spec.title, items: spec.items.map(i => ({ id: i.id, title: i.title, verdict: null })), result: null });
  try {
    const prepare = dest => {
      // Every widget starts clean: no pane, result or lock from the everyday window.
      const root = path.join(dest, 'widgets');
      if (fs.existsSync(root)) for (const n of fs.readdirSync(root)) fs.rmSync(path.join(root, n, 'state'), { recursive: true, force: true });
      if (o.widgetModel) { const f = path.join(root, name, 'widget.json'); writeJson(f, { ...readJson(f, {}), model: o.widgetModel }); }
    };
    await openLab(id, project, { background: o.background, withheld: [path.relative(project, loc.file)], prepare, mods: [{ name: 'widget', from: mod }] }, progress);
    fs.cpSync(ext, path.join(d.root, 'widget-extension'), { recursive: true });

    progress('Starting guest Main');
    const think = o.thinking ? ['--thinking', o.thinking] : [];
    // mainExtensions: more extensions guest Main loads, e.g. /agent when a widget's actions reach Main through it.
    const extra = (o.mainExtensions ?? []).flatMap(e => ['-e', e]);
    const mainArgv = [...piBin, '--no-extensions', '-e', path.join(d.root, 'widget-extension', 'index.ts'), ...extra, '--tools', 'read,grep,find,ls', '--no-skills', '--no-prompt-templates', '--no-themes', '--name', 'Main', '--model', o.model, ...think];
    const space = appJson(id, ['do', 'space.new', JSON.stringify({ machine: '', name: `Lab · ${name} widget`, folder: d.project, argv: mainArgv })], { timeout: 20000 });
    if (!space?.terminal) throw Error('Herdr Lab did not confirm guest Main.');
    const main = space.terminal;
    hc(id, ['label', main, 'lab.pane=Main'], { check: false });
    writeRun(id, { phase: 'main', terminals: { Main: main }, space: space.space });
    await piReady(id, main, 90);
    await before(id, spec, main, progress);

    progress(`Opening the ${name} widget${data.sample ? ' on its saved sample' : data.live ? ' on live data inside the lab' : ''}`);
    const runner = path.join(d.root, 'widget-extension', 'runner.mjs');
    const r = spawnSync(process.execPath, [runner, 'open', name, '--project', d.project, '--main', main, ...(data.sample ? ['--sample'] : [])], { env: env(id), encoding: 'utf8', timeout: 60000 });
    const res = parseJson(r.stdout || '');
    if (!res?.ok) throw Error(`The widget did not open: ${res?.error || (r.stderr || r.stdout || 'no answer').trim().slice(0, 400)}`);
    writeRun(id, { phase: 'widget', widget: { ...widget, pane: res.pane } });
    const first = await widgetSettle(id, [main], { quiet: 3, seconds: 300 });
    if (!first.shown) throw Error('The widget opened but never showed anything (no state/shown.txt). Is the lab copy of the widget mod the one that writes it?');

    progress('Opening the Tester');
    const tools = ['lab_do', 'lab_widget', 'lab_look', 'lab_find', 'lab_sample', 'lab_changes', 'lab_verdict', 'lab_finish'].join(',');
    const testerArgv = [...piBin, '--no-extensions', '-e', path.join(HERE, 'tester', 'index.ts'), '--tools', tools,
      '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-mcp', '--no-session', '--name', 'Tester',
      '--model', o.testerModel || o.model, ...(o.testerThinking ? ['--thinking', o.testerThinking] : []),
      '--append-system-prompt', path.join(HERE, 'tester', 'widget-prompt.md'), '--lab-run', id, 'Begin the black-box test of the widget.'];
    const known = new Set(windowPanes(id).map(p => p.terminal));
    const split = appJson(id, ['do', 'pane.split', JSON.stringify({ pane: res.pane, direction: 'down', argv: testerArgv })], { timeout: 20000, check: false });
    if (!split) appJson(id, ['do', 'pane.split', JSON.stringify({ pane: windowPanes(id).find(p => p.terminal === main)?.pane, direction: 'down', argv: testerArgv })], { timeout: 20000 });
    const tester = await until(() => windowPanes(id).find(p => !known.has(p.terminal)), 30, 'the Tester pane');
    hc(id, ['label', tester.terminal, 'lab.pane=Tester'], { check: false });
    for (const n of extraPanes(spec, name)) progress(`Note: the file names a pane "${n}"; a widget lab has Main and ${name}.`);
    writeRun(id, { phase: 'testing', terminals: { Main: main, Tester: tester.terminal } });
    progress('Tester running');
    return readRun(id);
  } catch (err) {
    writeRun(id, { phase: 'failed', error: err.message });
    if (!o.keepOnError) await stop(id).catch(() => {});
    err.run = id; throw err;
  }
}

// ---------- mods ----------

/** Every mod a layout names: content mods, pane header mods, its terminal menu and link handlers. */
export function layoutMods(layoutFile) {
  const out = new Set();
  const walk = n => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    for (const [k, v] of Object.entries(n)) {
      if ((k === 'mod' || k === 'terminal_menu') && typeof v === 'string') out.add(v);
      else if (k === 'link_handlers' && Array.isArray(v)) v.filter(x => typeof x === 'string').forEach(x => out.add(x));
      else walk(v);
    }
  };
  walk(readJson(layoutFile, {}));
  return [...out];
}

/** The mods and layout a mod test installs in the lab window, from the everyday app home only. */
export function modSetup(spec, name, appHome = dailyAppHome()) {
  const layouts = spec.before.filter(s => s.kind === 'layout').map(s => s.text);
  if (layouts.length > 1) throw Error('A mod test uses one Layout line.');
  const want = new Set([name, ...spec.before.filter(s => s.kind === 'mod').map(s => s.text)]);
  const out = { mods: [], layouts: [], layout: layouts[0] };
  if (out.layout) {
    const file = path.join(appHome, 'layouts', `${out.layout}.json`);
    if (!fs.existsSync(file)) throw Error(`No layout ${out.layout}: ${file} is missing.`);
    out.layouts.push({ name: out.layout, from: file });
    for (const m of layoutMods(file)) if (fs.existsSync(path.join(appHome, 'mods', m))) want.add(m);
  }
  for (const m of want) {
    const from = path.join(appHome, 'mods', m);
    if (!fs.existsSync(from)) throw Error(`No mod ${m}: ${from} is missing.`);
    out.mods.push({ name: m, from });
  }
  return out;
}

const WINDOW_HISTORY = id => path.join(dirs(id).root, 'window-history.txt');
/** What the lab window shows that a tester can quote: its spaces and tabs, the layout and any overlays or toasts. */
export function modWindow(id) {
  const ls = appJson(id, ['ls'], { check: false, timeout: 10000 }) || {};
  const st = appJson(id, ['status'], { check: false, timeout: 10000 }) || {};
  const spacesText = (ls.spaces || []).map(sp => `space "${sp.name}"${sp.active ? ' (shown)' : ''}: ${(sp.tabs || []).map(t => `tab "${t.name ?? t.index}"`).join(', ') || 'no tabs'}`);
  const overlays = (st.overlays || []).map(o => `overlay ${typeof o === 'string' ? o : JSON.stringify(o)}`);
  let toasts = [];
  try { toasts = fs.readFileSync(path.join(dirs(id).app, 'lab-toasts.txt'), 'utf8').split('\n').filter(Boolean).map(t => `toast ${t}`); } catch {}
  const r = readRun(id);
  const toastNote = r?.mod?.layout ? (toasts.length ? toasts : ['no toasts yet']) : ['(toast text is recorded only when the test names a Layout)'];
  return [`layout: ${st.layout ?? '?'}`, ...spacesText, ...(overlays.length ? overlays : ['no overlays open']), ...toastNote, ...(st.errors?.length ? [`errors: ${JSON.stringify(st.errors)}`] : [])].join('\n');
}
export const modHistory = id => { try { return fs.readFileSync(WINDOW_HISTORY(id), 'utf8'); } catch { return ''; } };
function noteWindow(id, why) {
  const now = modWindow(id), hist = modHistory(id), last = hist.split(/^--- .* ---$/m).pop()?.trim();
  if (last === now.trim() && !why) return false;
  fs.appendFileSync(WINDOW_HISTORY(id), `--- ${new Date().toISOString().slice(11, 19)}${why ? ' · ' + why : ''} ---\n${now}\n`);
  return true;
}
/**
 * Send one of the mod's own commands ("<mod>.<command>", as its nextCommand() receives it), then watch the
 * window until it has changed and gone quiet, or seconds pass. Every distinct view goes into the window history.
 */
export async function modSend(id, command, { seconds = 240, quiet = 8 } = {}) {
  const r = readRun(id), name = r.mod.name;
  noteWindow(id, `the Tester sent ${name}.${command}`);
  app(id, ['do', `${name}.${command}`], { timeout: 15000 });
  const end = Date.now() + seconds * 1000;
  let changed = false, lastChange = Date.now();
  while (Date.now() < end) {
    await sleep(1000);
    if (noteWindow(id)) { changed = true; lastChange = Date.now(); }
    if (changed && Date.now() - lastChange > quiet * 1000) break;
  }
  return { changed, settled: Date.now() < end, window: modWindow(id) };
}

/**
 * Start a lab for one mod: copy the project, install the mod (and the Layout and Mod lines' mods) in the lab
 * window only, switch to the layout, open guest Main in the project copy, run the Before steps, then open the
 * Tester below Main. The Tester uses the mod only through the commands its mod.json lists under "lab".
 */
export async function startMod(o, progress = () => {}) {
  const project = path.resolve(o.project || process.cwd());
  const name = slug(String(o.role).replace(/^mod:/i, ''));
  const loc = locateMod(name);
  if (!loc) throw Error(`No mod ${name}: ${path.join(dailyAppHome(), 'mods', name)} has no main.js.`);
  if (loc.missing) throw Error(`No expectations for the ${name} mod yet. Write ${loc.file}.`);
  const markdown = fs.readFileSync(loc.file, 'utf8');
  const spec = parse(markdown, name);
  const setup = modSetup(spec, name);
  const commands = readJson(path.join(loc.dir, 'mod.json'), {})?.lab?.commands || {};
  if (!Object.keys(commands).length) throw Error(`${name}/mod.json lists no "lab": {"commands": {...}}: the Tester needs the mod's commands to use it.`);
  if (!o.model) throw Error('Choose the model guest Main uses (provider/id).');
  const piBin = piCommand();
  if (!which('hc')) throw Error('hc not on PATH.');

  const id = 'lab-' + randomBytes(3).toString('hex');
  const projectName = claim(id, project);
  const d = dirs(id);
  mkdir(d.root); mkdir(d.logs); mkdir(d.config); mkdir(d.sock);
  fs.writeFileSync(path.join(d.root, 'expectations.md'), markdown);
  writeRun(id, { id, version: VERSION, kind: 'mod', role: name, mod: { name, commands, layout: setup.layout, installed: setup.mods.map(m => m.name) }, project, projectName, expectations: loc.file, roleDir: loc.dir, model: o.model, testerModel: o.testerModel || o.model, created: new Date().toISOString(), phase: 'starting', terminals: {} });
  writeState(id, { id, kind: 'mod', role: name, title: spec.title, items: spec.items.map(i => ({ id: i.id, title: i.title, verdict: null })), result: null });
  try {
    const mods = [...setup.mods, ...(setup.layout ? [{ name: 'lab-toast', from: path.join(HERE, 'mods', 'lab-toast') }] : [])];
    await openLab(id, project, { background: o.background, mods, layouts: setup.layouts, layout: setup.layout, recordToasts: true }, progress);
    progress('Starting guest Main');
    const think = o.thinking ? ['--thinking', o.thinking] : [];
    const mainArgv = [...piBin, '--no-extensions', '--tools', 'read,grep,find,ls', '--no-skills', '--no-prompt-templates', '--no-themes', '--name', 'Main', '--model', o.model, ...think];
    const space = appJson(id, ['do', 'space.new', JSON.stringify({ machine: '', name: `Lab · ${name} mod`, folder: d.project, argv: mainArgv })], { timeout: 20000 });
    if (!space?.terminal) throw Error('Herdr Lab did not confirm guest Main.');
    const main = space.terminal;
    hc(id, ['label', main, 'lab.pane=Main'], { check: false });
    writeRun(id, { phase: 'main', terminals: { Main: main }, space: space.space });
    await piReady(id, main, 90);
    await before(id, spec, main, progress);
    await sleep(3000); // the mod polls the focused space; give it a beat after setup
    noteWindow(id, 'after setup');

    progress('Opening the Tester');
    const tools = ['lab_do', 'lab_mod', 'lab_look', 'lab_find', 'lab_verdict', 'lab_finish'].join(',');
    const testerArgv = [...piBin, '--no-extensions', '-e', path.join(HERE, 'tester', 'index.ts'), '--tools', tools,
      '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-mcp', '--no-session', '--name', 'Tester',
      '--model', o.testerModel || o.model, ...(o.testerThinking ? ['--thinking', o.testerThinking] : []),
      '--append-system-prompt', path.join(HERE, 'tester', 'mod-prompt.md'), '--lab-run', id, `Begin the black-box test of the ${name} mod.`];
    const known = new Set(windowPanes(id).map(p => p.terminal));
    appJson(id, ['do', 'pane.split', JSON.stringify({ pane: windowPanes(id).find(p => p.terminal === main)?.pane, direction: 'down', argv: testerArgv })], { timeout: 20000 });
    const tester = await until(() => windowPanes(id).find(p => !known.has(p.terminal)), 30, 'the Tester pane');
    hc(id, ['label', tester.terminal, 'lab.pane=Tester'], { check: false });
    writeRun(id, { phase: 'testing', terminals: { Main: main, Tester: tester.terminal } });
    progress('Tester running');
    return readRun(id);
  } catch (err) {
    writeRun(id, { phase: 'failed', error: err.message });
    if (!o.keepOnError) await stop(id).catch(() => {});
    err.run = id; throw err;
  }
}

export { slug, parse, locate, locateWidget, locateMod };
