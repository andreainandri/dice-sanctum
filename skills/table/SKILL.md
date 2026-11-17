---
description: Opens The Dice Sanctum, the 3D dice table, in the browser, and starts its local bridge when it is not running. Use when the user wants to open, start or bring back the dice table, or when a dice tool answers that the bridge is off or that no table is open.
---

# Open the dice table

The table is a web page served by a small local bridge on `127.0.0.1:4777`. One command starts the bridge when it is not running and opens the table in the default browser:

```sh
node "${CLAUDE_PLUGIN_ROOT}/src/bridge/avvia.ts"
```

Run it with the Bash tool **in the background**: while the bridge runs, the command stays in the foreground and never returns.

- It needs Node.js 24 or newer. The first run builds the page, which takes a second or two.
- When the bridge is already running, the command only opens the table, or says that a browser already has it open, and exits at once.
- When another program answers on the port, the command says so and stops. Tell the user; do not pick another port on your own.

Then call `get_status`: it says whether the bridge answers and how many tables are connected. When a table is connected, tell the user the table is open, in one line.

A bridge started this way stops when this Claude Code session ends. Nothing is lost: the rolls are in the log, and a roll made while the bridge is down waits in the page and leaves by itself when the bridge is back. To keep the table running on its own, the user runs the same command in a terminal.
