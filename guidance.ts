// /lab teaches itself where you type: examples after a space, a dim hint after
// the cursor, and /lab --help for the whole guide (no Herdr needed).
import { CustomEditor, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { type AutocompleteItem, CURSOR_MARKER, stripTerminalSequences, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

import fs from 'node:fs';

export const LAB_USAGE = '/lab new|test|suggest|list|stop|report|doctor [Agent]';
export const STARTERS = ['Critic', 'Notes', 'Research'];
export const SUBCOMMANDS = ['new', 'test', 'suggest', 'list', 'stop', 'report', 'doctor'];

const examples: AutocompleteItem[] = [
	{ value: 'new Concierge', label: 'new Concierge', description: 'Grow a new agent: expectations first, then the agent' },
	{ value: 'test Critic', label: 'test Critic', description: 'Check an agent from outside against its expectations' },
	{ value: 'new Critic', label: 'new Critic', description: 'Write expectations for a starter agent' },
	{ value: 'suggest', label: 'suggest', description: 'Propose agents from this project\'s own friction; builds nothing' },
	{ value: 'list', label: 'list', description: 'Labs on this computer and their results' },
	{ value: 'stop', label: 'stop', description: 'Close the last lab: window, core and scratch files' },
	{ value: 'report Critic', label: 'report Critic', description: 'Show the latest report for an agent' },
	{ value: 'doctor', label: 'doctor', description: 'Check Herdr, hc, Pi and /agent before a lab' },
	{ value: '--help', label: '--help', description: 'The whole guide, without starting a lab' },
];
const TEST_FLAGS: AutocompleteItem[] = [
	{ value: '--model ', label: '--model provider/id', description: 'Model for guest Main and the agent (default: this one)' },
	{ value: '--tester-model ', label: '--tester-model provider/id', description: 'Model that judges (default: this one)' },
	{ value: '--behind', label: '--behind', description: 'Open the lab window behind this one' },
];

export function labHelp(shortcut?: string): string {
	return [
		'Herdr Lab · grow and test agents in a private Herdr',
		'A lab is a second Herdr window with its own core, its own Pi profile and a copy of this project. Guest Main opens the agent with /agent; a Black-box tester below it types the steps from the agent\'s expectations, reads what actually appeared and writes a report. It never sees the role\'s instructions. Your everyday Herdr and this conversation are untouched.',
		'',
		...examples.map(item => `/lab ${item.value}  —  ${item.description}`),
		'',
		'Expectations live in agents/<agent>/expectations.md, beside an optional agent.md whose "## Job" section is the agent\'s job. Each "## Title" is one expectation:',
		'  Do (Main): Add a minimum stay rule. Just tell me the rule you\'d add.',
		'  Expect (Critic): points out a decision Main assumed, such as how many nights, and asks about it',
		'  Never (Critic): agrees with Main\'s rule as if the number of nights had been decided',
		'  See (Main): "exact text"      Absent (Main): "exact text"',
		'Do lines are typed exactly as written. Expect and Never are judged by the Tester, which must quote the screen. See and Absent are checked by the lab itself.',
		'',
		'/lab suggest reads this conversation, your agents\' reports and the project\'s records, and proposes up to three agents you don\'t have, each with where it saw the friction and the /lab new line that starts it. It builds nothing.',
		'/lab new asks a few questions, writes the expectations for you to approve, then writes agent.md and runs the lab until the agent passes or needs you. /lab test runs the same check again after you change the agent or its expectations.',
		'Reports: agents/<agent>/reports/<time>-<run>.md with a screenshot. The lab stays open so you can look; /lab stop closes it.',
		'Models: guest Main uses this conversation\'s model unless you pass --model. The agent opens on /agent\'s fast default (Haiku), as it would for you, unless --agent-model provider/id (or main). The Tester uses Main\'s model unless --tester-model. Each lab run costs model tokens.',
		`Type a space after /lab for examples; ↑/↓ and Tab insert one.${shortcut ? ` Shortcut: ${shortcut}.` : ''}`,
	].join('\n');
}

const keep = (prefix: string, label = 'Keep what I typed'): AutocompleteItem => ({ value: prefix, label, description: 'Use my own wording' });

/** Each value replaces the whole argument prefix. Free-form text is never swapped for an example. */
export function labCompletions(prefix: string, roles: () => string[] = () => STARTERS): AutocompleteItem[] | null {
	if (!prefix.trim()) return examples;
	if (prefix === '--help' || prefix === '-h') return null;
	if (prefix.startsWith('-')) return '--help'.startsWith(prefix) ? [examples.at(-1)!] : null;
	const [sub, ...rest] = prefix.split(' ');
	if (!rest.length) {
		const hits = examples.filter(e => e.value.startsWith(prefix.toLowerCase()) && e.value !== prefix);
		const subs = SUBCOMMANDS.filter(s => s.startsWith(prefix.toLowerCase()) && s !== prefix).map(s => ({ value: s + (['list', 'doctor', 'stop', 'suggest'].includes(s) ? '' : ' '), label: s, description: examples.find(e => e.value.startsWith(s))!.description }));
		return subs.length ? subs : hits.length ? hits : null;
	}
	const arg = rest.join(' ');
	if (['test', 'new', 'report'].includes(sub)) {
		if (!arg.includes(' ')) {
			const names = [...new Set([...roles(), ...(sub === 'new' ? STARTERS : [])])];
			const matches = names.filter(n => n.toLowerCase().startsWith(arg.toLowerCase()) && n !== arg);
			if (!matches.length) return null;
			return [...(arg ? [keep(prefix)] : []), ...matches.map(n => ({ value: `${sub} ${n}${sub === 'test' ? ' ' : ''}`, label: n, description: sub === 'test' ? 'Has expectations' : sub === 'new' && STARTERS.includes(n) ? 'Starter role: write its expectations' : 'Grow this agent' }))];
		}
		if (sub === 'test') {
			const last = rest.at(-1) ?? '';
			if (last === '' || last.startsWith('-')) {
				const used = new Set(rest);
				const flags = TEST_FLAGS.filter(f => !used.has(f.value.trim()) && f.value.startsWith(last));
				const head = prefix.slice(0, prefix.length - last.length);
				return flags.length ? flags.map(f => ({ ...f, value: head + f.value })) : null;
			}
		}
	}
	return null;
}

export function labHint(text: string): string | undefined {
	if (!/^\/lab(?: |$)/.test(text) || /[\r\n]/.test(text)) return undefined;
	const args = text.slice(4).trimStart();
	if (!args) return text === '/lab' ? 'new|test|list|stop [Agent] · Space: examples' : 'new|test|list|stop [Agent] · ↑/↓ + Tab: insert example';
	if (/^(--help|-h)\s*$/.test(args)) return 'Show the guide without starting a lab';
	const [sub, ...rest] = args.split(' ');
	const arg = rest.join(' ');
	switch (sub) {
		case 'new': return !arg ? '<Agent> [what it should do] · e.g. Concierge' : !arg.includes(' ') ? '[what it should do] · Enter: start the interview' : 'Enter: start the interview';
		case 'test': return !arg ? '<Agent> [--model provider/id] · Tab: agents with expectations' : /--(tester-|agent-|role-)?model\s*$/.test(arg) ? 'provider/id' : '[--model provider/id] [--tester-model provider/id] [--behind] · Enter: run the lab';
		case 'report': return !arg ? '<Agent> · its latest report' : 'Enter: show the report';
		case 'stop': return !arg ? '[run ID | all] · default: the last lab you started' : 'Enter: close it';
		case 'suggest': return !arg ? '[what to look at] · Enter: propose up to three agents, build nothing' : 'Enter: propose agents for this';
		case 'list': return 'Enter: labs on this computer';
		case 'doctor': return 'Enter: check before your first lab';
		default: return SUBCOMMANDS.some(s => s.startsWith(sub)) ? 'Tab: complete the command' : `Unknown. Try ${LAB_USAGE}`;
	}
}

export function installLabGuidance(ctx: ExtensionContext, roles: () => string[]): void {
	if (ctx.mode !== 'tui') return;
	ctx.ui.addAutocompleteProvider(current => ({
		triggerCharacters: current.triggerCharacters,
		getSuggestions(lines, line, col, options) {
			const before = (lines[line] ?? '').slice(0, col);
			if (options.force && line === 0 && lines.length === 1 && before.startsWith('/lab ') && before === lines[0]) {
				const prefix = before.slice(5);
				const items = labCompletions(prefix, roles);
				if (items) return Promise.resolve({ prefix, items });
			}
			return current.getSuggestions(lines, line, col, options);
		},
		shouldTriggerFileCompletion: (lines, line, col) => (line === 0 && lines.length === 1 && lines[0].slice(0, col).startsWith('/lab ')) || (current.shouldTriggerFileCompletion?.(lines, line, col) ?? true),
		applyCompletion: (lines, line, col, item, prefix) => current.applyCompletion(lines, line, col, item, prefix),
	}));
	// Pi has no per-command inline hint API: decorate only the blank padding after the cursor.
	const prior = ctx.ui.getEditorComponent();
	ctx.ui.setEditorComponent((tui, theme, keys) => {
		const editor = prior?.(tui, theme, keys) ?? new CustomEditor(tui, theme, keys, { embedWorkingStatus: true });
		const render = editor.render.bind(editor);
		editor.render = width => {
			const rows = render(width);
			const hint = labHint(editor.getText());
			if (!hint) return rows;
			const i = rows.findIndex(row => row.includes(CURSOR_MARKER));
			if (i < 0) return rows;
			const row = rows[i];
			const tail = row.slice(row.indexOf(CURSOR_MARKER) + CURSOR_MARKER.length);
			if (stripTerminalSequences(tail).trim()) return rows;
			const base = row.trimEnd();
			const room = Math.min(width - visibleWidth(base), row.length - base.length);
			if (room < 4) return rows;
			const suffix = truncateToWidth(hint, room);
			rows[i] = base + ctx.ui.theme.fg('dim', suffix) + ' '.repeat(room - visibleWidth(suffix));
			return rows;
		};
		return editor;
	});
}

/** /lab suggest: Main reads the project's own friction and proposes agents it doesn't have yet. Nothing is built. */
export function suggestPrompt(existing: string[], focus?: string): string {
	const template = fs.readFileSync(new URL('./suggest.md', import.meta.url), 'utf8');
	return template
		.replaceAll('{{focusLine}}', focus ? `, looking at: “${focus}”` : '')
		.replaceAll('{{existing}}', existing.length ? existing.join(', ') : 'none yet');
}
