import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, locateMod } from '../expectations.mjs';
import { layoutMods, modSetup } from '../core.mjs';

// A throwaway Herdr app home: one layout naming three mods, two of them installed, plus the mod under test.
function home() {
	const h = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-mods-'));
	for (const m of ['ask', 'side', 'extra']) {
		fs.mkdirSync(path.join(h, 'mods', m), { recursive: true });
		fs.writeFileSync(path.join(h, 'mods', m, 'main.js'), 'export default class X {}');
	}
	fs.writeFileSync(path.join(h, 'mods', 'ask', 'expectations.md'), '# ask\n## A\nDo (ask): hi\nExpect (Window): x');
	fs.mkdirSync(path.join(h, 'layouts'));
	fs.writeFileSync(path.join(h, 'layouts', 'shell.json'), JSON.stringify({
		id: 'root', terminal_menu: 'side', link_handlers: ['links'],
		children: [{ id: 'a', content: { mod: 'ask' } }, { id: 'b', content: { tab: 'active', pane: { header: { content: { mod: 'shipped-only' } } } } }],
	}));
	return h;
}
const snapshot = (dir: string) => JSON.stringify(fs.readdirSync(dir, { recursive: true }).sort());

test('Layout and Mod lines are setup lines under Before, one name each', () => {
	const s = parse('# t\n## Before\nLayout: shell\nMod: extra\nRun: git init\n## A\nDo (ask): type hi\nExpect (Window): a toast', 'ask');
	expect(s.before.map((l: any) => `${l.kind}:${l.text}`)).toEqual(['layout:shell', 'mod:extra', 'run:git init']);
	expect(s.items[0].lines[0]).toMatchObject({ kind: 'do', pane: 'ask' });
	expect(() => parse('## A\nMod: extra\nExpect: x', 'ask')).toThrow(/belong under "## Before"/);
	expect(() => parse('## Before\nLayout: two words\n## A\nExpect: x', 'ask')).toThrow(/takes one name/);
});

test('layoutMods finds content, header, terminal menu and link handler mods', () => {
	const h = home();
	expect(layoutMods(path.join(h, 'layouts', 'shell.json')).sort()).toEqual(['ask', 'links', 'shipped-only', 'side']);
});

test('modSetup installs the mod, its Mod lines and the layout mods that exist, and nothing else', () => {
	const h = home();
	const s = parse('## Before\nLayout: shell\nMod: extra\n## A\nExpect: x', 'ask');
	const setup = modSetup(s, 'ask', h);
	expect(setup.layout).toBe('shell');
	expect(setup.mods.map((m: any) => m.name).sort()).toEqual(['ask', 'extra', 'side']);
	expect(setup.layouts).toEqual([{ name: 'shell', from: path.join(h, 'layouts', 'shell.json') }]);
});

test('an unknown layout or mod fails with the path it looked for', () => {
	const h = home();
	expect(() => modSetup(parse('## Before\nLayout: nope\n## A\nExpect: x', 'ask'), 'ask', h)).toThrow(/No layout nope: .*layouts\/nope\.json is missing/);
	expect(() => modSetup(parse('## Before\nMod: nope\n## A\nExpect: x', 'ask'), 'ask', h)).toThrow(/No mod nope: .*mods\/nope is missing/);
	expect(() => modSetup(parse('## Before\nLayout: shell\nLayout: shell\n## A\nExpect: x', 'ask'), 'ask', h)).toThrow(/one Layout line/);
});

test('working out the setup never writes to the everyday app home', () => {
	const h = home(), before = snapshot(h);
	modSetup(parse('## Before\nLayout: shell\nMod: extra\n## A\nExpect: x', 'ask'), 'ask', h);
	expect(snapshot(h)).toBe(before);
});

test('locateMod finds a mod with main.js and says when it has no expectations', () => {
	const h = home();
	expect(locateMod('ask', h)).toMatchObject({ dir: path.join(h, 'mods', 'ask') });
	expect(locateMod('ask', h).missing).toBeUndefined();
	expect(locateMod('side', h).missing).toBe(true);
	expect(locateMod('nope', h)).toBeUndefined();
});
