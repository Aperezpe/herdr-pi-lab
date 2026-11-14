// The lab agent for a check. It runs as a headless Pi in the background of Main, started with
// only these tools (--tools allowlist, --no-extensions) in an empty folder, so it cannot read
// files or run a shell of its own: it can only open, type into, read and close panes in the lab,
// and report each step with a quote the lab itself captured.
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import fs from 'node:fs';
import path from 'node:path';
import * as core from '../core.mjs';
import { checkResult, headline, judgeStep, renderCheckReport, REPORTS_DIR } from '../scenarios.mjs';

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }], details: {} });
const stamp = (d: Date) => d.toISOString().replace(/[:]/g, '').replace(/\..*$/, '').replace('T', '-');

export default function (pi: ExtensionAPI) {
	pi.registerFlag('lab-run', { type: 'string', description: 'Herdr Lab run ID for this lab agent.' });
	const runId = () => {
		const id = pi.getFlag('lab-run');
		if (typeof id !== 'string' || !core.ID_RE.test(id)) throw Error('This lab agent was not started by Herdr Lab.');
		if (core.readRun(id)?.kind !== 'check') throw Error('This lab run is not a check.');
		return id;
	};

	pi.registerTool({
		name: 'lab_open', label: 'Lab · open a pane',
		description: 'Open a new pane in the lab workspace. program "shell" is a terminal in the copy of the project; "harness" starts the coding agent there with the extensions that carried over.',
		parameters: Type.Object({ program: Type.Union([Type.Literal('shell'), Type.Literal('harness')]) }),
		async execute(_id, p) { const id = runId(); const line = await core.openPane(id, p.program); await core.still(id, { quiet: 2, seconds: 60 }); return text(line + '\n' + core.readPanes(id)); },
	});
	pi.registerTool({
		name: 'lab_type', label: 'Lab · type',
		description: 'Type one line into a pane and press Enter, as a person would, wait until the screens stop changing, then return the end of every pane.',
		parameters: Type.Object({ pane: Type.String(), text: Type.String({ minLength: 1, maxLength: 2000 }) }),
		async execute(_id, p) { return text(await core.typeInPane(runId(), p.pane, p.text)); },
	});
	pi.registerTool({
		name: 'lab_keys', label: 'Lab · keys',
		description: 'Press named keys in a pane (enter, esc, up, down, tab, ctrl+c), then return the end of every pane. Use it to answer a picker.',
		parameters: Type.Object({ pane: Type.String(), keys: Type.Array(Type.String({ minLength: 1, maxLength: 20 }), { minItems: 1, maxItems: 8 }) }),
		async execute(_id, p) { return text(await core.pressKeys(runId(), p.pane, p.keys)); },
	});
	pi.registerTool({
		name: 'lab_read', label: 'Lab · read',
		description: 'Read the screen of one pane, or of every pane when none is named. Lists the panes that exist now, including any the lab agent did not open itself.',
		parameters: Type.Object({ pane: Type.Optional(Type.String()), lines: Type.Optional(Type.Integer({ minimum: 5, maximum: 200 })) }),
		async execute(_id, p) { return text(core.readPanes(runId(), p.pane, p.lines || 40)); },
	});
	pi.registerTool({
		name: 'lab_shot', label: 'Lab · screenshot',
		description: 'Take a screenshot of the lab window. Returns the lab\'s own record line, which can be quoted.',
		parameters: Type.Object({}),
		async execute() { return text(core.screenshot(runId())); },
	});
	pi.registerTool({
		name: 'lab_close', label: 'Lab · close a pane',
		description: 'Close a pane by name. Returns the lab\'s own record line with the panes that remain.',
		parameters: Type.Object({ pane: Type.String() }),
		async execute(_id, p) { return text(await core.closePane(runId(), p.pane)); },
	});
	pi.registerTool({
		name: 'lab_step', label: 'Lab · report a step',
		description: 'Report one step of the check: what you tried, what you expected, what you got, pass or fail, and a quote copied from a screen or from a "[lab]" record line. A quote the lab never captured is rejected.',
		parameters: Type.Object({
			step: Type.Integer({ minimum: 1 }),
			tried: Type.String({ minLength: 1, maxLength: 300 }), expected: Type.String({ minLength: 1, maxLength: 300 }), got: Type.String({ minLength: 1, maxLength: 300 }),
			verdict: Type.Union([Type.Literal('pass'), Type.Literal('fail')]),
			quote: Type.Optional(Type.String({ maxLength: 300 })),
		}),
		async execute(_id, p) {
			const id = runId(), run = core.readRun(id), state = core.readState(id);
			const r = judgeStep(core.captured(id), run.check.steps, p);
			Object.assign(state.items.find((i: any) => i.id === r.id), { verdict: r.verdict, tried: r.tried, expected: r.expected, got: r.got, quote: r.quote, at: new Date().toISOString() });
			core.writeState(id, state);
			return text(`${r.verdict === 'pass' ? '✓' : '✗'} ${r.id} · ${r.text}`);
		},
	});
	pi.registerTool({
		name: 'lab_finish', label: 'Lab · finish',
		description: 'After every step is reported: write the report into the project and send the result to Main. Then stop.',
		parameters: Type.Object({ summary: Type.String({ minLength: 1, maxLength: 800 }) }),
		async execute(_id, p) {
			const id = runId(), run = core.readRun(id), state = core.readState(id);
			const result = checkResult(state.items);
			const dir = path.join(run.project, REPORTS_DIR);
			fs.mkdirSync(dir, { recursive: true });
			const base = path.join(dir, `${stamp(new Date())}-${id}`);
			const last = (run.shots || []).at(-1);
			const shot = last && fs.existsSync(last) ? base + '.png' : undefined;
			if (shot) fs.copyFileSync(last, shot);
			fs.writeFileSync(base + '.md', renderCheckReport({ check: run.check, items: state.items, summary: p.summary, run: id, when: new Date().toLocaleString(), source: run.source, shot, screens: { 'What the lab captured': core.captured(id) } }));
			core.writeState(id, { ...state, result, summary: p.summary, report: base + '.md', shot, finished: new Date().toISOString() });
			core.writeRun(id, { phase: 'finished' });
			return text(`Report: ${base}.md\n${headline(run.check, state.items)}. Done: stop here.`);
		},
	});
}
