// /lab teaches itself where you type: examples after a space, a dim hint after
// the cursor, and /lab --help for the whole guide (no Herdr needed).
import { CustomEditor, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { type AutocompleteItem, CURSOR_MARKER, stripTerminalSequences, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

export const LAB_USAGE = '/lab new|test|list|stop|report|doctor [Role]';
export const STARTERS = ['Critic', 'Notes', 'Research'];
export const SUBCOMMANDS = ['new', 'test', 'list', 'stop', 'report', 'doctor'];

const examples: AutocompleteItem[] = [
	{ value: 'new Concierge', label: 'new Concierge', description: 'Grow a new role: expectations first, then the role' },
	{ value: 'test Critic', label: 'test Critic', description: 'Check a role from outside against its expectations' },
	{ value: 'new Critic', label: 'new Critic', description: 'Write expectations for a starter role' },
	{ value: 'list', label: 'list', description: 'Labs on this computer and their results' },
	{ value: 'stop', label: 'stop', description: 'Close the last lab: window, core and scratch files' },
	{ value: 'report Critic', label: 'report Critic', description: 'Show the latest report for a role' },
	{ value: 'doctor', label: 'doctor', description: 'Check Herdr, hc, Pi and /role before a lab' },
	{ value: '--help', label: '--help', description: 'The whole guide, without starting a lab' },
];
const TEST_FLAGS: AutocompleteItem[] = [
	{ value: '--model ', label: '--model provider/id', description: 'Model for guest Main and the role (default: this one)' },
	{ value: '--tester-model ', label: '--tester-model provider/id', description: 'Model that judges (default: this one)' },
	{ value: '--behind', label: '--behind', description: 'Open the lab window behind this one' },
];

export function labHelp(shortcut?: string): string {
	return [
		'Herdr Lab · grow and test roles in a private Herdr',
		'A lab is a second Herdr window with its own core, its own Pi profile and a copy of this project. Guest Main opens the role with /role; a Black-box tester below it types the steps from the role\'s expectations, reads what actually appeared and writes a report. It never sees the role\'s instructions. Your everyday Herdr and this conversation are untouched.',
		'',
		...examples.map(item => `/lab ${item.value}  —  ${item.description}`),
		'',
		'Expectations live in roles/<role>/expectations.md, beside an optional role.md whose "## Job" section is the role\'s job. Each "## Title" is one expectation:',
		'  Do (Main): Add a minimum stay rule. Just tell me the rule you\'d add.',
		'  Expect (Critic): points out a decision Main assumed, such as how many nights, and asks about it',
		'  Never (Critic): agrees with Main\'s rule as if the number of nights had been decided',
		'  See (Main): "exact text"      Absent (Main): "exact text"',
		'Do lines are typed exactly as written. Expect and Never are judged by the Tester, which must quote the screen. See and Absent are checked by the lab itself.',
		'',
		'/lab new asks a few questions, writes the expectations for you to approve, then writes role.md and runs the lab until the role passes or needs you. /lab test runs the same check again after you change the role or its expectations.',
		'Reports: roles/<role>/reports/<time>-<run>.md with a screenshot. The lab stays open so you can look; /lab stop closes it.',
		'Models: guest Main uses this conversation\'s model unless you pass --model. The role opens on /role\'s fast default (Haiku), as it would for you, unless --role-model provider/id (or main). The Tester uses Main\'s model unless --tester-model. Each lab run costs model tokens.',
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
		const subs = SUBCOMMANDS.filter(s => s.startsWith(prefix.toLowerCase()) && s !== prefix).map(s => ({ value: s + (['list', 'doctor', 'stop'].includes(s) ? '' : ' '), label: s, description: examples.find(e => e.value.startsWith(s))!.description }));
		return subs.length ? subs : hits.length ? hits : null;
	}
	const arg = rest.join(' ');
	if (['test', 'new', 'report'].includes(sub)) {
		if (!arg.includes(' ')) {
			const names = [...new Set([...roles(), ...(sub === 'new' ? STARTERS : [])])];
			const matches = names.filter(n => n.toLowerCase().startsWith(arg.toLowerCase()) && n !== arg);
			if (!matches.length) return null;
			return [...(arg ? [keep(prefix)] : []), ...matches.map(n => ({ value: `${sub} ${n}${sub === 'test' ? ' ' : ''}`, label: n, description: sub === 'test' ? 'Has expectations' : sub === 'new' && STARTERS.includes(n) ? 'Starter role: write its expectations' : 'Grow this role' }))];
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
	if (!args) return text === '/lab' ? 'new|test|list|stop [Role] · Space: examples' : 'new|test|list|stop [Role] · ↑/↓ + Tab: insert example';
	if (/^(--help|-h)\s*$/.test(args)) return 'Show the guide without starting a lab';
	const [sub, ...rest] = args.split(' ');
	const arg = rest.join(' ');
	switch (sub) {
		case 'new': return !arg ? '<Role> [what it should do] · e.g. Concierge' : !arg.includes(' ') ? '[what it should do] · Enter: start the interview' : 'Enter: start the interview';
		case 'test': return !arg ? '<Role> [--model provider/id] · Tab: roles with expectations' : /--(tester-|role-)?model\s*$/.test(arg) ? 'provider/id' : '[--model provider/id] [--tester-model provider/id] [--behind] · Enter: run the lab';
		case 'report': return !arg ? '<Role> · its latest report' : 'Enter: show the report';
		case 'stop': return !arg ? '[run ID | all] · default: the last lab you started' : 'Enter: close it';
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
