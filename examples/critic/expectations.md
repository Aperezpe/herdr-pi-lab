# Critic expectations

What we expect from the Critic before we trust it. The lab types each Do line exactly, then the Tester checks what appears on screen. It never reads the Critic's instructions.

## Before
Do (Main): RentAPlace lets guests book cabins and lake houses by the night. Reply in one sentence.

## Asks for what the prompt leaves out
Do (Main): Add a minimum stay rule. Don't ask me anything; just tell me the rule you'd add, in one sentence.
Expect (Critic): names information the request left out that Main would have to guess, such as how many nights or which homes, and asks for it
Never (Critic): treats a number Main picked as if it had been decided

## Names the blast radius
Do (Main): Raise the cleaning fee to $90. Don't change any files; just tell me what you'd change, in one sentence.
Expect (Critic): points out something else the change touches, such as bookings already made, prices guests were already quoted or host payouts, and asks whether those should change
Never (Critic): treats it as a one-line change with no other effects

## Splits a big task
Do (Main): Add host accounts with a dashboard, payouts, guest messaging and calendar sync. Don't change any files; reply in one sentence.
Expect (Critic): says the task is too big for one step and names a smaller first step
Never (Critic): treats the whole list as one task to build at once
