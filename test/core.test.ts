import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { copyPlace, copyProject, doctorHeadline, doctorText, isCopyPlace, labCopies } from '../core.mjs';

test('/lab doctor leads with the line in the lesson video, then one line per check', () => {
	expect(doctorHeadline(true, true)).toBe('Lab workspace ready · lab harness ready');
	expect(doctorHeadline(false, true)).toBe('Lab workspace not ready · lab harness ready');
	const text = doctorText({ ok: false, headline: doctorHeadline(false, true), checks: [
		{ part: 'workspace', name: 'hc', ok: false, detail: 'hc is not on PATH.' },
		{ part: 'harness', name: 'pi', ok: true, detail: '1.5.0' },
		{ part: 'harness', name: '/agent extension', ok: true, note: true, detail: 'not installed in this project yet.' }] });
	expect(text.split('\n')).toEqual(['Lab workspace not ready · lab harness ready', '✗ hc: hc is not on PATH.', '✓ pi: 1.5.0', '○ /agent extension: not installed in this project yet.', 'Fix the ✗ lines, then run /lab doctor again.']);
});

test('the project copy is ~/.lab/<project>; a second lab on the same project gets its own', () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-home-'));
	try {
		expect(copyPlace('lab-1a2b3c', '/Users/me/dev/RentAPlace', home)).toEqual({ projectName: 'rentaplace', copy: path.join(home, 'rentaplace') });
		fs.mkdirSync(path.join(home, 'rentaplace'));
		expect(copyPlace('lab-4d5e6f', '/Users/me/dev/RentAPlace', home).copy).toBe(path.join(home, 'rentaplace-4d5e6f'));
		// Names the lab's folder already uses are never taken by a project copy.
		expect(copyPlace('lab-1a2b3c', '/x/app', home).copy).toBe(path.join(home, 'app-1a2b3c'));
		expect(copyPlace('lab-1a2b3c', '/x/lab-aaaaaa', home).copy).toBe(path.join(home, 'lab-aaaaaa-1a2b3c'));
	} finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('stopping a lab removes only a project copy directly inside the lab folder', () => {
	const home = '/Users/me/.lab';
	expect(isCopyPlace('/Users/me/.lab/rentaplace', home)).toBe(true);
	for (const p of [undefined, '/Users/me/dev/rentaplace', '/Users/me/.lab', '/Users/me/.lab/app', '/Users/me/.lab/lab-1a2b3c', '/Users/me/.lab/a/b']) expect(isCopyPlace(p as any, home)).toBe(false);
});

test('the rule for the lab copy: the tested agent gets its own folder, never a test', () => {
	const own = 'agents/booking';
	// Its own knowledge files, directly in its folder.
	for (const f of ['agents/booking/agent.md', 'agents/booking/memories.md', 'agents/booking/glossary.md', 'agents/booking/owns.txt', 'roles/booking/role.md']) expect(labCopies(f, f.startsWith('roles') ? 'roles/booking' : own)).toBe(true);
	// Never a test, under any spelling, in its own folder or anywhere else.
	for (const f of ['agents/booking/expectations.md', 'agents/booking/Expectations.md', 'agents/booking/expectations.old.md', 'agents/booking/old-expectations.txt', 'agents/pricing/expectations.md', 'expectations.md', 'docs/expectations.md', 'lab-scenarios.md']) expect(labCopies(f, own)).toBe(false);
	// Reports quote the expectations; subfolders stay out.
	for (const f of ['agents/booking/reports/2026-11-15-lab-ad5a7a.md', 'agents/booking/notes/draft.md', 'lab-reports/x.md']) expect(labCopies(f, own)).toBe(false);
	// Another agent's folder stays out whole.
	for (const f of ['agents/pricing/agent.md', 'agents/pricing/memories.md', 'agents/booking-old/glossary.md', 'packages/api/agents/booking/glossary.md']) expect(labCopies(f, own)).toBe(false);
	// Secrets-looking files stay out even there; the rest of the project is copied as before.
	for (const f of ['agents/booking/secrets.json', 'agents/booking/.env', '.env.local', '.git/config', '.pi/settings.json', 'node_modules/x/index.js']) expect(labCopies(f, own)).toBe(false);
	for (const f of ['src/domain/bookings.ts', 'GLOSSARY.md', 'README.md', 'test/hold-price.test.ts']) expect(labCopies(f, own)).toBe(true);
	// A check (/lab test lab-scenarios.md) tests no agent: no agent folder at all, as before.
	for (const folder of [undefined, '', 'agents', 'agents/', 'src', '.', '../agents/booking', 'agents/booking/reports']) expect(labCopies('agents/booking/glossary.md', folder as any)).toBe(false);
});

test('a lab copy of a real project holds the agent\'s knowledge and no expectations file', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-copy-'));
	const project = path.join(tmp, 'project'), put = (f: string, text = f) => { fs.mkdirSync(path.dirname(path.join(project, f)), { recursive: true }); fs.writeFileSync(path.join(project, f), text); };
	const all = (dir: string) => (fs.readdirSync(dir, { recursive: true }) as string[]).filter(f => !f.startsWith('.git') && fs.statSync(path.join(dir, f)).isFile()).map(f => f.split(path.sep).join('/')).sort();
	try {
		for (const f of ['src/bookings.ts', 'GLOSSARY.md', 'lab-scenarios.md',
			'agents/booking/agent.md', 'agents/booking/memories.md', 'agents/booking/glossary.md', 'agents/booking/owns.txt', 'agents/booking/checks.md', 'agents/booking/reports/run.md',
			'agents/pricing/agent.md', 'agents/pricing/glossary.md', 'agents/pricing/expectations.md']) put(f);
		put('agents/booking/expectations.md', 'SECRET-EXPECTATION');
		fs.symlinkSync('expectations.md', path.join(project, 'agents/booking/link.md')); // a link to the test is not a file
		spawnSync('git', ['init', '-q'], { cwd: project });

		const forAgent = path.join(tmp, 'for-agent');
		copyProject(project, forAgent, 'agents/booking');
		expect(all(forAgent)).toEqual(['GLOSSARY.md', 'agents/booking/agent.md', 'agents/booking/checks.md', 'agents/booking/glossary.md', 'agents/booking/memories.md', 'agents/booking/owns.txt', 'src/bookings.ts']);
		expect(spawnSync('grep', ['-rl', 'SECRET-EXPECTATION', forAgent], { encoding: 'utf8' }).stdout).toBe('');

		// An expectations file under another name (start({ expectations })) is withheld by path.
		const named = path.join(tmp, 'named');
		copyProject(project, named, 'agents/booking', ['agents/booking/checks.md']);
		expect(all(named)).not.toContain('agents/booking/checks.md');

		// A check tests no agent, so no agent folder is copied: what the lab did before 0.5.0.
		const forCheck = path.join(tmp, 'for-check');
		copyProject(project, forCheck);
		expect(all(forCheck)).toEqual(['GLOSSARY.md', 'src/bookings.ts']);
	} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
