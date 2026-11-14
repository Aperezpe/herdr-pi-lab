# How Herdr Pi Lab was tested

> Runs below predate 2026-11-11, when `/role` became `/agent`, `roles/<role>/role.md` became `agents/<agent>/agent.md` and `--role-model` became `--agent-model`. They are kept as they were typed. The old names still work.

Every run below was real: a real Herdr Lab window (Herdr app 0.1.13 copied as `dev.herdr.lab`), hc 0.1.18, Pi 1.5.0 and real models. Nothing was mocked. macOS only so far; Linux is untested.

## Roles tested with `lab.mjs test … --wait` (2026-11-07)

Test project: a one-file RentAPlace repository with the course's `/role` extension in `.pi/extensions/temporary-role` and the [examples](examples/) in `roles/`. Guest model `anthropic/claude-haiku-5-5` (low thinking), Tester `anthropic/claude-sonnet-5-5`. Four labs ran at once, each in its own window and core.

| Role | Kind | Result | What it shows |
|---|---|---|---|
| Critic (three jobs) | starter, `examples/critic/expectations.md` | 5 of 5 Haiku runs passed 3/3 (lab-479207, lab-365cc7, lab-593e67, lab-003cca, lab-a4107e) on a copy of RentAPlace 09e01d2 | Missing information, blast radius and task size. Before the Critic's job changed, the earlier starter failed “Names the blast radius” on 1 of 2 runs (lab-732a34): it stated side effects as facts and never asked whether they should change. A stale RentAPlace copy without a cleaning fee also failed it, because there was nothing to touch. |
| Critic (earlier expectations) | starter | 3/3 with Sonnet as the guest; with Haiku, 10 of 11 runs passed | The same role can pass and fail: on one Haiku run the Critic flagged the vague scope but didn't ask the question, and the Tester failed expectation 1, quoting “Main's version is clearer, but it is still unverified.” |
| Critic + `role.md` | custom job | 3/3 | A Job that says "ask the person directly" passed. |
| Notes | starter | 3/3 | Records a decision, keeps an open question apart, stays out of Main. |
| Concierge | custom | 2/2 | Comments on a guest reply; says "Nothing for guests here" on engineering work. |
| YesMan | deliberately bad | 2/3, **fails** as intended | "Looks good." is caught: the skipped decision is never raised. Routing checks still pass. |

## `/lab new` end to end

In a Herdr Lab window running Pi with this extension (Sonnet 5.5), in a fresh BuyAThing project: `/lab new RefundGuard Watch Main for refund decisions and make sure who can approve them is clear`.

1. Main showed the one-line "Herdr Lab · grow RefundGuard" card and asked three questions with suggested answers. Reply: "Yes to all three."
2. It wrote `roles/refundguard/expectations.md` (four expectations) and asked for an OK. Reply: "OK, go ahead."
3. It wrote `role.md`, then called `lab` test and wait. A second Herdr Lab window opened from inside the first.
4. Run 1: 1 of 4 failed (it commented on an unrelated rename). Run 2: 2 of 4 failed. It changed only the Job each time.
5. Run 3: 4/4. Main reported the result, the report path and one line per expectation, and left the lab open.

## `/lab test` typed into Pi

In a Herdr Lab window running Pi with this extension, in a RentAPlace copy: `/lab test Critic --model anthropic/claude-haiku-5-5 --tester-model anthropic/claude-sonnet-5-5`. Main's checklist went from `Before: …` and `Opening Critic with /role…` to `Tester checking 0/3`, `1/3`, `2/3`, then posted `Herdr Lab · Critic: all expectations met`, the report path and "The lab is still open for you to look. /lab stop closes it." The checklist cleared itself after about 15 seconds. The first attempt, in a copy without `.pi/`, stopped with the intended error: "The /role extension was not found in this project. Install it here first (pi install --local git:github.com/johnlindquist/herdr-pi-role), or pass --role-extension PATH."

## Findings that changed the code

- `hc read` of a fullscreen Pi only has the visible lines. The Tester failed a Critic that had in fact raised the decision, because the reply had scrolled away. The Tester now also gets each pane's conversation from its Pi session, without the role's forked history or its job.
- The project copy included `roles/`, so the guest could read its own expectations. `roles/`, `reports/` and any `expectations.md` are now left out.
- `open --env` passed the caller's environment, including the everyday core's socket, to the lab app. Every lab command now runs with the lab's environment only.
- The pnpm `pi` shim forks node, so `/role` couldn't match its pane by foreground pid. The lab starts node and Pi's CLI directly.
- In one `/lab new` run, Pi wrote `role.md` and started the lab in the same batch, so the role ran with a placeholder job. A new role without `role.md` is now refused, and the brief says to run the lab only after the files are saved.
- The report's screenshot was taken before the checklist redrew. The result is now shown first.
- Guest Main was running `find /` on the computer. It now gets read-only tools (`read,grep,find,ls`).

## Dense support roles (2026-11-07, later)

After `/role` switched to a verdict plus numbered emoji findings and a fast default, the lab opens roles with `--model fast`. Critic with a fourth expectation (`/role send main #1` delivers exactly one finding): 4 of 4 Haiku runs passed after the Critic stopped listing ✅ "settled" items, which had led it to endorse Main's assumed default (2 of 4 runs failed before). Notes passed 3/3. One run through the new default (`--model fast`) passed 4/4.

## `/lab new` for nine course roles (2026-11-08)

Each run: a Herdr Lab window running Pi (host `anthropic/claude-opus-5-5`, high thinking) with this extension, in a fresh RentAPlace clone (`09e01d2`), started by `scripts/capture.mjs` with `HERDR_PI_LAB_BEHIND=1`. Every lab opened the role on `/role`'s fast default (Haiku); guest Main and the Tester used the host's model. The operator's replies ("Yes to all three.", "OK, go ahead.", the follow-ups below) were typed by the production agent through `capture.mjs send`. Screens, pane text, host transcripts and every report are in the course repository's `.notes/herdr-pi-lab-captures/lab-new-<role>/`.

| Role | Runs | What happened |
|---|---|---|
| op (performance) | 3/3, then 4/4 | Passed first time. The operator added a fourth expectation (never state unchecked facts about the code); writing it, the host found op's own Job recommended an index that already exists in `db/migrations/001-core.sql`, removed it and told op to check and name the file or say "unverified". |
| ci-watch | 1/3, then 3/3 | Run 1: a 🔴 icon before "unknown" read as a confirmed red (Job fixed: plain text, never repeat red/green unchecked); the hash check failed because the lab copy had no commit (expectation corrected with the operator's OK). Only the "unknown" path was exercised: no commits, `gh` not logged in. |
| Scribe | 2/4, 2/4, then 4/4 | Scribe had no way to know today's date. Run 2's fix (ask for the date) made it refuse to write. With the operator's OK the prompts now give the date and the Job says "undated" otherwise. |
| phone | 4/4, then 4/4 | Passed, but a "nothing needed" note still showed. The operator raised the bar (show nothing at all); the Job changed to an empty reply and passed. |
| repro | 4/4, then 5/5 | Passed, but its first heading said "reproduced" though it ran nothing. The operator added that as an expectation; it passed. |
| pm | 3/3 | Passed first time. |
| Research (starter role with a new `role.md`) | 1/3, then 3/3 | Traced the planted overlap bug to `bookings.ts:16` both times, but run 1 said the fix "must come from Main or a role with write access" instead of naming Booking; the Job now requires a closing "Hand to Booking:" line. |
| Booking (work role) | 0/3, 0/3, then 3/3 | Fixed and staged only `bookings.ts` every time; the expectations wrongly required it to tell Main, which a watching role can't ("Observing Main cannot send to Main"). Expect lines now judge its own pane. |
| Fixer (work role) | 2/3, 2/3, 1/3, 2/3, 2/3, then 3/3 | The Fixer's job is the first that changes files, and each run found a harness gap, not a Job problem: guest Main couldn't plant the bug and Fixer had no shell (`Run:` lines and `Access: work` added); `/role --work` only lent tools Main had (Main is read-only); given write tools, guest Main fixed the bug itself and then said it hadn't (Main read-only again; `/role --work` now grants write/edit/bash itself, herdr-pi-role); the fix matched HEAD so nothing could be staged (setup now commits the planted bug). Run 6 passed: Fixer fixed `pricing.ts`, quoted the test's pass line, staged that file and stopped. |

Also found: `/reload` re-reads `index.ts` but keeps already-imported `.mjs` modules, so after changing `core.mjs` or `expectations.mjs` the running `lab` tool kept the old parser; restart Pi, or use `node lab.mjs`, after changing them. After every role, `node lab.mjs leftovers` printed `{"runs":[],"processes":[],"sockets":[]}`.

## Teardown

After every batch, `node lab.mjs leftovers` printed `{"runs":[],"processes":[],"sockets":[]}`, and no Herdr Lab process remained. The everyday Herdr core was never addressed: every hc call runs with `HC_SESSION=lab-…` and the lab's own state folder.

## Not yet tested

- Linux and Windows. Herdr versions other than 0.1.13.
- `/lab` typed into a Pi in your everyday Herdr. The same command ran from a Pi inside a lab window, and the CLI runs were started from a pane of the everyday Herdr with its `HC_*` variables set.
- Several runs of the same expectations to measure how often a role passes (only the Critic has 5 of 5).
- A work role's lab against a real CI provider or a project with history: the copy is one `Lab copy` commit.

## /lab suggest (2026-11-11)

First real run: Pi 1.5.0 in RPC mode, `/lab suggest` sent as the prompt, in a fresh RentAPlace clone holding six roles (booking, ci-watch, fixer, pm, repro, research) and their Lab reports. Main made 43 read-only tool calls in 42 seconds and proposed two roles (ReplayRunner, FixRouter), each with cited report lines and a `/lab new` line; it built nothing. The cited Fixer lines were checked by hand. Not exercised: the command typed in a Herdr window (its one-line card and the dim hint are covered by unit tests only), and a project with customer feedback or a working conversation. In this run the “friction” came from what roles handed back inside Lab tests.

## Checks from lab-scenarios.md (2026-11-14)

The two checks in the lesson's video, run with `--detached` only (no window was opened for these runs): hc 0.1.19, Pi 1.5.0, lab agent on `anthropic/claude-haiku-5-5`. Test project: a three-file repository with the video's `lab-scenarios.md`.

| Run | Result | What it shows |
|---|---|---|
| `lab.mjs test lab-scenarios.md first --detached` | 3 of 4 steps, 17 s | The lab agent opened P2, typed `ls`, quoted the listing from P2's screen and closed P2, each with a quote the lab captured. "Take a screenshot" failed with the lab's own line: a detached lab has no window. Nothing was left running. |
| Main asked in plain words (`pi -p -e index.ts "Use the lab to run the first check in lab-scenarios.md…"`) | The same 3 of 4, 22 s | Main called the `lab` tool's `check` action and reported the steps as they came back, including the failed one. |
| `lab.mjs test lab-scenarios.md /split --detached` | 1 of 3 steps | The harness pane started with `/split` carried over from a checkout beside this one; the lab agent sent a short prompt and typed `/split`. `/split` answered "Terminal t2 does not belong to a Herdr app space", so no picker and no new pane: a detached lab has no Herdr window to split. |

**Not yet run:** both checks in a Herdr Lab window (`--behind` or in front), which is where the screenshot, the picker and the new pane can pass. The window path uses the same `space.new`, `pane.split` and `shot` calls as an agent test, plus `pane.close`.

Finding that changed the code: a fullscreen Pi pads its screen with blank rows, so the last 30 lines of a harness pane were empty and the lab agent saw nothing. The lab now squeezes blank rows before taking the end of a screen.
