import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyPlace, doctorHeadline, doctorText, isCopyPlace } from '../core.mjs';

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
