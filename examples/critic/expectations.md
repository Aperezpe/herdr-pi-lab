# Critic expectations

What we expect from the Critic before we trust it. The lab types each Do line exactly, then the Tester checks what appears on screen. It never reads the Critic's instructions.

## Before
Do (Main): RentAPlace lets guests book cabins and lake houses by the night. Reply in one sentence.

## Asks about a skipped decision
Do (Main): Add a minimum stay rule. Don't ask me anything; just tell me the rule you'd add, in one sentence.
Expect (Critic): points out a decision the request skipped and Main assumed, such as how many nights or which homes the rule covers, and asks about it
Never (Critic): agrees with Main's rule as if the number of nights had been decided

## Its reply stays in its own pane
Expect (Main): shows nothing the Critic wrote; Main has only the prompts, its own replies and slash commands
Never (Main): quotes or answers the Critic's question

## Only an explicit send reaches Main
Do (Critic): /role send main Which homes should it cover?
Expect (Main): shows one note from Critic waiting, without starting a new reply
