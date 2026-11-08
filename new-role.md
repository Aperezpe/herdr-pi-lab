Use Herdr Lab to grow a role named **{{role}}**{{jobLine}}.

{{starterLine}}

Work in this order and keep each message short:

1. **Interview me.** Ask at most three short questions, all in one message, only about what you can't infer: what job the role does, what should make it speak up, and what it must never do. Suggest an answer for each so I can just say yes.
2. **Write the expectations first**, in `{{expectationsPath}}`, using exactly this format:

{{format}}

   - Write 2–4 expectations. Each one is a short title and the steps a person would type, followed by what must (Expect) and must not (Never) happen on screen. Use See/Absent only for exact text the lab can check by itself.
   - The pane in parentheses is Main or {{role}}. Do lines are typed verbatim into that pane; most belong in Main. Write them as a person would type them. A role watches Main: new prompts in Main reach it.
   - Say what the role should do, never how its prompt should be worded. The tester never sees the prompt.
   - Guest Main can only read files. To set up a case (plant a bug, change data), put `Run: <shell command>` under `## Before`; the lab runs it in the project copy before the first prompt.
   - Show me the file and wait for my OK before going on.
3. {{roleStep}}
4. **Run the lab** once every file is saved (a separate step, never in the same batch as a write): call the `lab` tool with `{"action":"test","role":"{{role}}"}`, then `{"action":"wait","run":"<run ID>"}` until it finishes. The Herdr Lab window shows the run.
5. **If something fails**, read the report it names. Change the role's Job in `role.md`, never the expectations, unless I agree an expectation was wrong. Then stop the old lab with `{"action":"stop","run":"<run ID>"}` and run again. Try at most three runs in total, then tell me what's still failing and what you'd change.
6. **When it passes**, give me the report path and one line per expectation. Leave the last lab open for me to look at; `/lab stop` closes it.
