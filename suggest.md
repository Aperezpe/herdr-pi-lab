Suggest roles for this project{{focusLine}}. Don't build anything yet.

A role is worth growing when the same job keeps pulling a person back in: something re-explained, re-checked, re-routed or refused by hand more than once.

1. **Look for that friction in what you can read here**, in this order, and stop when you have enough:
   - this conversation: requests made more than once, corrections, anything set aside “for a person”;
   - the roles this project already has ({{existing}}) and their latest reports in `roles/<role>/reports/`: what they refused, missed or handed back;
   - the project's own records: open issues or a tracker file, saved feedback, recent commits (`git log --oneline -30`).
2. **Propose at most three roles the project doesn't have.** For each one write exactly this:

   **<Name>**: its job in one line
   - Friction: what keeps happening, with where you saw it (a file and line, an issue number, a commit, or a quoted message). No source, no suggestion.
   - Never: the one thing this role must not do
   - Start it: `/lab new <Name> <job in a few words>`

3. **Rank them.** Put first the one that would take the most repeated work off a person. If an existing role already covers a job, say “covered by <role>” and leave it out. If nothing here earns a role, say so and name what you'd want to see first.
4. Stop there. I'll pick one, or none.
