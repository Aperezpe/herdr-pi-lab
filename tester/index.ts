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
const MARK: Record<string, string> = { pass: '✓', fail: '✗', running: '◐', pending: '○' };

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
	const paneOf = (run: any, name: string) => {
		const key = Object.keys(run.terminals).find(k => k !== 'Tester' && k.toLowerCase() === String(name).trim().toLowerCase());
		if (!key) throw Error(`No guest pane called "${name}". Panes: ${Object.keys(run.terminals).filter(k => k !== 'Tester').join(', ')}.`);
		return { name: key, terminal: run.terminals[key] as string };
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
		description: 'Run the Do lines of one expectation exactly as written (typed into the named guest pane), wait until the guest is quiet, and return the end of every guest screen.',
		parameters: Type.Object({ expectation: Type.Integer({ minimum: 1 }) }),
		renderResult,
		async execute(_id, p) {
			const { id, run, spec } = load();
			const it = item(spec, p.expectation);
			update(s => { for (const x of s.items) x.running = x.id === it.id; });
			const log: string[] = [];
			const names = Object.keys(run.terminals).filter(k => k !== 'Tester');
			const seen = Object.fromEntries(names.map(k => [k, core.transcript(id, k).length]));
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

	pi.registerTool({
		name: 'lab_look', label: 'Lab · look',
		description: 'Read a guest pane (Main or the agent): everything it has shown since it opened (prompts typed into it, its replies, notes that arrived), then the end of its screen now.',
		parameters: Type.Object({ pane: Type.String(), lines: Type.Optional(Type.Integer({ minimum: 5, maximum: 200 })) }),
		renderResult,
		async execute(_id, p) {
			const { id, run } = load(); const pane = paneOf(run, p.pane);
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
			const shown = core.screen(id, pane.terminal) + '\n' + core.transcriptText(core.transcript(id, pane.name));
			const r = `${contains(shown, p.text) ? 'found' : 'not found'} on ${pane.name}: "${p.text}"`; return text(r, r);
		},
	});

	pi.registerTool({
		name: 'lab_verdict', label: 'Lab · verdict',
		description: 'Record pass or fail for one expectation, with verbatim quotes from guest panes as evidence. Quotes not on the named pane are rejected. See/Absent lines are checked by the lab and override the verdict.',
		parameters: Type.Object({
			expectation: Type.Integer({ minimum: 1 }),
			verdict: Type.Union([Type.Literal('pass'), Type.Literal('fail')]),
			reason: Type.String({ minLength: 1, maxLength: 600 }),
			evidence: Type.Array(Type.Object({ pane: Type.String(), quote: Type.String({ minLength: 2, maxLength: 300 }) }), { maxItems: 6 }),
			absent: Type.Optional(Type.Array(Type.Object({ pane: Type.String(), text: Type.String({ minLength: 2, maxLength: 200 }) }), { maxItems: 6 })),
		}),
		renderResult,
		async execute(_id, p) {
			const { id, run, spec } = load(); const it = item(spec, p.expectation);
			const screens: Record<string, string> = {};
			const scr = (name: string) => { const pane = paneOf(run, name); return (screens[pane.name] ??= core.screen(id, pane.terminal) + '\n' + core.transcriptText(core.transcript(id, pane.name))); };
			const bad = p.evidence.filter(e => !contains(scr(e.pane), e.quote));
			if (bad.length) throw Error(`Not on screen, so not evidence: ${bad.map(e => `${e.pane}: "${e.quote}"`).join('; ')}. Use lab_look and quote exactly, or fail the expectation.`);
			const wrongAbsent = (p.absent || []).filter(a => contains(scr(a.pane), a.text));
			if (wrongAbsent.length) throw Error(`These ARE on screen: ${wrongAbsent.map(a => `${a.pane}: "${a.text}"`).join('; ')}. Re-check before claiming they are absent.`);
			if (judged(it).length && p.verdict === 'pass' && !p.evidence.length) throw Error('A pass needs at least one quote from the screen.');
			const obs = observed(it).map((l: any) => { const on = contains(scr(l.pane), l.text); return { kind: l.kind, pane: l.pane, text: l.text, ok: l.kind === 'see' ? on : !on }; });
			const judgedOk = judged(it).length ? p.verdict === 'pass' : true;
			const verdict = judgedOk && obs.every(o => o.ok) ? 'pass' : 'fail';
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
			const screens = Object.fromEntries(Object.keys(run.terminals).filter(k => k !== 'Tester').map(k => [k, core.transcriptText(core.transcript(id, k)) || core.screen(id, run.terminals[k])]));
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
