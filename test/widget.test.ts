import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyProject, widgetData } from '../core.mjs';
import { locateWidget, parse } from '../expectations.mjs';

test('a widget reads its saved sample whenever it has one, and never a live source outside the project', () => {
	for (const type of ['command', 'script', 'mcp']) expect(widgetData({ name: 'w', source: { type } }, true)).toEqual({ sample: true });
	expect(widgetData({ name: 'w', source: { type: 'command' } }, false)).toEqual({ sample: false });
	for (const type of ['script', 'mcp']) expect(widgetData({ name: 'todos', source: { type } }, false).error).toContain('/widget sample todos');
	// A widget that reads only what the lab owns says so, and runs live even with a sample.
	expect(widgetData({ name: 'memories', lab: 'live', source: { type: 'script' } }, true)).toEqual({ sample: false, live: true });
});

test('a widget is found by widgets/<name>/widget.json; its expectations sit beside it', () => {
	const p = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-w-'));
	try {
		expect(locateWidget(p, 'memories')).toBeUndefined();
		fs.mkdirSync(path.join(p, 'widgets/memories'), { recursive: true });
		fs.writeFileSync(path.join(p, 'widgets/memories/widget.json'), '{}');
		expect(locateWidget(p, 'memories')!.missing).toBe(true);
		fs.writeFileSync(path.join(p, 'widgets/memories/expectations.md'), '# m\n## a\nExpect (memories): x\n');
		expect(locateWidget(p, 'Memories')!.missing).toBeUndefined();
	} finally { fs.rmSync(p, { recursive: true, force: true }); }
});

test('Do lines name Main or the widget; Expect without a name is the widget', () => {
	const spec = parse('# m\n## Keep\nDo (memories): select the first item and press Keep\nDo (Main): hi\nExpect: kept\nNever (Main): gets a message\n', 'memories');
	expect(spec.items[0].lines.map((l: any) => `${l.kind}:${l.pane}`)).toEqual(['do:memories', 'do:Main', 'expect:memories', 'never:Main']);
});

test('the widget copy: expectations and reports withheld, instructions and sample copied, state cleared before the commit', () => {
	const p = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-wp-')), dest = p + '-copy';
	try {
		const w = path.join(p, 'widgets/memories');
		fs.mkdirSync(path.join(w, 'state'), { recursive: true }); fs.mkdirSync(path.join(w, 'reports'));
		for (const f of ['widget.json', 'instructions.md', 'sample.txt', 'expectations.md', 'state/pane.json', 'reports/r.md']) fs.writeFileSync(path.join(w, f), '{}');
		require('node:child_process').spawnSync('git', ['init', '-q'], { cwd: p });
		copyProject(p, dest, undefined, ['widgets/memories/expectations.md'], (d: string) => fs.rmSync(path.join(d, 'widgets/memories/state'), { recursive: true, force: true }));
		const has = (f: string) => fs.existsSync(path.join(dest, 'widgets/memories', f));
		expect(['widget.json', 'instructions.md', 'sample.txt'].every(has)).toBe(true);
		expect(['expectations.md', 'state', 'reports'].some(has)).toBe(false);
		const st = require('node:child_process').spawnSync('git', ['status', '--porcelain'], { cwd: dest, encoding: 'utf8' }).stdout;
		expect(st).toBe('');
	} finally { fs.rmSync(p, { recursive: true, force: true }); fs.rmSync(dest, { recursive: true, force: true }); }
});
