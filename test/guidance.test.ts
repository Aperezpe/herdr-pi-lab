import { expect, test } from 'bun:test';
import { CombinedAutocompleteProvider } from '@earendil-works/pi-tui';
import { labCompletions, labHelp, labHint } from '../guidance.ts';

const roles = () => ['Critic', 'Concierge'];

test('a space after /lab lists every example, ending with --help', () => {
	const items = labCompletions('', roles)!;
	expect(items.map(i => i.value)).toEqual(['new Concierge', 'test Critic', 'new Critic', 'list', 'stop', 'report Critic', 'doctor', '--help']);
});

test('subcommands complete, then role names, then test flags', () => {
	expect(labCompletions('te', roles)!.map(i => i.value)).toEqual(['test ']);
	expect(labCompletions('test ', roles)!.map(i => i.value)).toEqual(['test Critic ', 'test Concierge ']);
	expect(labCompletions('test C', roles)![0].label).toBe('Keep what I typed');
	expect(labCompletions('test Critic ', roles)!.map(i => i.value)).toEqual(['test Critic --model ', 'test Critic --tester-model ', 'test Critic --behind']);
	expect(labCompletions('new ', roles)!.map(i => i.label)).toEqual(['Critic', 'Concierge', 'Notes', 'Research']);
});

test('free-form text and finished commands are never replaced', () => {
	for (const p of ['new Concierge Look after guests', 'test Critic --model anthropic/claude', 'list', '--help', 'stop lab-123abc']) expect(labCompletions(p, roles)).toBeNull();
});

test('accepting a role completion through the native provider leaves a runnable command', async () => {
	const native = new CombinedAutocompleteProvider([{ name: 'lab', getArgumentCompletions: (p: string) => labCompletions(p, roles) }]);
	const line = '/lab test ';
	const s = await native.getSuggestions([line], 0, line.length, { signal: new AbortController().signal });
	const item = s!.items.find(i => i.label === 'Critic')!;
	expect(native.applyCompletion([line], 0, line.length, item, s!.prefix).lines[0]).toBe('/lab test Critic ');
});

test('dim hints describe the next argument, only for single-line /lab', () => {
	expect(labHint('/lab')).toContain('Space: examples');
	expect(labHint('/lab new ')).toContain('<Role>');
	expect(labHint('/lab test Critic --model ')).toBe('provider/id');
	expect(labHint('/lab test Critic')).toContain('Enter: run the lab');
	for (const t of ['', '/labs', 'run /lab', '/lab\nmore']) expect(labHint(t)).toBeUndefined();
});

test('help shows the examples and the expectation format', () => {
	const h = labHelp();
	for (const s of ['/lab new Concierge', '/lab test Critic', 'Do (Main):', 'Expect (Critic):', 'roles/<role>/expectations.md', '/lab stop']) expect(h).toContain(s);
});
