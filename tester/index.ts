// The Lab's Black-box tester. It runs in its own Pi, started with only these
// tools (--tools allowlist, --no-extensions), so it cannot read files, run a
// shell or open the agent's instructions: it can only type the expectations'
// steps into guest panes, read those panes and record verdicts.
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { Type } from 'typebox';
import fs from 'node:fs';
import path from 'node:path';
import * as core from '../core.mjs';
import { parse, steps, observed, judged, contains } from '../expectations.mjs';
import { writeReport } from '../report.mjs';

const text = (t: string, summary?: string) => ({ content: [{ type: 'text' as const, text: t }], details: { summary } });
// The person watching reads this pane: one line per tool result, full text on ctrl+o.
const renderResult = (result: any, options: any, theme: any) => {
	const full = result.content?.map((c: any) => c.text).join('\n') ?? '', summary = result.details?.summary;
	return new Text(options.expanded || !summary ? theme.fg('toolOutput', full) : theme.fg('muted', summary), 0, 0);
};
const tail = (s: string, n: number) => s.replace(/\s+$/, '').split('\n').slice(-n).join('\n');
const clip = (s: string, n: number) => (s.length > n ? '…' + s.slice(-n) : s);
const MARK: Record<string, string> = { pass: '✓', fail: '✗', unproven: '?', running: '◐', pending: '○' };

export default function (pi: ExtensionAPI) {
	pi.registerFlag('lab-run', { type: 'string', description: 'Herdr Lab run ID for this Tester.' });
	let ui: ExtensionContext | undefined;

	const runId = () => {
		const id = pi.getFlag('lab-run');
		if (typeof id !== 'string' || !core.ID_RE.test(id)) throw Error('This Tester was not started by Herdr Lab.');
		return id;
	};
	const load = () => {
		const id = runId(), run = core.readRun(id), state = core.readState(id);
		if (!run || !state) throw Error('This lab run is gone. Start a new one from Main with /lab test.');
		const spec = parse(fs.readFileSync(path.join(core.dirs(id).root, 'expectations.md'), 'utf8'), run.role);
		return { id, run, state, spec };
	};
	// A widget run has three things to read: Main (a terminal), the widget panel (its text) and Files (project changes).
	const isWidget = (run: any) => run.kind === 'widget';
	// A mod run has Main (a terminal) and the Window: its spaces, tabs, overlays and toasts as the lab reads them.
	const isMod = (run: any) => run.kind === 'mod';
	const paneOf = (run: any, name: string): { name: string; terminal?: string; kind: 'terminal' | 'widget' | 'files' | 'window' | 'mod' } => {
		const want = String(name).trim().toLowerCase();
		if (isMod(run)) {
			if (want === 'window') return { name: 'Window', kind: 'window' };
			if (want === run.mod.name.toLowerCase() || want === 'mod') return { name: run.mod.name, kind: 'mod' };
		}
		if (isWidget(run)) {
			if (want === run.widget.name.toLowerCase() || want === 'widget') return { name: run.widget.name, kind: 'widget' };
			if (want === 'files') return { name: 'Files', kind: 'files' };
		}
		const key = Object.keys(run.terminals).find(k => k !== 'Tester' && k.toLowerCase() === want);
		const all = [...Object.keys(run.terminals).filter(k => k !== 'Tester'), ...(isWidget(run) ? [run.widget.name, 'Files'] : []), ...(isMod(run) ? ['Window'] : [])];
		if (!key) throw Error(`No guest pane called "${name}". Panes: ${all.join(', ')}.`);
		return { name: key, terminal: run.terminals[key] as string, kind: 'terminal' };
	};
	/** Everything a pane has shown, for quotes: a terminal's screen and conversation, the widget's views, or the project changes. */
	const shownOn = (id: string, run: any, name: string) => {
		const pane = paneOf(run, name);
		if (pane.kind === 'widget') return core.widgetHistory(id);
		if (pane.kind === 'files') return core.projectChanges(id);
		if (pane.kind === 'window' || pane.kind === 'mod') return core.modHistory(id) + '\n--- now ---\n' + core.modWindow(id);
		return core.screen(id, pane.terminal!) + '\n' + core.transcriptText(core.transcript(id, pane.name));
	};
	const guests = (run: any) => Object.entries(run.terminals).filter(([k]) => k !== 'Tester').map(([, t]) => t as string);
	const item = (spec: any, n: number) => { const i = spec.items.find((x: any) => x.id === n); if (!i) throw Error(`There is no expectation ${n}; the file has 1–${spec.items.length}.`); return i; };

	function show() {
		if (!ui?.hasUI) return;
		try {
			const { state, run } = load();
			const rows = state.items.map((i: any) => `${MARK[i.verdict || (i.running ? 'running' : 'pending')]} ${i.id} · ${i.title}`);
			const c = core.tally(state);
			const head = state.result ? `Lab · ${run.role} · ${state.result === 'pass' ? 'all expectations met' : `${c.fail} of ${c.total} failed`}` : `Lab · ${run.role} · ${c.pass + c.fail}/${c.total} checked`;
			ui.ui.setWidget('herdr-pi-lab', [head, ...rows]);
		} catch {}
	}
	const update = (fn: (s: any) => void) => { const { id, state } = load(); fn(state); core.writeState(id, state); show(); };

	pi.on('session_start', async (_e, ctx) => { ui = ctx; show(); });

	pi.registerTool({
		name: 'lab_do', label: 'Lab · do',
		description: 'Run the Do lines of one expectation exactly as written (typed into the named guest pane), wait until the guest is quiet, and return the end of every guest screen. In a widget test it stops at a Do line for the widget and tells you to do that step with lab_widget; then call lab_do again with from set to the next step.',
		parameters: Type.Object({ expectation: Type.Integer({ minimum: 1 }), from: Type.Optional(Type.Integer({ minimum: 1, description: 'Widget tests: the Do step to continue from (1 = the first).' })) }),
		renderResult,
		async execute(_id, p) {
			const { id, run, spec } = load();
			const it = item(spec, p.expectation);
			if (isWidget(run)) return widgetDo(id, run, it, p.from || 1);
			if (isMod(run)) return modDo(id, run, it, p.from || 1);
			update(s => { for (const x of s.items) x.running = x.id === it.id; });
			const log: string[] = [];
			const names = Object.keys(run.terminals).filter(k => k !== 'Tester');
			const seen = Object.fromEntries(names.map(k => [k, core.transcript(id, k).length]));
			update(s => { const x = s.items.find((y: any) => y.id === it.id); if (x) x.reached = steps(it).length; });
			for (const step of steps(it)) {
				const pane = paneOf(run, step.pane);
				const r = await core.type(id, pane.terminal, step.text, guests(run));
				log.push(`typed in ${pane.name}: ${step.text}${r.settled ? '' : '  (still working after 4 minutes)'}`);
			}
			if (!log.length) await core.settle(id, guests(run), { quiet: 2, seconds: 60 });
			const screens = names.map(k => {
				const fresh = core.transcript(id, k).slice(seen[k]);
				return `--- ${k}: shown during this step ---\n${fresh.length ? clip(core.transcriptText(fresh), 6000) : '(nothing new)'}\n--- ${k}: end of screen now ---\n${tail(core.screen(id, run.terminals[k]), 14)}`;
			});
			const checks = it.lines.filter((l: any) => l.kind !== 'do').map((l: any) => `${l.kind[0].toUpperCase() + l.kind.slice(1)} (${l.pane}): ${l.text}`);
			return text(`${it.id} · ${it.title}\n${log.join('\n') || 'no steps; screens as they are'}\n\nCheck:\n${checks.join('\n')}\n\n${screens.join('\n\n')}`, `${it.id} · ${it.title}: ${log.length ? log.join(' · ') : 'checking the screens'}`);
		},
	});

	/** What Main showed since a step began, and the widget and project files now. */
	function widgetScreens(id: string, run: any, seen: number) {
		const fresh = core.transcript(id, 'Main').slice(seen);
		return [`--- Main: shown during this step ---\n${fresh.length ? clip(core.transcriptText(fresh), 6000) : '(nothing new)'}\n--- Main: end of screen now ---\n${tail(core.screen(id, run.terminals.Main), 14)}`,
			`--- ${run.widget.name}: the widget shows now ---\n${core.widgetShown(id) || '(nothing)'}`,
			`--- Files ---\n${clip(core.projectChanges(id), 3000)}`].join('\n\n');
	}
	async function widgetDo(id: string, run: any, it: any, from: number) {
		const all = steps(it), log: string[] = [];
		if (from > all.length + 1) throw Error(`Expectation ${it.id} has ${all.length} Do step(s).`);
		if (from === 1) update(s => { for (const x of s.items) { x.running = x.id === it.id; if (x.id === it.id) { x.seen = core.transcript(id, 'Main').length; x.reached = 0; } } });
		const seen = load().state.items.find((x: any) => x.id === it.id)?.seen ?? 0;
		for (let n = from; n <= all.length; n++) {
			const step = all[n - 1], pane = paneOf(run, step.pane);
			// The step the lab has reached; lab_verdict refuses a verdict until it is the last one.
			update(s => { const x = s.items.find((y: any) => y.id === it.id); if (x) x.reached = n; });
			if (pane.kind === 'widget') {
				const quiet = await core.widgetSettle(id, [run.terminals.Main], { quiet: 2, seconds: 300 });
				const next = `Step ${n} of ${all.length} is for the widget: "${step.text}". Do it now with lab_widget (its keys or its buttons), then call lab_do {"expectation": ${it.id}, "from": ${n + 1}}.`;
				return text(`${it.id} · ${it.title}\n${[...log, next].join('\n')}\n\n--- ${run.widget.name}: the widget shows now ---\n${quiet.shown || '(nothing)'}`, `${it.id} · step ${n}: for the widget: ${step.text}`);
			}
			if (pane.kind !== 'terminal') throw Error(`Do lines go to Main or ${run.widget.name}, not ${step.pane} (line ${step.line}).`);
			await core.type(id, pane.terminal!, step.text, [pane.terminal!]);
			const r = await core.widgetNextRefresh(id, Date.now(), [run.terminals.Main]);
			log.push(`step ${n}: typed in Main: ${step.text}${!r.waited ? '' : r.refreshed ? ' · the widget refreshed after it' : '  (the widget did not refresh within its interval)'}`);
		}
		update(s => { const x = s.items.find((y: any) => y.id === it.id); if (x) x.reached = all.length; });
		const r = await core.widgetSettle(id, [run.terminals.Main]);
		const checks = it.lines.filter((l: any) => l.kind !== 'do').map((l: any) => `${l.kind[0].toUpperCase() + l.kind.slice(1)} (${l.pane}): ${l.text}`);
		return text(`${it.id} · ${it.title}\n${log.join('\n') || 'no more steps'}${r.settled ? '' : '\n(the widget or Main was still busy after 5 minutes)'}\nAll Do steps are done; judge now.\n\nCheck:\n${checks.join('\n')}\n\n${widgetScreens(id, run, seen)}`, `${it.id} · ${it.title}: steps done, checking`);
	}

	const modCommands = (run: any) => Object.entries(run.mod.commands).map(([c, what]) => `${c}: ${what}`).join('; ');
	function modScreens(id: string, run: any, seen: number, since: number) {
		const fresh = core.transcript(id, 'Main').slice(seen);
		const hist = core.modHistory(id).slice(since);
		return [`--- Window: shown during this step ---\n${hist.trim() ? clip(hist, 6000) : '(nothing new)'}\n--- Window: now ---\n${core.modWindow(id)}`,
			`--- Main: shown during this step ---\n${fresh.length ? clip(core.transcriptText(fresh), 3000) : '(nothing new)'}`].join('\n\n');
	}
	async function modDo(id: string, run: any, it: any, from: number) {
		const all = steps(it), log: string[] = [];
		if (from > all.length + 1) throw Error(`Expectation ${it.id} has ${all.length} Do step(s).`);
		if (from === 1) update(s => { for (const x of s.items) { x.running = x.id === it.id; if (x.id === it.id) { x.seen = core.transcript(id, 'Main').length; x.since = core.modHistory(id).length; x.reached = 0; } } });
		const st = load().state.items.find((x: any) => x.id === it.id) ?? {};
		for (let n = from; n <= all.length; n++) {
			const step = all[n - 1], pane = paneOf(run, step.pane);
			update(s => { const x = s.items.find((y: any) => y.id === it.id); if (x) x.reached = n; });
			if (pane.kind === 'mod') {
				const next = `Step ${n} of ${all.length} is for the ${run.mod.name} mod: "${step.text}". Do it now with lab_mod (its commands: ${modCommands(run)}), then call lab_do {"expectation": ${it.id}, "from": ${n + 1}}.`;
				return text(`${it.id} · ${it.title}\n${[...log, next].join('\n')}\n\n--- Window: now ---\n${core.modWindow(id)}`, `${it.id} · step ${n}: for the mod: ${step.text}`);
			}
			if (pane.kind !== 'terminal') throw Error(`Do lines go to Main or ${run.mod.name}, not ${step.pane} (line ${step.line}).`);
			const r = await core.type(id, pane.terminal!, step.text, [pane.terminal!]);
			log.push(`step ${n}: typed in Main: ${step.text}${r.settled ? '' : '  (still working after 4 minutes)'}`);
		}
		update(s => { const x = s.items.find((y: any) => y.id === it.id); if (x) x.reached = all.length; });
		const checks = it.lines.filter((l: any) => l.kind !== 'do').map((l: any) => `${l.kind[0].toUpperCase() + l.kind.slice(1)} (${l.pane}): ${l.text}`);
		return text(`${it.id} · ${it.title}\n${log.join('\n') || 'no more steps'}\nAll Do steps are done; judge now.\n\nCheck:\n${checks.join('\n')}\n\n${modScreens(id, run, st.seen ?? 0, st.since ?? 0)}`, `${it.id} · ${it.title}: steps done, checking`);
	}

	pi.registerTool({
		name: 'lab_mod', label: 'Lab · mod',
		description: 'Use the mod under test the way a person does, through one of its own commands (the lab sends "<mod>.<command>" to it). The commands and what each stands for come from the mod and are listed when a Do line is for the mod. Waits until the window has changed and gone quiet (up to 4 minutes), then returns every view of the window during the step and what Main showed.',
		parameters: Type.Object({ command: Type.String({ minLength: 1, maxLength: 1000, description: 'The command, e.g. ask pick up my next ticket' }) }),
		renderResult,
		async execute(_id, p) {
			const { id, run } = load();
			if (!isMod(run)) throw Error('This lab is not testing a mod.');
			const verbs = Object.keys(run.mod.commands).map(c => c.split(/\s+/)[0]);
			const verb = p.command.trim().split(/\s+/)[0];
			if (!verbs.includes(verb)) throw Error(`The ${run.mod.name} mod has no command "${verb}". Its commands: ${modCommands(run)}.`);
			const seen = core.transcript(id, 'Main').length, since = core.modHistory(id).length;
			const r = await core.modSend(id, p.command.trim());
			return text(`sent ${run.mod.name}.${p.command.trim()}${r.changed ? '' : '  (the window did not change within 4 minutes)'}\n\n${modScreens(id, run, seen, since)}`, `${run.mod.name}: ${p.command.trim().slice(0, 80)}`);
		},
	});

	pi.registerTool({
		name: 'lab_widget', label: 'Lab · widget',
		description: 'Use the widget panel the way a person does: press its own keys (press: ["down", "y"]; one letter or digit, up, down or enter) or click one of its buttons (click: an action label such as "Keep", "Refresh", or a row such as "item 1"). Waits until the widget and Main are quiet, then returns what the widget shows, what Main showed and the project file changes.',
		parameters: Type.Object({ press: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 20 })), click: Type.Optional(Type.String({ minLength: 1 })) }),
		renderResult,
		async execute(_id, p) {
			const { id, run } = load();
			if (!isWidget(run)) throw Error('This lab is not testing a widget.');
			if (!p.press === !p.click) throw Error('Give press or click, one of them.');
			const seen = core.transcript(id, 'Main').length;
			const did = p.press ? (await core.widgetPress(id, p.press), `pressed ${p.press.join(' ')}`) : `clicked ${await core.widgetClick(id, p.click!)}`;
			await new Promise(r => setTimeout(r, 800));
			const r = await core.widgetSettle(id, [run.terminals.Main]);
			return text(`${did} on ${run.widget.name}${r.settled ? '' : '  (still busy after 5 minutes)'}\n\n${widgetScreens(id, run, seen)}`, `${run.widget.name}: ${did}`);
		},
	});

	pi.registerTool({
		name: 'lab_sample', label: 'Lab · sample',
		description: 'Read the saved sample the widget judges in this lab, to check what the widget shows against the data it was given.',
		parameters: Type.Object({}),
		renderResult,
		async execute() { const { id, run } = load(); if (!isWidget(run)) throw Error('This lab is not testing a widget.'); const t = core.widgetSample(id); return text(clip(t, 20000), `read the ${run.widget.name} sample (${t.length} characters)`); },
	});

	pi.registerTool({
		name: 'lab_changes', label: 'Lab · changes',
		description: 'Which project files changed in the lab copy since it started (Git status and diff; the widget\'s own state/ folder is left out). Quote it as pane "Files".',
		parameters: Type.Object({}),
		renderResult,
		async execute() { const { id } = load(); const t = core.projectChanges(id); return text(t, t.split('\n')[0]); },
	});

	pi.registerTool({
		name: 'lab_look', label: 'Lab · look',
		description: 'Read a guest pane (Main or the agent): everything it has shown since it opened (prompts typed into it, its replies, notes that arrived), then the end of its screen now. In a widget test, the widget\'s name reads every view the panel has shown, oldest first, and "Files" reads the project changes.',
		parameters: Type.Object({ pane: Type.String(), lines: Type.Optional(Type.Integer({ minimum: 5, maximum: 200 })) }),
		renderResult,
		async execute(_id, p) {
			const { id, run } = load(); const pane = paneOf(run, p.pane);
			if (pane.kind !== 'terminal') return text(`--- ${pane.name}: ${pane.kind === 'widget' ? 'every view it has shown, oldest first' : pane.kind === 'files' ? 'project changes' : 'every view of the window, oldest first'} ---\n${clip(shownOn(id, run, pane.name), 12000) || '(nothing yet)'}`, `read ${pane.name}`);
			return text(`--- ${pane.name}: shown since it opened ---\n${clip(core.transcriptText(core.transcript(id, pane.name)), 12000) || '(nothing yet)'}\n--- ${pane.name}: end of screen now ---\n${tail(core.screen(id, pane.terminal), p.lines || 30)}`, `read ${pane.name}`);
		},
	});

	pi.registerTool({
		name: 'lab_find', label: 'Lab · find',
		description: 'Check whether exact text is on a guest pane right now (ignores case, spacing, punctuation and line wrapping).',
		parameters: Type.Object({ pane: Type.String(), text: Type.String({ minLength: 1 }) }),
		renderResult,
		async execute(_id, p) {
			const { id, run } = load(); const pane = paneOf(run, p.pane);
			const shown = shownOn(id, run, pane.name);
			const r = `${contains(shown, p.text) ? 'found' : 'not found'} on ${pane.name}: "${p.text}"`; return text(r, r);
		},
	});

	pi.registerTool({
		name: 'lab_verdict', label: 'Lab · verdict',
		description: 'Record pass, fail or unproven for one expectation, with verbatim quotes from guest panes as evidence. Quotes not on the named pane are rejected. See/Absent lines are checked by the lab and override the verdict.',
		parameters: Type.Object({
			expectation: Type.Integer({ minimum: 1 }),
			verdict: Type.Union([Type.Literal('pass'), Type.Literal('fail'), Type.Literal('unproven')], { description: 'unproven: the steps ran but nothing the lab shows can prove or disprove an Expect line. Say what you could not see.' }),
			reason: Type.String({ minLength: 1, maxLength: 600 }),
			evidence: Type.Array(Type.Object({ pane: Type.String(), quote: Type.String({ minLength: 2, maxLength: 300 }) }), { maxItems: 6 }),
			absent: Type.Optional(Type.Array(Type.Object({ pane: Type.String(), text: Type.String({ minLength: 2, maxLength: 200 }) }), { maxItems: 6 })),
		}),
		renderResult,
		async execute(_id, p) {
			const { id, run, spec, state } = load(); const it = item(spec, p.expectation);
			// Every Do step must have run first: a verdict on a half-run expectation judges the wrong thing.
			const all = steps(it), reached = state.items.find((x: any) => x.id === it.id)?.reached ?? 0;
			if (reached < all.length) {
				const next = all[reached];
				throw Error(`Step ${reached + 1} of ${all.length} has not run: ${next.pane}: "${next.text}". Call lab_do {"expectation": ${it.id}${reached ? `, "from": ${reached + 1}` : ''}} first, then judge.`);
			}
			const screens: Record<string, string> = {};
			const scr = (name: string) => { const pane = paneOf(run, name); return (screens[pane.name] ??= shownOn(id, run, pane.name)); };
			const bad = p.evidence.filter(e => !contains(scr(e.pane), e.quote));
			if (bad.length) throw Error(`Not on screen, so not evidence: ${bad.map(e => `${e.pane}: "${e.quote}"`).join('; ')}. Use lab_look and quote exactly, or fail the expectation.`);
			const wrongAbsent = (p.absent || []).filter(a => contains(scr(a.pane), a.text));
			if (wrongAbsent.length) throw Error(`These ARE on screen: ${wrongAbsent.map(a => `${a.pane}: "${a.text}"`).join('; ')}. Re-check before claiming they are absent.`);
			if (judged(it).length && p.verdict === 'pass' && !p.evidence.length) throw Error('A pass needs at least one quote from the screen.');
			const obs = observed(it).map((l: any) => { const on = contains(scr(l.pane), l.text); return { kind: l.kind, pane: l.pane, text: l.text, ok: l.kind === 'see' ? on : !on }; });
			const judgedOk = judged(it).length ? p.verdict === 'pass' : true;
			// unproven is kept apart from fail so a gap in what the lab can see is not read as wrong behavior. The lab's own See/Absent checks still decide.
			const verdict = !obs.every(o => o.ok) ? 'fail' : p.verdict === 'unproven' ? 'unproven' : judgedOk ? 'pass' : 'fail';
			update(s => { const x = s.items.find((y: any) => y.id === it.id); Object.assign(x, { verdict, running: false, tester: p.verdict, reason: p.reason, evidence: p.evidence, absent: p.absent || [], observed: obs, at: new Date().toISOString() }); });
			const note = obs.length ? '\nLab checks: ' + obs.map(o => `${o.ok ? '✓' : '✗'} ${o.kind} (${o.pane}) "${o.text}"`).join('; ') : '';
			const line = `${MARK[verdict]} ${it.id} · ${it.title}: ${verdict}${verdict !== p.verdict ? ' (the lab\'s own checks overrode your verdict)' : ''}`;
			return text(line + note, `${line} — ${p.reason}`);
		},
	});

	pi.registerTool({
		name: 'lab_finish', label: 'Lab · finish',
		description: 'After every expectation has a verdict: write the report beside the expectations file, save a screenshot of this window, and tell Main the result.',
		parameters: Type.Object({ summary: Type.String({ minLength: 1, maxLength: 800 }) }),
		renderResult,
		async execute(_id, p) {
			const { id, run, state } = load();
			const open = state.items.filter((i: any) => !i.verdict);
			if (open.length) throw Error(`Still unchecked: ${open.map((i: any) => `${i.id} · ${i.title}`).join(', ')}.`);
			const screens: Record<string, string> = Object.fromEntries(Object.keys(run.terminals).filter(k => k !== 'Tester').map(k => [k, core.transcriptText(core.transcript(id, k)) || core.screen(id, run.terminals[k])]));
			if (isWidget(run)) { screens[run.widget.name] = core.widgetHistory(id); screens.Files = core.projectChanges(id); }
			if (isMod(run)) screens.Window = core.modHistory(id) + '\n--- now ---\n' + core.modWindow(id);
			// Show the finished checklist first, so the window screenshot in the report shows the result.
			update(s => { s.result = s.items.every((i: any) => i.verdict === 'pass') ? 'pass' : 'fail'; s.summary = p.summary; });
			await new Promise(r => setTimeout(r, 1500));
			const report = writeReport(id, { summary: p.summary, screens });
			update(s => { s.report = report.file; s.shot = report.shot; s.finished = new Date().toISOString(); });
			core.writeRun(id, { phase: 'finished' });
			const c = core.tally(core.readState(id));
			return text(`Report: ${report.file}\n${c.pass}/${c.total} passed. Done: stop here.`, `${c.pass}/${c.total} passed · report written · Main has the result`);
		},
	});
}
