import { expect, test } from 'bun:test';
import { CombinedAutocompleteProvider } from '@earendil-works/pi-tui';
import { labCompletions, labHelp, labHint, suggestPrompt } from '../guidance.ts';

const roles = () => ['Critic', 'Concierge'];

test('a space after /lab lists every example, ending with --help', () => {
	const items = labCompletions('', roles)!;
	expect(items.map(i => i.value)).toEqual(['new Concierge', 'test Critic', 'test lab-scenarios.md 1', 'new Critic', 'suggest', 'list', 'stop', 'report Critic', 'doctor', '--help']);
});

test('subcommands complete, then agent names, then test flags', () => {
	expect(labCompletions('te', roles)!.map(i => i.value)).toEqual(['test ']);
	expect(labCompletions('test ', roles)!.map(i => i.value)).toEqual(['test Critic ', 'test Concierge ']);
	expect(labCompletions('test C', roles)![0].label).toBe('Keep what I typed');
	expect(labCompletions('test Critic ', roles)!.map(i => i.value)).toEqual(['test Critic --model ', 'test Critic --tester-model ', 'test Critic --behind']);
	expect(labCompletions('new ', roles)!.map(i => i.label)).toEqual(['Critic', 'Concierge', 'Notes', 'Research']);
});

test('free-form text and finished commands are never replaced', () => {
	for (const p of ['new Concierge Look after guests', 'test Critic --model anthropic/claude', 'list', '--help', 'stop lab-123abc']) expect(labCompletions(p, roles)).toBeNull();
});

test('accepting an agent completion through the native provider leaves a runnable command', async () => {
	const native = new CombinedAutocompleteProvider([{ name: 'lab', getArgumentCompletions: (p: string) => labCompletions(p, roles) }]);
	const line = '/lab test ';
	const s = await native.getSuggestions([line], 0, line.length, { signal: new AbortController().signal });
	const item = s!.items.find(i => i.label === 'Critic')!;
	expect(native.applyCompletion([line], 0, line.length, item, s!.prefix).lines[0]).toBe('/lab test Critic ');
});

test('dim hints describe the next argument, only for single-line /lab', () => {
	expect(labHint('/lab')).toContain('Space: examples');
	expect(labHint('/lab')).toContain('new|test|doctor');
	expect(labHint('/lab ')).toContain('new|test|doctor');
	expect(labHint('/lab new ')).toContain('<Agent>');
	expect(labHint('/lab test Critic --model ')).toBe('provider/id');
	expect(labHint('/lab test Critic')).toContain('Enter: run the lab');
	for (const t of ['', '/labs', 'run /lab', '/lab\nmore']) expect(labHint(t)).toBeUndefined();
});

test('help shows the examples and the expectation format', () => {
	const h = labHelp();
	for (const s of ['/lab new Concierge', '/lab test Critic', 'Do (Main):', 'Expect (Critic):', 'agents/<agent>/expectations.md', '/lab stop']) expect(h).toContain(s);
});

test('/lab suggest completes, hints, keeps free-form focus, and is in the guide', () => {
	expect(labCompletions('su', roles)!.map(i => i.value)).toEqual(['suggest']);
	expect(labCompletions('suggest guest support', roles)).toBeNull();
	expect(labHint('/lab suggest')).toContain('build nothing');
	expect(labHint('/lab suggest guest support')).toBe('Enter: propose agents for this');
	expect(labHelp()).toContain('/lab suggest');
});

test('the suggest brief names existing agents, asks for a source and a /lab new line, and builds nothing', () => {
	const p = suggestPrompt(['Critic', 'ci-watch'], 'guest support');
	for (const s of ['looking at: “guest support”', 'Critic, ci-watch', "Don't build anything", 'No source, no suggestion', '/lab new <Name>', 'at most three']) expect(p).toContain(s);
	expect(suggestPrompt([])).toContain('none yet');
	expect(suggestPrompt([])).not.toContain('{{');
});

test('the ghost text and the first lines of the guide are the ones in the lesson video', () => {
	expect(labHint('/lab')!.startsWith('<new|test|doctor>')).toBe(true);
	expect(labHint('/lab ')!.startsWith('<new|test|doctor>')).toBe(true);
	expect(labHelp().split('\n').slice(0, 4)).toEqual(['Lab · grow and test agents', '/lab new <name> — interview, then grow an agent', '/lab test <name> — run it against its expectations', '/lab doctor — check the lab workspace and harness']);
});

test('--detached is a testing aid: accepted, never suggested while typing', () => {
	expect(labCompletions('test lab-scenarios.md ', roles)!.map(i => i.label).join(' ')).not.toContain('--detached');
	expect(labHint('/lab test lab-scenarios.md ')).not.toContain('--detached');
	expect(labHelp()).not.toContain('--detached');
});
