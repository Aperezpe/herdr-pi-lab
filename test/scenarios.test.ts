import { expect, test } from 'bun:test';
import { adHocCheck, CHECK_ERRORS, CheckError, checkResult, headline, judgeStep, checkMessage, isScenariosFile, parseScenarios, pickChecks, renderCheckReport, resolveChecks, SCENARIOS_FORMAT } from '../scenarios.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const spec = () => parseScenarios(SCENARIOS_FORMAT);
const code = (fn: () => unknown) => { try { fn(); } catch (e) { expect(e).toBeInstanceOf(CheckError); expect(CHECK_ERRORS).toContain((e as CheckError).code); return (e as CheckError).code; } return 'no error'; };

test('the scenarios file from the video parses into two checks, one step per line', () => {
	const s = spec();
	expect(s.title).toBe('Lab scenarios');
	expect(s.checks.map(c => [c.id, c.title, c.steps.length])).toEqual([[1, 'The lab itself works', 4], [2, 'Extensions carry over', 3]]);
	expect(s.checks[0].steps.map(x => x.text)).toEqual(['Open a new pane in the lab workspace.', 'Run ls in that pane.', 'Take a screenshot.', 'Close the pane.']);
	expect(s.checks[1].steps.map(x => x.kind)).toEqual(['do', 'question', 'question']);
});

test('bullets and numbered lines are steps too; prose before the first check is ignored', () => {
	const s = parseScenarios('# Checks\nWhy these exist.\n\n## Lists\n- Open a pane.\n2. Does it open?\n');
	expect(s.checks[0].steps.map(x => x.text)).toEqual(['Open a pane.', 'Does it open?']);
});

test('a file without checks, or a check without steps, is refused by name', () => {
	expect(code(() => parseScenarios('# Lab scenarios\njust words'))).toBe('no-checks');
	expect(code(() => parseScenarios('## 1 · Empty\n\n## 2 · Full\nRun ls.'))).toBe('empty-check');
});

test('a check is chosen the way a person says it', () => {
	const ids = (w?: string) => pickChecks(spec(), w).map((c: any) => c.id);
	expect(ids()).toEqual([1, 2]);
	expect(ids('1')).toEqual([1]);
	expect(ids('the first check in lab-scenarios.md')).toEqual([1]);
	expect(ids('the /split check')).toEqual([2]);
	expect(ids('/split')).toEqual([2]);
	expect(ids('extensions carry over')).toEqual([2]);
	expect(ids('last')).toEqual([2]);
});

test('an unknown or ambiguous choice starts nothing', () => {
	expect(code(() => pickChecks(spec(), '7'))).toBe('no-such-check');
	expect(code(() => pickChecks(spec(), 'the booking check'))).toBe('no-such-check');
	expect(code(() => pickChecks(spec(), 'pane'))).toBe('ambiguous-check');
});

test('a check in plain words becomes one step per sentence', () => {
	const c = adHocCheck('Open a pane, run ls. Does it list README.md? Close the pane.');
	expect(c.steps.map(s => [s.text, s.kind])).toEqual([['Open a pane, run ls.', 'do'], ['Does it list README.md?', 'question'], ['Close the pane.', 'do']]);
	expect(code(() => adHocCheck('  '))).toBe('empty-check');
});

const captured = '[lab] opened pane P2 (shell) · panes now: P1, P2\n--- P2: end of screen ---\n% ls\nREADME.md   package.json\n   src  tests\n';
const claim = (over: object) => ({ step: 2, tried: 'ls in P2', expected: 'a file listing', got: 'README.md and package.json', verdict: 'pass' as const, quote: 'README.md package.json src', ...over });

test('a step passes only with a quote the lab captured; wrapping and spacing do not matter', () => {
	const steps = spec().checks[0].steps;
	expect(judgeStep(captured, steps, claim({}))).toMatchObject({ id: 2, text: 'Run ls in that pane.', verdict: 'pass' });
	expect(code(() => judgeStep(captured, steps, claim({ quote: 'node_modules' })))).toBe('quote-not-on-screen');
	expect(code(() => judgeStep(captured, steps, claim({ quote: '' })))).toBe('pass-needs-quote');
	expect(code(() => judgeStep(captured, steps, claim({ step: 9 })))).toBe('no-such-step');
});

test('a failed step may have no quote, but an invented quote is still refused', () => {
	const steps = spec().checks[0].steps;
	expect(judgeStep(captured, steps, claim({ step: 3, verdict: 'fail', quote: undefined })).verdict).toBe('fail');
	expect(code(() => judgeStep(captured, steps, claim({ step: 3, verdict: 'fail', quote: 'screenshot saved' })))).toBe('quote-not-on-screen');
});

const done = (verdicts: (string | null)[]) => spec().checks[0].steps.map((s, i) => ({ id: s.id, title: s.text, verdict: verdicts[i], tried: 'T', expected: 'E', got: 'G', quote: 'Q' }));

test('the result needs every step reported; one failed step fails the check', () => {
	expect(checkResult(done(['pass', 'pass', 'pass', 'pass']))).toBe('pass');
	expect(checkResult(done(['pass', 'fail', 'pass', 'pass']))).toBe('fail');
	expect(code(() => checkResult(done(['pass', null, 'pass', 'pass'])))).toBe('steps-unfinished');
});

test('the headline reads as in the video', () => {
	const check = spec().checks[0];
	expect(headline(check, done(['pass', 'pass', 'pass', 'pass']))).toBe('scenario 1 passed · 4 of 4 steps');
	expect(headline(check, done(['pass', 'pass', 'fail', 'pass']))).toBe('scenario 1 failed · 3 of 4 steps');
	expect(headline({ ...check, adHoc: true }, done(['pass', 'pass', 'pass', 'pass']))).toBe('check passed · 4 of 4 steps');
});

test('the report gives each step a tick or a cross and says tried, expected, got', () => {
	const check = spec().checks[0];
	const md = renderCheckReport({ check, items: done(['pass', 'pass', 'fail', 'pass']), summary: 'Three of four.', run: 'lab-abc123', when: 'today', source: 'lab-scenarios.md · 1', shot: '/x/y/shot.png', screens: { 'What the lab captured': 'a ~~~ b' } });
	expect(md).toContain('# Lab report · The lab itself works');
	expect(md).toContain('**scenario 1 failed · 3 of 4 steps**');
	expect(md).toContain('## ✓ 2 · Run ls in that pane.');
	expect(md).toContain('## ✗ 3 · Take a screenshot.');
	expect(md).toContain('I tried T, expected E, but got G.');
	expect(md).toContain('I tried T, expected E, and got G.');
	expect(md).toContain('![The lab window during the check](shot.png)');
	expect(md).toContain('a ~ ~ ~ b');
});

test('what was asked resolves to checks before any lab starts', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-scn-'));
	expect(isScenariosFile('lab-scenarios.md')).toBe(true);
	expect(isScenariosFile('Critic')).toBe(false);
	expect(code(() => resolveChecks(dir, {}))).toBe('no-scenarios-file');
	fs.writeFileSync(path.join(dir, 'lab-scenarios.md'), SCENARIOS_FORMAT);
	expect(resolveChecks(dir, { check: 'the /split check' }).map(c => c.source)).toEqual(['lab-scenarios.md · 2 · Extensions carry over']);
	expect(resolveChecks(dir, {}).length).toBe(2);
	expect(resolveChecks(dir, { say: 'Open a pane. Run ls.' })[0].check).toMatchObject({ adHoc: true, steps: [{ text: 'Open a pane.' }, { text: 'Run ls.' }] });
	fs.rmSync(dir, { recursive: true });
});

test('Main gets the steps as they came back, or the reason the lab agent did not finish', () => {
	const check = spec().checks[0];
	const text = checkMessage('/p', { run: 'lab-abc123', check, items: done(['pass', 'pass', 'fail', 'pass']), report: '/p/lab-reports/r.md', stopped: true });
	expect(text).toContain('scenario 1 failed · 3 of 4 steps');
	expect(text).toContain('✗ 3 · Take a screenshot. — tried T, expected E, got G');
	expect(text).toContain('`lab-reports/r.md`');
	expect(checkMessage('/p', { check, error: 'The lab agent stopped before finishing.' })).toContain('did not finish');
});
