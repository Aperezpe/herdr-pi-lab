# How Herdr Pi Lab was tested

Every run below was real: a real Herdr Lab window (Herdr app 0.1.13 copied as `dev.herdr.lab`), hc 0.1.18, Pi 1.5.0 and real models. Nothing was mocked. macOS only so far; Linux is untested.

## Roles tested with `lab.mjs test … --wait` (2026-11-07)

Test project: a one-file RentAPlace repository with the course's `/role` extension in `.pi/extensions/temporary-role` and the [examples](examples/) in `roles/`. Guest model `anthropic/claude-haiku-5-5` (low thinking), Tester `anthropic/claude-sonnet-5-5`. Four labs ran at once, each in its own window and core.

| Role | Kind | Result | What it shows |
|---|---|---|---|
| Critic | starter | 3/3 · passed with Sonnet as the guest; Haiku passed 1 of 2 runs | The same role can pass and fail across runs: on one Haiku run the Critic flagged the vague scope but didn't ask the question, and the Tester failed it with a quote. |
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

## Findings that changed the code

- `hc read` of a fullscreen Pi only has the visible lines. The Tester failed a Critic that had in fact raised the decision, because the reply had scrolled away. The Tester now also gets each pane's conversation from its Pi session, without the role's forked history or its job.
- The project copy included `roles/`, so the guest could read its own expectations. `roles/`, `reports/` and any `expectations.md` are now left out.
- `open --env` passed the caller's environment, including the everyday core's socket, to the lab app. Every lab command now runs with the lab's environment only.
- The pnpm `pi` shim forks node, so `/role` couldn't match its pane by foreground pid. The lab starts node and Pi's CLI directly.
- In one `/lab new` run, Pi wrote `role.md` and started the lab in the same batch, so the role ran with a placeholder job. A new role without `role.md` is now refused, and the brief says to run the lab only after the files are saved.
- The report's screenshot was taken before the checklist redrew. The result is now shown first.
- Guest Main was running `find /` on the computer. It now gets read-only tools (`read,grep,find,ls`).

## Teardown

After every batch, `node lab.mjs leftovers` printed `{"runs":[],"processes":[],"sockets":[]}`, and no Herdr Lab process remained. The everyday Herdr core was never addressed: every hc call runs with `HC_SESSION=lab-…` and the lab's own state folder.

## Not yet tested

- Linux and Windows. Herdr versions other than 0.1.13.
- `/lab` typed into a Pi in your everyday Herdr. The CLI runs above were started from a pane of the everyday Herdr, with its `HC_*` variables set, and the `/lab new` run used the extension from inside a lab window; the everyday-Pi command path itself hasn't been typed by hand yet.
- Several runs of the same expectations to measure how often a role passes.
