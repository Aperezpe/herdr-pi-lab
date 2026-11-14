// Checks: plain-word scenarios a lab agent runs in the lab, from lab-scenarios.md or from one
// sentence. Parsing, choosing a check, the quote rule and the report are deterministic and
// need no Herdr; only reading the screen and deciding what happened need the lab agent.
import fs from 'node:fs';
import path from 'node:path';
import { contains, fold } from './expectations.mjs';

export const SCENARIOS_FILE = 'lab-scenarios.md';
export const REPORTS_DIR = 'lab-reports';

export const SCENARIOS_FORMAT = `# Lab scenarios

## 1 · The lab itself works
Open a new pane in the lab workspace.
Run ls in that pane.
Take a screenshot.
Close the pane.

## 2 · Extensions carry over
Run /split.
Does the picker open?
Does a new pane show up?`;

/** Every way a check can be refused before or while it runs. `code` is stable; the message is for people. */
export const CHECK_ERRORS = ['no-scenarios-file', 'no-checks', 'empty-check', 'no-such-check', 'ambiguous-check', 'no-such-step', 'quote-not-on-screen', 'pass-needs-quote', 'steps-unfinished'];
export class CheckError extends Error {
	/** @param {string} code one of CHECK_ERRORS @param {string} message */
	constructor(code, message) { super(message); this.name = 'CheckError'; this.code = code; }
}

/**
 * Parse lab-scenarios.md: each "## 1 · Title" is one check; each line under it is one step.
 * A line ending in "?" is a question the lab agent answers from the screen.
 * @returns {{title: string, checks: {id: number, title: string, steps: {id: number, text: string, kind: 'do'|'question', line: number}[]}[]}}
 */
export function parseScenarios(markdown) {
	const out = { title: '', checks: [] };
	let check = null, n = 0;
	for (const raw of String(markdown).split(/\r?\n/)) {
		n++;
		const line = raw.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim();
		if (!line || line.startsWith('<!--')) continue;
		const h1 = line.match(/^#\s+(.*)$/);
		if (h1) { out.title = h1[1].trim(); continue; }
		const h2 = line.match(/^##\s+(.*)$/);
		if (h2) { check = { id: out.checks.length + 1, title: h2[1].replace(/^\d+\s*[·.):-]\s*/, '').trim(), steps: [] }; out.checks.push(check); continue; }
		if (!check) continue; // prose before the first check is commentary
		check.steps.push({ id: check.steps.length + 1, text: line, kind: line.endsWith('?') ? 'question' : 'do', line: n });
	}
	if (!out.checks.length) throw new CheckError('no-checks', `No checks yet. Add a "## 1 · Title" heading with one step per line, e.g.:\n${SCENARIOS_FORMAT}`);
	const empty = out.checks.find(c => !c.steps.length);
	if (empty) throw new CheckError('empty-check', `"${empty.title}" has no steps. Write one step or question per line under its heading.`);
	return out;
}

/** A check described in plain words instead of a file: one step per line or sentence. */
export function adHocCheck(text) {
	const parts = String(text).split(/\r?\n|(?<=[.?!])\s+/).map(s => s.trim()).filter(Boolean);
	if (!parts.length) throw new CheckError('empty-check', 'Say what the lab should try, e.g. "Open a pane, run ls, close the pane."');
	return { id: 1, title: parts[0].replace(/[.?!]$/, '').slice(0, 60), steps: parts.map((t, i) => ({ id: i + 1, text: t, kind: t.endsWith('?') ? 'question' : 'do', line: i + 1 })) };
}

const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5 };
const FILLER = /\b(the|a|an|check|checks|scenario|scenarios|test|run|please|lab|in|from|of|now|use|to)\b/gi;

/**
 * Choose checks by what a person said: nothing (all of them), a number, "first"/"last", or words
 * from one check's title or steps ("the /split check"). Never guesses between two matches.
 */
export function pickChecks(spec, wanted) {
	const w = String(wanted ?? '').trim();
	if (!w || /^all$/i.test(w)) return spec.checks;
	const names = spec.checks.map(c => `${c.id} · ${c.title}`).join('; ');
	const bare = w.toLowerCase().replace(/\S+\.md\b/g, ' ').replace(/[^\p{L}\p{N}\s/]/gu, ' ').replace(FILLER, ' ').trim();
	const num = /^\d+$/.test(bare) ? Number(bare) : bare === 'last' ? spec.checks.length : ORDINALS[bare];
	if (num) {
		const c = spec.checks.find(x => x.id === num);
		if (!c) throw new CheckError('no-such-check', `There is no check ${num}. This file has: ${names}.`);
		return [c];
	}
	const q = fold(bare);
	if (!q) throw new CheckError('no-such-check', `Which check? This file has: ${names}.`);
	const inTitle = spec.checks.filter(c => fold(c.title).includes(q));
	const hits = inTitle.length ? inTitle : spec.checks.filter(c => c.steps.some(s => fold(s.text).includes(q)));
	if (!hits.length) throw new CheckError('no-such-check', `No check mentions "${w}". This file has: ${names}.`);
	if (hits.length > 1) throw new CheckError('ambiguous-check', `"${w}" matches ${hits.map(c => c.id).join(' and ')}. Say the number: ${names}.`);
	return hits;
}

/** Where a project keeps its checks: lab-scenarios.md at its root, unless a file is named. */
export function locateScenarios(project, file) {
	const p = path.resolve(project, file || SCENARIOS_FILE);
	if (!fs.existsSync(p)) throw new CheckError('no-scenarios-file', `${path.relative(project, p) || p} was not found. Write it like this:\n${SCENARIOS_FORMAT}`);
	return p;
}

/**
 * The quote rule, in one place: a step the lab agent reports is accepted only when its quote is
 * text the lab itself captured (a pane it read, or the lab's own record of opening, closing and
 * screenshots). A pass without a quote, or with a quote that never appeared, is refused.
 * @param {string} captured everything the lab captured in this run
 * @param {{id:number, text:string}[]} steps the check's steps
 * @param {{step:number, tried:string, expected:string, got:string, verdict:'pass'|'fail', quote?:string}} claim
 */
export function judgeStep(captured, steps, claim) {
	const step = steps.find(s => s.id === claim.step);
	if (!step) throw new CheckError('no-such-step', `There is no step ${claim.step}; this check has 1–${steps.length}.`);
	const quote = String(claim.quote ?? '').trim();
	if (quote && !contains(captured, quote)) throw new CheckError('quote-not-on-screen', `Not on any screen the lab read, so not evidence: "${quote}". Read the pane again and quote it exactly, or fail the step.`);
	if (claim.verdict === 'pass' && fold(quote).length < 2) throw new CheckError('pass-needs-quote', 'A pass needs a quote copied from the screen or from the lab\'s own record.');
	return { id: step.id, text: step.text, tried: claim.tried, expected: claim.expected, got: claim.got, quote, verdict: claim.verdict };
}

export function checkResult(items) {
	const open = items.filter(i => !i.verdict);
	if (open.length) throw new CheckError('steps-unfinished', `Still unreported: ${open.map(i => `${i.id} · ${i.title}`).join(', ')}.`);
	return items.every(i => i.verdict === 'pass') ? 'pass' : 'fail';
}

/** One line for Main: "scenario 1 passed · 4 of 4 steps". */
export function headline(check, items) {
	const ok = items.filter(i => i.verdict === 'pass').length;
	return `${check.adHoc ? 'check' : `scenario ${check.id}`} ${ok === items.length ? 'passed' : 'failed'} · ${ok} of ${items.length} steps`;
}

const fence = s => '~~~text\n' + String(s).replace(/~~~/g, '~ ~ ~').replace(/\s+$/, '') + '\n~~~';

/** The report as Markdown: each step with a tick or a cross and "I tried X, expected Y, got Z". */
export function renderCheckReport({ check, items, summary, run, when, source, shot, screens = {} }) {
	const lines = [
		`# Lab report · ${check.title}`,
		'',
		`**${headline(check, items)}** · ${when} · run \`${run}\``,
		'',
		summary || '',
		'',
		`Check: ${source}`,
		'',
	];
	for (const i of items) {
		lines.push(`## ${i.verdict === 'pass' ? '✓' : '✗'} ${i.id} · ${i.title}`, '');
		if (i.tried) lines.push(`I tried ${i.tried}, expected ${i.expected}, ${i.verdict === 'pass' ? 'and' : 'but'} got ${i.got}.`, '');
		if (i.quote) lines.push(`- On screen: “${i.quote}”`);
		lines.push('');
	}
	if (shot) lines.push(`![The lab window during the check](${path.basename(shot)})`, '');
	const shown = Object.entries(screens).filter(([, s]) => String(s).trim());
	if (shown.length) lines.push('## What each pane showed', '');
	for (const [k, s] of shown) lines.push(`### ${k}`, '', fence(s.length > 8000 ? '…' + s.slice(-8000) : s), '');
	return lines.join('\n');
}

/** `/lab test` takes an agent's name, or a scenarios file (any .md path) whose checks a lab agent runs. */
export const isScenariosFile = arg => /\.md$/i.test(String(arg));

/**
 * Turn what was asked into the checks to run, before any lab starts.
 * @param {string} cwd the project
 * @param {{file?: string, check?: string, say?: string}} q a scenarios file and which check, or one check in plain words
 * @throws {CheckError} no-scenarios-file, no-checks, empty-check, no-such-check, ambiguous-check
 */
export function resolveChecks(cwd, q) {
	if (q.say) return [{ check: { ...adHocCheck(q.say), adHoc: true }, source: undefined }];
	const file = locateScenarios(cwd, q.file);
	return pickChecks(parseScenarios(fs.readFileSync(file, 'utf8')), q.check).map(check => ({ check, source: `${path.relative(cwd, file)} · ${check.id} · ${check.title}` }));
}

const MARK = { pass: '✓', fail: '✗' };
/** A finished check as Main and the person see it: a headline, then every step with a tick or a cross. */
export function checkMessage(cwd, o) {
	if (o.error) return `**Herdr Lab · ${o.check.title}: did not finish**\n\n${o.error}`;
	return [`**Herdr Lab · ${headline(o.check, o.items)}**`, '',
		...o.items.map(i => `${MARK[i.verdict] || '○'} ${i.id} · ${i.title}${i.tried ? ` — tried ${i.tried}, expected ${i.expected}, got ${i.got}` : ''}`), '',
		`Report: \`${path.relative(cwd, o.report)}\``, o.stopped ? 'The lab is closed and its scratch files are removed.' : `The lab is still open: \`/lab stop ${o.run}\` closes it.`].join('\n');
}
