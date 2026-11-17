---
description: How to run a tabletop role-playing session as the game master with The Dice Sanctum dice table - asking the player for rolls, throwing the master's own dice in the open or behind the screen, rolling in the player's place when they are away from the table, and reading the rolls as they land. Use at the start of a session where you are the DM or GM and the player rolls at the table, and whenever you are unsure which dice tool to call.
---

# Running the game with The Dice Sanctum

The player rolls real 3D dice in a browser window; you are the game master. Every result comes out of the physics and is written to a log before anyone sees it. You never make up a number, and you never roll in your head.

If a dice tool answers that the bridge is off or that no table is open, open the table first (the `table` skill of this plugin).

## Who rolls what

| the roll | the tool |
|---|---|
| the player's character: an attack, damage, a saving throw, a check they see | `request_player_roll` |
| monsters, companions you play, anything the world rolls | `dm_roll` |
| a roll whose result the player must not see | `dm_roll` with `secret: true` |
| the player's character, when the player cannot be at the table and has told you to roll for them | `roll_for_player` |

- **The dice of the player's character are the player's.** Ask for them with `request_player_roll`. Roll them yourself only when the player tells you to, and then with `roll_for_player`, never with `dm_roll`.
- **Settle the stakes before the dice land.** Fix the difficulty, and what success and failure mean, before you call the tool. Then the number decides.
- **One turn, one call.** Put the rolls of one turn in a single `dm_roll` (attack and damage together, each with its own label): they land in one throw of at most 30 dice, and every roll has its own line in the answer.
- **Labels are read at the table.** The player sees the label of every open roll on the tray and in the chronicle. Write what is rolled ("Wolf's bite", "Bite damage"), and keep out of it anything the character does not know.

## Asking the player for a roll

`request_player_roll` with `formula`, `label`, and `wait_seconds` up to 110. A notice appears on the table with its own ROLL button, which throws exactly that formula with that label.

- The call answers with the roll. While it waits, the session is busy on that call, and what the player types in the chat waits until it returns.
- If the time runs out, the answer starts with "Waiting". The request stays on the table; the roll reaches you through the channel when it lands, or through `get_rolls`.
- To ask for a roll and keep narrating meanwhile, use `wait_seconds` 0.
- A free roll, made with the table's own controls, never fulfils a request, even with the same formula. If the player wants to roll something else, cancel with `cancel_player_roll` and ask again.

## The master's dice

`dm_roll` with `rolls`: from 1 to 8 entries, each with `formula` and `label`.

- In the open, the master's dice land on the player's tray in a set of their own, and the call returns when they have stopped, a second or two later. Narrate after it returns: the player has just watched the dice.
- With `secret: true` the dice stay behind the screen. The table says only that the master rolled, and the call returns at once. Use it for hidden checks and for anything a monster does unseen. The screen is made of cardboard: the full roll is in the log on the player's machine.
- With no table open, the roll is made and logged all the same, and the answer says so.
- `dm_roll` never rolls the player's dice and never fulfils a request.

## Rolling in the player's place

`roll_for_player` with `rolls`: from 1 to 8 entries, each with `formula` and `label`, like `dm_roll`. It has no `secret`.

- Use it only on the player's word: for one roll they ask you to make, or from when they say they cannot be at the table until they say they are back. Never to save time, and never because a request ran out of time.
- The bridge throws the dice with the same physics. The roll is written in the log as a roll of the player, marked as rolled by the DM. If the table is open it shows the throw in the player's own dice and puts the total where their rolls go; if it is not, the roll is made and logged all the same.
- The answer has every roll with its own line. Tell the player each result plainly, die and modifier, as they would have read it off the table: they did not see it land.
- It fulfils no request. If a request is still open on the table, the answer lists it: cancel with `cancel_player_roll` what this throw replaced.
- These rolls do not come through the channel: they are in the answer to your call.

## Reading the rolls

- When the session was started with the Dice Sanctum channel, every roll of the player enters the conversation by itself as a `<channel ...>` message, as soon as the dice stop, once each. A roll returned by a call does not come through the channel again.
- Without the channel you still get every roll you ask for. For free rolls, call `get_rolls` with the last seq you have seen.
- After any interruption, `get_rolls(since_seq)` returns everything that entered the log meanwhile. `get_status` says whether the table is open and which requests are waiting.
- A result marked NATURAL 20 or NATURAL 1 is a natural: the mark appears only when the formula keeps a single d20.

## Writing dice

| written | means |
|---|---|
| `NdS` | N dice with S sides: d4, d6, d8, d10, d12, d20, d100 (also `d%`) |
| `khN`, `klN` | keep the N highest or lowest of the group: `2d20kh1` is advantage, `2d20kl1` disadvantage |
| `dhN`, `dlN` | drop the N highest or lowest: `4d6dl1` |
| `+`, `-`, numbers | groups and constants add up or subtract: `1d8+1d6+3`, `1d20-1` |

At most 30 physical dice in one throw; a d100 counts as two.

The tools answer in English. Speak to the player in the language of the table.
