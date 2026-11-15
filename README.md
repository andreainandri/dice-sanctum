# The Dice Sanctum

A 3D dice table with real physics, made for playing tabletop role-playing games with Claude Code as the game master.

You roll on a walnut tray in your browser. As soon as the dice stop, the roll reaches the DM's Claude Code session through a small local bridge and an MCP server. The DM can also ask you for a roll: a notice appears on the table with its own ROLL button, and the result comes back inside the same tool call.

![The table: a walnut tray lined with burgundy velvet, obsidian dice with gold numbers, the DM's request at the top and the chronicle of rolls on the right](docs/table.jpg)

*In italiano: [README.it.md](README.it.md)*

## How it works

Three pieces, all on your machine:

- **the table**: a web page (three.js for the scene, Rapier for the physics) open in a browser window;
- **the bridge**: a Node process on `127.0.0.1:4777` that serves the page, talks to the table, writes the roll log and answers the MCP server;
- **the MCP server** `dice-sanctum`: four tools for the DM, and a channel that pushes your rolls into the session.

Every result comes from the physics: the dice leave your hand with a random spin and speed, bounce off the walls, and the value is read from the face that ends up on top. The bridge checks every roll it receives (formula, dice values, kept dice, total) before it writes it down.

## Requirements

- Node.js 24 or newer
- a browser with WebGL 2 (developed on Chromium; Firefox and Safari should work and are still to be tried)
- Claude Code, for the DM side (the table also works on its own)

Developed and tested on Linux. The start script, the bridge and the MCP server are written to run on macOS and Windows as well; nobody has tried them there yet, and reports are welcome.

## Quick start

```sh
git clone https://github.com/andreainandri/dice-sanctum.git
cd dice-sanctum
npm install
npm start
```

`npm start` builds the page when needed, starts the bridge in the foreground and opens the table in your default browser. Ctrl+C stops the bridge. When the bridge is already running, `npm start` only opens the table.

Then register the MCP server with Claude Code, once:

```sh
claude mcp add dice-sanctum --scope user -e DICE_SANCTUM_PLAYER=YourName -- node /absolute/path/to/dice-sanctum/src/mcp/server.ts
```

`DICE_SANCTUM_PLAYER` is the name the DM reads in the results ("Ada rolled r-0007: …"); without it, the texts say "the player". The server's instructions tell Claude to use it only in the DM session.

### Rolls in real time

Claude Code can receive your rolls the moment they land, even while the session is idle, through *channels*, a research preview. Start the DM session with:

```sh
claude --dangerously-load-development-channels server:dice-sanctum --allowedTools=mcp__dice-sanctum
```

At startup Claude Code warns about development channels: choose "I am using this for local development". From then on every roll enters the conversation as a message like `<channel source="dice-sanctum" seq="12" kind="free" total="25">Free roll by Ada: Perception 1d20+5: [20] +5 = 25 · NATURAL 20</channel>`, and the DM answers right away. `--allowedTools` lets the DM use the four tools without a permission prompt at every roll.

Tested with Claude Code 2.1.325, where channels are a research preview; the flag may change in later versions.

Without channels, the DM still gets every roll it asks for, because `request_player_roll` returns the result. For your free rolls it can keep the Monitor tool on the roll log:

```sh
tail -n0 -F ~/.local/share/dice-sanctum/tiri.jsonl | grep --line-buffered '"type":"roll.completed"'
```

(the roll log lives elsewhere on macOS and Windows: see [Configuration](#configuration)), and call `get_rolls` with the last seq it saw whenever it re-arms the Monitor.

## At the table

- **The dice panel** on the left: a click on a die's name adds one, `+` and `−` change the count. The formula field follows the panel, and the panel follows the field.
- **The formula**: `1d20+5`, `2d20kh1+5`, `4d6kh3`, `8d6`, `1d100`, `2d6+1d4-1`. At most 30 physical dice per roll (a d100 counts as two). The label, optional, says what you are rolling.
- **ROLL**, **Enter** in the field or **Space** outside the fields: roll. **ADVANTAGE** and **DISADVANTAGE** roll two d20s and keep the higher or the lower, leaving the field as it is. **CLEAR** takes the dice off the tray and empties the fields; the chronicle stays.
- **The result** in large type above the tray: a natural 20 in gold, with the die lighting up for a moment, and a natural 1 in red.
- **The chronicle** on the right: time, label, formula, dice (the discarded ones dimmed), total, and "asked by the DM" on the rolls of a request. It refills from the roll log every time the page opens.
- **The DM's notice** at the top: "The DM asks: **Constitution saving throw**, 1d20+3" with its own ROLL button, which rolls exactly that formula with that label. With several requests, the oldest sits on top.
- **The connection status** at the top right. Rolls made while disconnected wait in a queue, kept in the browser's storage so they survive closing the window, and leave on their own as soon as the bridge answers, each one once.

The page speaks English or Italian, following the browser's language; `?lingua=en` or `?lingua=it` in the address picks one. It adapts to the window: below 900 pixels of width the dice move to a strip under the tray and the chronicle opens from a button.

### Dice notation

| written | means |
|---|---|
| `NdS` | N dice with S sides: d4, d6, d8, d10, d12, d20, d100 (also `d%`) |
| `khN`, `klN` | keep the N highest or lowest of the group: `2d20kh1` is advantage |
| `dhN`, `dlN` | drop the N highest or lowest: `4d6dl1` |
| `+`, `-`, numbers | groups and constants add up or subtract: `1d8+1d6+3`, `1d20-1` |

A d100 is two d10s, tens and units, and 00 with 0 makes 100. A natural 20 or 1 counts when the formula keeps a single d20 in a group that adds up: `1d20+5` and `2d20kh1+5` yes, `2d20+3` no.

## For the DM

The same guidance, in short, is in the MCP server's instructions, which Claude Code puts in the session's context.

| tool | arguments | answers |
|---|---|---|
| `get_status` | none | bridge on or off, tables connected, last seq, open requests (oldest first) |
| `get_rolls` | `since_seq?`, `limit?` (1 to 500) | the events after `since_seq`, one per line with its seq; without arguments the last 10 |
| `request_player_roll` | `formula`, `label`, `wait_seconds?` (0 to 110) | the roll, or "Waiting"; a clear error when no table is open or the bridge is off |
| `cancel_player_roll` | `requestId` | cancelled; if it was already rolled, the roll |

- **A roll of the character** (an attack, damage, a saving throw, a check the player sees): `request_player_roll` with `wait_seconds` up to 110. The call returns the roll: "Ada rolled r-0007: Constitution saving throw 1d20+3: [14] +3 = 17 (seq 42)." While it waits, the session is busy on that call, and what the player types in the chat stays queued until the call returns. To ask for a roll and keep narrating, use `wait_seconds` 0.
- **When the time runs out** before the roll, the answer is "Waiting: …". The request stays on the table, and the roll arrives through the channel when it lands.
- **Free rolls**, made with the normal controls, arrive through the channel as soon as the dice stop. Every roll reaches the DM once: a roll returned by a call stays out of the channel.
- **A free roll never fulfils a request**, even with the same formula. When the player wants to roll something else, the DM cancels with `cancel_player_roll` and asks again.
- **After an interruption**, `get_rolls(since_seq)` returns everything that entered the roll log in the meantime.

Why 110 seconds: Claude Code moves an MCP call that lasts longer than 120 seconds to the background (`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`). With 110 the answer always comes back into the conversation.

## Configuration

Environment variables, all optional:

| variable | read by | default |
|---|---|---|
| `DICE_SANCTUM_PORT` | the bridge, `npm start` | `4777` |
| `DICE_SANCTUM_ROLL_LOG` | the bridge | `tiri.jsonl` in the data folder |
| `DICE_SANCTUM_CLIENT_DIR` | the bridge | `dist/client` in the project |
| `DICE_SANCTUM_URL` | the MCP server | `http://127.0.0.1:4777` |
| `DICE_SANCTUM_PLAYER` | the MCP server | `the player` |

The data folder is `$XDG_DATA_HOME/dice-sanctum` (or `~/.local/share/dice-sanctum`) on Linux, `~/Library/Application Support/dice-sanctum` on macOS and `%APPDATA%\dice-sanctum` on Windows.

The roll log (*tiri* is Italian for rolls) is a JSONL file that only grows: one compact JSON line per event (`request.created`, `roll.completed`, `request.cancelled`), each one on disk (fsync) before anyone sees it. Only the bridge assigns the `seq`. When it restarts, the bridge reads the file back and rebuilds the last seq, the rolls already seen and the open requests.

## Security

The bridge is meant for one person on one machine, and it has no tokens. What protects it:

- it listens on `127.0.0.1` only, and answers only to `Host: 127.0.0.1:PORT` or `localhost:PORT`, against DNS rebinding;
- the table's WebSocket accepts only the app's own origin; the feed of the MCP server accepts processes (which send no Origin) and the app's origin, and refuses web pages;
- the HTTP API requires `Content-Type: application/json` and refuses any other Origin and any body over 64 KB, so a web page open in your browser cannot create roll requests;
- at most 30 dice per roll; no `eval`, and nothing received ever runs as a command;
- the bridge recomputes every roll from the dice values and refuses what does not add up.

Any program running under your user account can still talk to the bridge: that is where the trust ends.

## Fairness

Simulated throws with the same physics, the same source of randomness (`crypto.getRandomValues`) and the same face reading as the table: 20,000 dice per test, each kind alone and in groups of five, compared with a uniform distribution by a chi-square test. No die shows any sign of bias; the lowest p-value across all the tests is 0.082. The full report, in Italian, is in [docs/equita.md](docs/equita.md), and `npm run fairness` runs it again.

One bias was found and removed on the way. Rapier builds the contact of a face with at most four points, so on the pentagons of the d12 one corner stayed out and the die came out unbalanced (p under 0.001 in two separate runs). The d12 is now built as a cube with six roofs, Euclid's construction, and the floor and walls of the tray are planes for the same reason.

## Design notes

- **Gravity is 650 cm/s²**, a third less than the real one: a slow motion of about 23% that gives the dice the weight of objects seen up close. A single die rolls for 0.6 to 0.9 seconds, a full table of thirty dice for about 1.5.
- **Up to two rethrows per die.** A die that comes to rest tilted (more than 6° off a flat face), leaves the tray or keeps moving for 6 seconds falls again from above the freest spot. If it would need a third, the roll is cancelled and the table asks for a new one; the roll log never sees it. That happened in 5 full tables out of 800 and in 1 throw of 5d12 out of 4,000, and never in 20,000 throws of a single die.
- **6 and 9 are underlined** when they stand alone on a face.
- **Among kept dice with the same value, the first one rolled wins** (kh, kl, dh, dl).
- **The camera is fixed**, tilted 40° from the vertical, at the shortest distance that keeps the whole tray in view; in tall, narrow windows it looks from the short side of the tray.
- **The textures** of walnut, velvet and table are photographs generated with FLUX (Black Forest Labs) and prepared for the scene: the baked light removed, relief and roughness extracted. Fonts and textures ship with the project, so the page works offline.

## Development

```sh
npm test            # 130 tests: notation, geometry, physics, events, bridge, MCP server
npm run typecheck
npm run build       # the page into dist/client
npm run dev         # the page from source at 127.0.0.1:4778, without the bridge
npm run bridge      # the bridge in the foreground, without opening the browser
npm run fairness    # the fairness tests (a few minutes); rewrites docs/equita.md
```

The code is TypeScript that Node runs directly (type stripping), with comments in Italian. The sketch page `src/client/bozzetto.html`, served only by `npm run dev`, shows a still table from a fixed seed, for screenshots: for example `bozzetto.html?lingua=en&naturale=20`.

The integration tests start a bridge on a free port with a temporary roll log, use a test WebSocket in place of the browser and the MCP SDK client in place of Claude Code, and launch the real MCP server the way Claude Code launches it.

## License

MIT: see [LICENSE](LICENSE). The Noto Serif font is under the SIL Open Font License 1.1 (`src/client/caratteri/OFL.txt`). The textures were generated for this project and are released under the MIT license together with the code.

Designed by Andrea Inandri and written with Claude Code.
