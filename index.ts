// Herdr Pi Lab: /lab grows and tests roles in a private Herdr with a built-in Black-box tester.
import { getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Markdown, Text, truncateToWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';
import { Type } from 'typebox';
import fs from 'node:fs';
import path from 'node:path';
import * as core from './core.mjs';
import { FORMAT, locate, slug } from './expectations.mjs';
import { installLabGuidance, labCompletions, labHelp, LAB_USAGE, STARTERS, suggestPrompt } from './guidance.ts';

const MSG = 'herdr-pi-lab';
const NEW = 'herdr-pi-lab.new';
const SUGGEST = 'herdr-pi-lab.suggest';
const MARK: Record<string, string> = { pass: '✓', fail: '✗', running: '◐', pending: '○' };

/** Roles in this project that already have expectations, for completion and /lab list. */
export function projectRoles(cwd: string): string[] {
	const out: string[] = [];
	for (const dir of ['roles', 'agents']) {
		const root = path.join(cwd, dir);
		if (!fs.existsSync(root)) continue;
		for (const n of fs.readdirSync(root)) if (fs.existsSync(path.join(root, n, 'expectations.md'))) out.push(titleOf(path.join(root, n), n));
	}
	return [...new Set(out)];
}
function titleOf(dir: string, fallback: string) {
	try { const h = fs.readFileSync(path.join(dir, 'expectations.md'), 'utf8').match(/^#\s+(\S+)/m); if (h && /^[a-z][\w-]*$/i.test(h[1])) return h[1]; } catch {}
	return fallback[0].toUpperCase() + fallback.slice(1);
}

export function parseTest(args: string[]) {
	const o: Record<string, any> = { role: '' };
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === '--model' || a === '--role-model' || a === '--tester-model' || a === '--role-extension' || a === '--thinking') { const v = args[++i]; if (!v) throw Error(`${a} needs a value.`); o[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v; }
		else if (a === '--behind') o.background = true;
		else if (a.startsWith('--')) throw Error(`Unknown option ${a}. Try /lab --help.`);
		else if (!o.role) o.role = a;
		else throw Error(`Unexpected "${a}". Usage: /lab test <Role> [--model provider/id].`);
	}
	if (!o.role) throw Error('Which role? e.g. /lab test Critic');
	return o;
}

export function newRolePrompt(cwd: string, role: string, job?: string): string {
	const template = fs.readFileSync(new URL('./new-role.md', import.meta.url), 'utf8');
	const starter = STARTERS.some(s => s.toLowerCase() === role.toLowerCase());
	const loc = locate(cwd, role);
	const rel = path.relative(cwd, loc.file);
	const exists = !loc.missing;
	return template
		.replaceAll('{{role}}', role)
		.replaceAll('{{jobLine}}', job ? `: “${job}”` : '')
		.replaceAll('{{starterLine}}', [
			starter ? `${role} is a starter role that /role already knows, so only its expectations are new.` : `${role} is a new role. It will live in \`${path.dirname(rel)}/\`.`,
			exists ? `\`${rel}\` already exists: read it first and propose changes instead of starting over.` : '',
		].filter(Boolean).join(' '))
		.replaceAll('{{expectationsPath}}', rel)
		.replaceAll('{{format}}', FORMAT.split('\n').map(l => '   ' + l).join('\n').replace(/^ {3}/, '   ~~~markdown\n   ') + '\n   ~~~')
		.replaceAll('{{roleStep}}', starter
			? `${role} needs no role.md; /role supplies its job. Skip to the lab.`
			: `**Write the role** in \`${path.dirname(rel)}/role.md\`: \`# ${role}\`, then \`## Job\` (one paragraph telling the role what to do, under 2,400 characters; this is the only part /role receives), \`## Use it when\` (two bullets), and \`## Examples\` (two prompts someone types in Main, and what ${role} does). If ${role} must change files or run commands, add the line \`Access: work\` under the title. Then go straight to the lab.`);
}

export default function herdrPiLab(pi: ExtensionAPI): void {
	let ctxRef: ExtensionContext | undefined;
	let lastRun: string | undefined;
	const watching = new Map<string, ReturnType<typeof setInterval>>();

	// A lab result reads as Markdown; /lab new shows one line, with the full brief on expand (ctrl+o).
	pi.registerMessageRenderer(MSG, (msg: any, opts: any, theme: any) => {
		const pad = opts.outputPad ?? 1, md = new Markdown(String(msg.content), pad, 0, getMarkdownTheme());
		return { invalidate() { md.invalidate(); }, render(width: number) { return md.render(width); } };
	});
	pi.registerMessageRenderer(NEW, (msg: any, opts: any, theme: any) => {
		const pad = opts.outputPad ?? 1, d = msg.details || {};
		const head = theme.fg('accent', theme.bold(`Herdr Lab · grow ${d.role || 'a role'}`)) + theme.fg('dim', d.starter ? '  ·  starter role: expectations only' : '');
		if (opts.expanded) { const md = new Markdown(String(msg.content), pad, 0, getMarkdownTheme()); return { invalidate() { md.invalidate(); }, render(w: number) { return [truncateToWidth(' '.repeat(pad) + head, w), ...md.render(w)]; } }; }
		return { invalidate() {}, render(width: number) {
			const w = Math.max(1, width - pad * 2);
			const job = d.job ? wrapTextWithAnsi(theme.fg('muted', `“${d.job}”`), w) : [];
			const steps = theme.fg('dim', 'interview → expectations → ' + (d.starter ? '' : 'role.md → ') + 'lab → report   (ctrl+o: full brief)');
			return [head, ...job, steps].map(l => truncateToWidth(' '.repeat(pad) + l, width));
		} };
	});
	pi.registerMessageRenderer(SUGGEST, (msg: any, opts: any, theme: any) => {
		const pad = opts.outputPad ?? 1, d = msg.details || {};
		const head = theme.fg('accent', theme.bold('Herdr Lab · suggest roles')) + theme.fg('dim', d.focus ? `  ·  “${d.focus}”` : '');
		if (opts.expanded) { const md = new Markdown(String(msg.content), pad, 0, getMarkdownTheme()); return { invalidate() { md.invalidate(); }, render(w: number) { return [truncateToWidth(' '.repeat(pad) + head, w), ...md.render(w)]; } }; }
		const steps = theme.fg('dim', 'this conversation → role reports → project records → up to three roles, nothing built   (ctrl+o: full brief)');
		return { invalidate() {}, render(width: number) { return [head, steps].map(l => truncateToWidth(' '.repeat(pad) + l, width)); } };
	});
	pi.on('session_start', (_e, ctx) => { ctxRef = ctx; installLabGuidance(ctx, () => projectRoles(ctx.cwd)); });
	pi.on('session_shutdown', () => { for (const t of watching.values()) clearInterval(t); watching.clear(); });

	const say = (text: string) => pi.sendMessage({ customType: MSG, content: text, display: true });
	const modelOf = (ctx: ExtensionContext) => ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
	const thinking = () => { try { return (pi as any).getThinkingLevel?.() as string | undefined; } catch { return undefined; } };

	function widget(id: string) {
		const ctx = ctxRef; if (!ctx?.hasUI) return;
		const s = core.readState(id), r = core.readRun(id);
		if (!s || !r) { ctx.ui.setWidget(MSG, undefined); return; }
		const c = core.tally(s);
		const head = s.result ? `Herdr Lab · ${r.role} · ${s.result === 'pass' ? 'all expectations met' : `${c.fail} of ${c.total} failed`} · /lab report ${r.role}`
			: `Herdr Lab · ${r.role} · ${r.phase === 'testing' ? `Tester checking ${c.pass + c.fail}/${c.total}` : r.phase}`;
		ctx.ui.setWidget(MSG, [head, ...s.items.map((i: any) => `  ${MARK[i.verdict || (i.running ? 'running' : 'pending')]} ${i.id} · ${i.title}`)]);
	}

	function watch(id: string) {
		if (watching.has(id)) return;
		const t = setInterval(() => {
			const s = core.readState(id), r = core.readRun(id);
			if (!r || !s) { clearInterval(t); watching.delete(id); ctxRef?.ui.setWidget(MSG, undefined); return; }
			widget(id);
			if (s.result && s.report) {
				clearInterval(t); watching.delete(id);
				const c = core.tally(s);
				say([`**Herdr Lab · ${r.role}: ${s.result === 'pass' ? 'all expectations met' : `${c.fail} of ${c.total} failed`}**`, '',
					...s.items.map((i: any) => `${MARK[i.verdict]} ${i.id} · ${i.title}${i.verdict === 'fail' && i.reason ? ` — ${i.reason}` : ''}`), '',
					`Report: \`${path.relative(r.project, s.report)}\``, `The lab is still open for you to look. \`/lab stop\` closes it.`].join('\n'));
				setTimeout(() => ctxRef?.ui.setWidget(MSG, undefined), 15000);
			}
			if (r.phase === 'failed') { clearInterval(t); watching.delete(id); }
		}, 1500);
		watching.set(id, t);
	}

	async function test(ctx: ExtensionContext, o: Record<string, any>) {
		const model = o.model || modelOf(ctx);
		if (!model) throw Error('No model is selected. Choose one with /model, or pass --model provider/id.');
		const options = { project: ctx.cwd, role: o.role, model, roleModel: o.roleModel, thinking: o.thinking || thinking(), testerModel: o.testerModel || model, testerThinking: o.testerModel ? undefined : (o.thinking || thinking()), background: !!o.background, roleExtension: o.roleExtension };
		const run = await core.start(options, step => { if (ctx.hasUI) ctx.ui.setWidget(MSG, [`Herdr Lab · ${o.role} · ${step}…`]); });
		lastRun = run.id; watch(run.id);
		return run;
	}

	async function command(raw: string, ctx: ExtensionContext) {
		const args = raw.trim().split(/\s+/).filter(Boolean);
		const sub = args.shift() || '';
		try {
			if (!sub || sub === '--help' || sub === '-h' || sub === 'help') { ctx.ui.notify(labHelp(), 'info'); return; }
			if (sub === 'doctor') {
				const d = core.doctor(ctx.cwd);
				ctx.ui.notify(['Herdr Lab doctor', ...d.checks.map(c => `${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`), d.ok ? 'Ready for /lab test or /lab new.' : 'Fix the ✗ lines first.'].join('\n'), d.ok ? 'info' : 'error');
				return;
			}
			if (sub === 'list') {
				const runs = core.list();
				const mine = projectRoles(ctx.cwd);
				ctx.ui.notify([`Roles with expectations here: ${mine.join(', ') || 'none yet (try /lab new Critic)'}`, runs.length ? 'Labs on this computer:' : 'No labs on this computer.',
					...runs.map(r => `${r.id}  ${r.role}  ${r.core === 'running' ? 'open' : 'stopped'}  ${r.result ? (r.result === 'pass' ? '✓ passed' : `✗ ${r.counts?.fail} failed`) : r.phase}`)].join('\n'), 'info');
				return;
			}
			if (sub === 'stop') {
				const target = args[0] || lastRun || core.list().find(r => r.core === 'running')?.id;
				if (!target) { ctx.ui.notify('No lab to stop. /lab list shows them.', 'warning'); return; }
				const ids = target === 'all' ? core.list().map(r => r.id) : [target];
				for (const id of ids) { const r = await core.stop(id); ctx.ui.notify(`Stopped ${r.id}: ${r.done.join(', ') || 'nothing was running'}; scratch files removed. Reports stay in the project.`, 'info'); if (id === lastRun) lastRun = undefined; }
				ctx.ui.setWidget(MSG, undefined);
				return;
			}
			if (sub === 'report') {
				const role = args[0]; if (!role) throw Error('Which role? e.g. /lab report Critic');
				const dir = path.join(locate(ctx.cwd, role).dir, 'reports');
				const latest = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort().at(-1) : undefined;
				if (!latest) { ctx.ui.notify(`No reports for ${role} yet. Run /lab test ${role}.`, 'warning'); return; }
				say(fs.readFileSync(path.join(dir, latest), 'utf8').split('## What each pane showed')[0].replace(/!\[[^\]]*\]\([^)]*\)\n?/g, '') + `\nFull report: \`${path.relative(ctx.cwd, path.join(dir, latest))}\``);
				return;
			}
			if (sub === 'test') {
				const o = parseTest(args);
				await test(ctx, o);
				return;
			}
			if (sub === 'new') {
				const role = args.shift();
				if (!role || !/^[a-z][a-z0-9_-]{0,31}$/i.test(role)) throw Error('Name the role in one word, e.g. /lab new Concierge');
				const job = args.join(' ') || undefined;
				if (!ctx.isIdle()) throw Error('Wait for this turn to finish, then run /lab new again.');
				pi.sendMessage({ customType: NEW, content: newRolePrompt(ctx.cwd, role, job), display: true, details: { role, job, starter: STARTERS.some(s => s.toLowerCase() === role.toLowerCase()) } }, { triggerTurn: true });
				return;
			}
			if (sub === 'suggest') {
				const focus = args.join(' ') || undefined;
				if (!ctx.isIdle()) throw Error('Wait for this turn to finish, then run /lab suggest again.');
				pi.sendMessage({ customType: SUGGEST, content: suggestPrompt(projectRoles(ctx.cwd), focus), display: true, details: { focus } }, { triggerTurn: true });
				return;
			}
			throw Error(`Unknown /lab command "${sub}". Usage: ${LAB_USAGE}. /lab --help shows examples.`);
		} catch (e: any) {
			ctx.ui.setWidget(MSG, undefined);
			ctx.ui.notify(`${e.message}${e.run ? ` (run ${e.run})` : ''}`, 'error');
		}
	}

	pi.registerCommand('lab', {
		description: 'Grow and test roles in a private Herdr with a Black-box tester. /lab --help for examples.',
		getArgumentCompletions: (prefix: string) => labCompletions(prefix, () => (ctxRef ? projectRoles(ctxRef.cwd) : STARTERS)),
		handler: (args, ctx) => command(args, ctx),
	});

	const out = (v: unknown, summary?: string) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }], details: { summary } });
	pi.registerTool({
		name: 'lab',
		label: 'Herdr Lab',
		description: 'Black-box test a Pi role in a private Herdr window. Actions: help; doctor; roles (expectations in this project); test {role, model?, testerModel?, behind?} starts a lab and returns its run ID at once; wait {run, seconds?} blocks until the Tester finishes (default 600 s) and returns every verdict with evidence; status {run}; list; report {role} (latest report text); stop {run}. The lab opens a visible Herdr Lab window. A start receipt is not a result: use wait. Write expectations in roles/<role>/expectations.md (format in help).',
		parameters: Type.Object({
			action: Type.Union(['help', 'doctor', 'roles', 'test', 'wait', 'status', 'list', 'report', 'stop'].map(v => Type.Literal(v))),
			role: Type.Optional(Type.String()), run: Type.Optional(Type.String()), model: Type.Optional(Type.String()), testerModel: Type.Optional(Type.String()),
			behind: Type.Optional(Type.Boolean()), seconds: Type.Optional(Type.Integer({ minimum: 5, maximum: 1800 })),
		}),
		renderResult(result: any, options: any, theme: any) {
			const full = result.content?.map((c: any) => c.text).join('\n') ?? '';
			const summary = result.details?.summary;
			return new Text(options.expanded || !summary ? theme.fg('toolOutput', full) : theme.fg('muted', summary), 0, 0);
		},
		async execute(_id, p, signal, _u, ctx) {
			switch (p.action) {
				case 'help': return out(labHelp() + '\n\nExpectations format:\n' + FORMAT);
				case 'doctor': return out(core.doctor(ctx.cwd));
				case 'roles': return out({ roles: projectRoles(ctx.cwd), starters: STARTERS });
				case 'list': return out(core.list());
				case 'test': {
					if (!p.role) throw Error('test needs role.');
					const run = await test(ctx, { role: p.role, model: p.model, testerModel: p.testerModel, background: p.behind });
					return out({ started: true, run: run.id, role: run.role, terminals: run.terminals, next: `wait {"run":"${run.id}"}` }, `Herdr Lab opened ${run.id}: ${Object.keys(run.terminals).join(' · ')}`);
				}
				case 'status': { if (!p.run) throw Error('status needs run.'); return out({ run: core.readRun(p.run), state: core.readState(p.run), core: core.coreUp(p.run) ? 'running' : 'stopped' }); }
				case 'wait': {
					if (!p.run) throw Error('wait needs run.');
					const end = Date.now() + (p.seconds || 600) * 1000;
					while (Date.now() < end && !signal?.aborted) {
						const s = core.readState(p.run), r = core.readRun(p.run);
						if (!r) throw Error(`No lab ${p.run}.`);
						if (r.phase === 'failed') return out({ finished: false, failed: r.error });
						if (s?.result && s.report) return out({ finished: true, result: s.result, report: s.report, summary: s.summary, items: s.items.map((i: any) => ({ id: i.id, title: i.title, verdict: i.verdict, reason: i.reason, evidence: i.evidence, observed: i.observed })) },
							[`${s.result === 'pass' ? '✓ all expectations met' : `✗ ${core.tally(s).fail} of ${s.items.length} failed`} · ${path.relative(ctx.cwd, s.report)}`, ...s.items.map((i: any) => `  ${MARK[i.verdict]} ${i.id} · ${i.title}`)].join('\n'));
						await new Promise(res => setTimeout(res, 2000));
					}
					return out({ finished: false, waiting: true, state: core.readState(p.run), note: 'Still running; call wait again.' });
				}
				case 'report': {
					if (!p.role) throw Error('report needs role.');
					const dir = path.join(locate(ctx.cwd, p.role).dir, 'reports');
					const latest = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort().at(-1) : undefined;
					return out(latest ? fs.readFileSync(path.join(dir, latest), 'utf8') : `No reports for ${p.role}.`);
				}
				case 'stop': { if (!p.run) throw Error('stop needs run.'); const r = await core.stop(p.run); if (p.run === lastRun) lastRun = undefined; return out(r, `Stopped ${r.id}: ${r.done.join(', ')}`); }
			}
			throw Error('Unknown action.');
		},
	});
}
