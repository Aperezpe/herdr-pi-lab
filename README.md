# Herdr Pi Lab

`/lab`: grow and test Pi agents in a private Herdr. Type `/lab test Critic` and a second Herdr window, **Herdr Lab**, opens beside your own. Its guest Main opens the Critic with `/agent`, and a **Black-box tester** below it types the steps from the Critic's expectations, reads what actually appeared and writes a report. The Tester never sees the agent's instructions, and your everyday Herdr, Pi sessions and project are never touched.

![A Herdr Lab window: guest Main on the left, the agent above right, the Tester's checklist below it](docs/lab-window.png)

The screenshots were taken before 2026-11-11, when an agent was still called a role: where a picture says `/role`, `roles/` or `role.md`, read `/agent`, `agents/` and `agent.md`.

Starting an agent from scratch? `/lab new Concierge` asks you a few questions, writes the expectations first, writes the agent, and runs the lab until the agent passes or needs you.

## Install

Requires macOS or Linux with the [Herdr desktop app](https://github.com/herdrdev/herdr-app) (0.1.12+), `hc` (herdr-core 0.1.17+) and [Pi](https://github.com/earendil-works/pi) 1.4+, plus the `/agent` extension ([herdr-pi-role](https://github.com/johnlindquist/herdr-pi-role)) in the project you're testing. No Docker.

```sh
pi install --local git:github.com/johnlindquist/herdr-pi-role   # /agent, in the project you test
```

```sh
pi install git:github.com/johnlindquist/herdr-pi-lab
```

Then run `/reload` in Pi, and `/lab doctor` once. To remove it: `pi remove git:github.com/johnlindquist/herdr-pi-lab`.

## Use

Type `/lab`: dim text after the cursor shows `new|test|doctor [Agent]`. Add a space and Pi lists examples. Use **↑/↓** and **Tab** to insert one, then edit it. Dim text beside the cursor tells you what you can type next; it never becomes part of the command. `/lab --help` shows the whole guide without starting a lab, even outside Herdr.

![Typing /lab and a space lists examples; dim text after the cursor says what comes next](docs/examples-on-space.png)

| Type | What happens |
|---|---|
| `/lab new Concierge` | Grow a new agent: a short interview, expectations for you to approve, then `agent.md`, then the lab until it passes. |
| `/lab new Concierge Look after guests` | Same, starting from a one-line job. |
| `/lab new Critic` | Write expectations for a starter agent (`Critic`, `Notes`, `Research`). |
| `/lab suggest` | Propose up to three agents this project doesn't have, from its own friction: this conversation, your agents' reports, issues and recent commits. Each comes with where the friction was seen and the `/lab new` line that starts it. Builds nothing. |
| `/lab suggest guest support` | Same, looking at one area. |
| `/lab test Critic` | Check an agent from outside against `agents/critic/expectations.md`. Tab completes the agents that have expectations. |
| `/lab test Critic --model anthropic/claude-haiku-5-5` | Choose the model for guest Main and the agent. `--tester-model` chooses the judge; `--behind` opens the window behind yours. |
| `/lab report Critic` | The latest report for an agent, in this conversation. |
| `/lab list` | Agents with expectations here, and labs on this computer. |
| `/lab stop` | Close the last lab: its window, its core and its scratch files. `/lab stop all` closes every lab. |
| `/lab doctor` | Check Herdr, hc, Pi and `/agent` before your first lab. |
| `/lab --help` | The guide, with these examples. |

While a lab runs, a checklist above your editor shows each expectation: ○ waiting, ◐ checking, ✓ met, ✗ failed. When it finishes, Main gets one message with the result and the report's path. The lab stays open so you can look; `/lab stop` closes it.

## Expectations

Each agent has a folder: `agents/<agent>/expectations.md`, an optional `agent.md`, and `reports/`. A starter agent such as Critic needs only expectations; a new agent's `agent.md` has a `## Job` section, which is the only part `/agent` receives, plus `## Use it when` and `## Examples` for people.

```markdown
# Critic expectations

## Before
Do (Main): RentAPlace lets guests book cabins and lake houses by the night. Reply in one sentence.

## Asks about a skipped decision
Do (Main): Add a minimum stay rule. Don't ask me anything; just tell me the rule you'd add, in one sentence.
Expect (Critic): points out a decision Main assumed, such as how many nights or which homes, and asks about it
Never (Critic): agrees with Main's rule as if the number of nights had been decided

## Only an explicit send reaches Main
Do (Critic): /agent send main Which homes should it cover?
Expect (Main): shows one note from Critic waiting, without starting a new reply
See (Main): "1 agent note"
```

| Line | Who decides |
|---|---|
| `Do (Main): …` / `Do (Critic): …` | The lab types it exactly, as a person would, then waits until Main and the agent go quiet. `Do` lines under `## Before` run before the agent opens. |
| `Run: …` | Only under `## Before`. The lab runs this shell command itself in the project copy before the first prompt, to set up a case such as planting a bug. If it fails, the lab stops and says so. |
| `Expect (…): …` | The Tester judges it from the screen and must quote the pane verbatim. The lab rejects a quote that isn't there. |
| `Never (…): …` | Fails the expectation if it happened. |
| `See (…): "…"` / `Absent (…): "…"` | The lab checks the exact text itself; the Tester can't overrule it. |

`(Agent)` means the agent under test; a line without a pane means Main for Do and the agent otherwise. An agent that changes files or runs commands (a Fixer, say) adds the line `Access: work` under the title of its `agent.md`; the lab then opens it with `/agent --work`, which gives the agent write, edit and shell tools in the project copy (herdr-pi-role from 2026-11-08). Guest Main and other agents keep inspection tools only, so Main can't do the agent's work for it.

Copy the [examples](examples/) into your project's `agents/` folder to start: `critic`, `notes`, `concierge` (a custom agent) and `yesman`, a deliberately bad agent whose report should fail.

## What a lab is

- **Its own Herdr:** a copy of your Herdr app with its own identity (`dev.herdr.lab`, named Herdr Lab), so macOS never confuses it with your everyday Herdr. It starts its own core (`HC_SESSION=lab-…`) and app home, with your Herdr look and keys.
- **Its own Pi:** a scratch Pi profile that links to your model logins (`auth.json`, `models.json`) instead of copying them. Guest Main loads only the `/agent` extension from your project, so other extensions don't change the result.
- **A copy of your project:** tracked files only, without `.git`, `.pi`, secrets-looking files, `agents/` or any `expectations.md`, so the agent can't read its own test. The copy starts as a fresh repository with one commit, `Lab copy`.
- **A Tester that can't look inside:** a separate Pi started with only the lab's tools: type an expectation's steps, read a guest pane, find text, record a verdict, finish. No file, shell or web tools.
- **Reports:** `agents/<agent>/reports/<time>-<run>.md` with every verdict, its quotes, the lab's own checks, the final screens and a screenshot of the lab window.
- **Teardown:** `/lab stop` ends that lab's terminals, quits that window, stops that core and removes `~/.herdr-lab/<run>`. Nothing else is signaled.

Set `HERDR_PI_LAB_BEHIND=1` to open every lab behind your windows, for unattended runs.

Each lab run uses model tokens for guest Main, the agent and the Tester. By default all three use the model of the conversation you start it from.

**Limits.** The lab runs as you, on your computer: the agent can still read files outside the project copy and use the network. Use it for agents you're building, not for untrusted code. Judgments come from a model; See/Absent lines and quote checks are exact. The Tester reads what's on screen now, so a long answer that scrolled away can't be quoted.

The agent opens with `/agent NAME --model fast`: the fast default (Haiku) that `/agent` gives people, so the lab tests what you'll actually use. Pass `--agent-model provider/id` or `--agent-model main` to test another. This needs herdr-pi-role from 2026-11-07 or later; an older `/agent` rejects `fast`.

## Agent interface

The `lab` tool gives an agent the same operations: `help`, `doctor`, `agents`, `test {role, model?, testerModel?, behind?}` (returns the run ID at once), `wait {run, seconds?}` (every verdict with evidence), `status {run}`, `list`, `report {role}`, `stop {run}`. `/lab new` uses it to run the lab after writing an agent.

From a shell or CI:

```sh
node lab.mjs doctor
node lab.mjs check Critic                          # parse the expectations, start nothing
node lab.mjs test Critic --model anthropic/claude-haiku-5-5 --tester-model anthropic/claude-sonnet-5-5 --behind --wait
node lab.mjs list | stop RUN | stop all | leftovers
```

`test --wait` prints every verdict and exits 0 when all expectations pass, 1 when one fails, 2 when the lab couldn't run. It stops the lab afterwards unless `--keep`.

## How it maps to the MEGA.dev lesson

This is John Lindquist's own build of the lab from MEGA.dev S04E01 ("Splitting Conversations, the Lab, and Your First Agents"). The lesson teaches you to build your own for whatever harness and workspace you use; this repository is the finished Pi and Herdr version to compare with. Its siblings are [`/split`](https://github.com/johnlindquist/herdr-pi-split) and [`/agent`](https://github.com/johnlindquist/herdr-pi-role).

| In the lesson | Here |
|---|---|
| Step one, isolate: a separate copy of the workspace that shares your model sign-in, and a copy of the project | [What a lab is](#what-a-lab-is): its own Herdr (`dev.herdr.lab`), its own core and Pi profile linked to your logins, a copy of the tracked files under `~/.herdr-lab/<run>` |
| Step two, drive: type and press keys like a person, read only what is on screen | The lab types each `Do` line with `hc`; the Tester reads the panes and must quote them |
| Step three, report and clean up | `agents/<agent>/reports/<time>-<run>.md` with a screenshot; `/lab stop` closes that window, that core and its scratch files |
| `/lab`, `/lab --help`, `/lab doctor` | The same three. `/lab doctor` checks Herdr, `hc`, Pi and `/agent` |
| An expectations file: Do, Expect, Never | `agents/<agent>/expectations.md`. Do, Expect and Never are lines under one `## heading` per expectation, with the pane in brackets; see [Expectations](#expectations) |
| The Critic's three checks | [examples/critic/expectations.md](examples/critic/expectations.md) |
| `/lab new critic`, then `/lab test critic` | The same. Names are not case sensitive |
| `--agent-model`, `--tester-model`, `--behind` | The same flags |
| Change the agent's job, never loosen the expectations | `/lab new` is told to change the `## Job` in `agent.md` after a failed run, and never the expectations unless you agree one was wrong |

**What this build does not do.** The lesson's first two checks, "open a pane in the lab, run `ls`, take a screenshot, close the pane" and "run `/split` inside the lab", are free-form requests to a lab. This build only runs an agent against its expectations file, and its guest Main loads only the `/agent` extension, so `/split` is not there to test. The traps the isolation step ran into are written down in [TESTING.md](TESTING.md) under "Findings that changed the code".

## Tested

See [TESTING.md](TESTING.md) for the real runs behind this README. Unit tests:

```sh
bun test
```

## License

MIT
