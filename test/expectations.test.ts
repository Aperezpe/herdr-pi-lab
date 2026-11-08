import { expect, test } from 'bun:test';
import fs from 'node:fs';
import { parse, contains, judged, observed, steps, job, access, panes } from '../expectations.mjs';
import os from 'node:os';
import path from 'node:path';

const critic = fs.readFileSync(new URL('../examples/critic/expectations.md', import.meta.url), 'utf8');

test('the Critic example parses into a Before step and three expectations', () => {
	const s = parse(critic, 'Critic');
	expect(s.before.map((l: any) => l.pane)).toEqual(['Main']);
	expect(s.items.map((i: any) => i.title)).toEqual(['Asks for what the prompt leaves out', 'Names the blast radius', 'Splits a big task']);
	expect(steps(s.items[2])[0]).toMatchObject({ pane: 'Main', text: expect.stringContaining('host accounts') });
	expect(judged(s.items[0]).map((l: any) => l.kind)).toEqual(['expect', 'never']);
});

test('Role means the role under test; See/Absent keep exact quoted text', () => {
	const s = parse('## A\nDo: hi\nSee (Role): "1 role note"\nAbsent (main): “secret”', 'Notes');
	expect(observed(s.items[0])).toMatchObject([{ kind: 'see', pane: 'Notes', text: '1 role note' }, { kind: 'absent', pane: 'Main', text: 'secret' }]);
});

test('mistakes name the line and say how to fix them', () => {
	expect(() => parse('## A\nCheck: something', 'Critic')).toThrow(/Line 2: start with Do, Run, Expect/);
	expect(() => parse('## A\nDo (Main): hi', 'Critic')).toThrow(/has no check/);
	expect(() => parse('# Only a title', 'Critic')).toThrow(/No expectations yet/);
	expect(() => parse('## Before\nExpect: x\n## A\nExpect: y', 'Critic')).toThrow(/Before section only holds Do and Run/);
	expect(() => parse('## A\nRun: rm -rf x\nExpect: y', 'Critic')).toThrow(/Line 2: Run lines belong under "## Before"/);
});

test('screen matching ignores wrapping, case and punctuation, not words', () => {
	const screen = ' Which homes should\n it cover: cabins, lake houses, or\n both?';
	expect(contains(screen, 'which homes should it cover')).toBe(true);
	expect(contains(screen, 'cabins lake houses or both')).toBe(true);
	expect(contains(screen, 'which cabins')).toBe(false);
	expect(contains(screen, '   ')).toBe(false);
});

test('a custom role takes its job from role.md ## Job', () => {
	expect(job(new URL('../examples/concierge', import.meta.url).pathname)).toMatch(/^You look after RentAPlace's guests\..*Never change files\.$/);
	expect(job('/nonexistent')).toBeUndefined();
});

test('Run lines in Before are setup for the lab, typed by no one', () => {
	const s = parse("## Before\nRun: sed -i '' 's/a/b/' src/x.ts\nDo (Main): The test fails.\n## Fixes it\nDo: Fix src/x.ts\nExpect (Fixer): stages src/x.ts", 'Fixer');
	expect(s.before).toMatchObject([{ kind: 'run', pane: 'lab', text: "sed -i '' 's/a/b/' src/x.ts" }, { kind: 'do', pane: 'Main' }]);
	expect([...panes(s, 'Fixer')]).toEqual([]);
});

test('Access: work in role.md opens the role with workspace tools', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-access-'));
	expect(access(dir)).toBe('read');
	fs.writeFileSync(path.join(dir, 'role.md'), '# Fixer\nAccess: work\n\n## Job\nFix the named file.\n');
	expect(access(dir)).toBe('work');
	expect(job(dir)).toBe('Fix the named file.');
	fs.writeFileSync(path.join(dir, 'role.md'), '# Notes\n\n## Job\nKeep notes. Access: work is not a line here.\n');
	expect(access(dir)).toBe('read');
});
