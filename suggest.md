Suggest agents for this project{{focusLine}}. Don't build anything yet.

An agent is worth growing when the same job keeps pulling a person back in: something re-explained, re-checked, re-routed or refused by hand more than once.

1. **Look for that friction in what you can read here**, in this order, and stop when you have enough:
   - this conversation: requests made more than once, corrections, anything set aside “for a person”;
   - the agents this project already has ({{existing}}) and their latest reports in `agents/<agent>/reports/`: what they refused, missed or handed back;
   - the project's own records: open issues or a tracker file, saved feedback, recent commits (`git log --oneline -30`).
2. **Propose at most three agents the project doesn't have.** For each one write exactly this:

   **<Name>**: its job in one line
   - Friction: what keeps happening, with where you saw it (a file and line, an issue number, a commit, or a quoted message). No source, no suggestion.
   - Never: the one thing this agent must not do
   - Start it: `/lab new <Name> <job in a few words>`

3. **Rank them.** Put first the one that would take the most repeated work off a person. If an existing agent already covers a job, say “covered by <agent>” and leave it out. If nothing here earns an agent, say so and name what you'd want to see first.
4. Stop there. I'll pick one, or none.
