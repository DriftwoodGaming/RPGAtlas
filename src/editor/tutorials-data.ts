/* RPGAtlas — src/editor/tutorials-data.ts
   The Detailed Tutorials content (Help ▸ Detailed Tutorials). Pure data — no
   DOM or editor-state imports — so tests-unit/tutorials.test.ts can load it
   under the node environment, like sample-map-data.ts. Each guide is written
   for newer developers: small numbered steps, checkpoints, plain words.
   Body text is English-only by design (like Quick Help and the wiki); the
   menu label is chrome and localized in js/editor/i18n.js.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

export interface Tutorial {
  /** Stable id (used by tests and deep-opens; never rename casually). */
  id: string;
  /** Emoji shown on the index card. */
  icon: string;
  title: string;
  /** One-sentence card subtitle: what you'll be able to do afterwards. */
  blurb: string;
  /** "About N minutes · audience" meta line. */
  meta: string;
  /** Guide body: helpbox-style HTML (h3 / ol / ul / kbd / code / pre / table
   *  plus the .tut-tip and .tut-done callout boxes). */
  html: string;
}

export const TUTORIALS: Tutorial[] = [
  {
    id: "multiplayer-server",
    icon: "🖥️",
    title: "Set Up a Multiplayer Server",
    blurb: "Run your own Beacon play server so friends can join your game online with a room code.",
    meta: "About 20–30 minutes · For developers (you'll use a terminal)",
    html: `
<p>RPGAtlas ships an open-source multiplayer server called <b>Beacon</b> — the same server its
games use online. This guide walks you through running one on your own computer, connecting your
game to it, and (when you're ready) opening it up to friends over the internet.</p>
<div class="tut-tip">💡 <b>Do you actually need this?</b> If you just want friends to play
together, maybe not! Leave <b>Play server address</b> blank in the Database and your game uses
Driftwood's free play server. Run your own when you want to be in control: your machine, your
rules, your persistent world. (See the <b>Turn On Multiplayer</b> tutorial for the no-server path.)</div>

<h3>What you need</h3>
<ul>
<li><b>Node.js 18 or newer</b> — free from <code>nodejs.org</code>. Already have it? Open a
terminal and type <code>node --version</code> to check.</li>
<li><b>The RPGAtlas source folder</b> — the folder RPGAtlas came from. It has a
<code>server</code> folder inside; that folder <i>is</i> the Beacon server.</li>
<li><b>A game file</b> — your project's <code>.rpgatlas</code> / <code>.json</code> file
(<b>File ▸ Export Project As File…</b> makes one). No game yet? The bundled sample
<code>Atlas_Quest.json</code> works great for a first run.</li>
</ul>

<h3>Part 1 — Build the server (one time)</h3>
<ol>
<li>Open a terminal. Windows: press <kbd>Win</kbd>, type <code>powershell</code>, press
<kbd>Enter</kbd>. Mac: open the <b>Terminal</b> app.</li>
<li>Go to the server folder — type <code>cd</code>, a space, and the path to the
<code>server</code> folder inside RPGAtlas. For example:
<pre>cd C:\\Games\\RPGAtlas\\server</pre></li>
<li>Install its parts (needs internet, only needed once):
<pre>npm install</pre></li>
<li>Build it:
<pre>npm run build</pre></li>
</ol>
<div class="tut-done">✅ <b>Checkpoint:</b> no red errors, and the server folder now contains
<code>dist/beacon.mjs</code>. That one file is the whole server.</div>

<h3>Part 2 — Start your server</h3>
<ol>
<li>In the same terminal, start the server and hand it a game file:
<pre>node dist/beacon.mjs --project ../Atlas_Quest.json --port 8787</pre>
Swap <code>../Atlas_Quest.json</code> for the path to your own game file.</li>
<li>Leave this window open — this window <b>is</b> your server. (Press <kbd>Ctrl+C</kbd> in it
whenever you want to stop.)</li>
<li>Prove it's alive: open <code>http://localhost:8787/</code> in a browser. You'll see a tiny
health report like <code>{"ok":true,"rooms":0,"connections":0,"players":0}</code>.</li>
</ol>
<div class="tut-done">✅ <b>Checkpoint:</b> the health page says <code>"ok":true</code>. You are
running a multiplayer game server. Really!</div>

<h3>Part 3 — Point your game at it</h3>
<ol>
<li>In the editor, open <b>Tools ▸ Database…</b> (<kbd>F1</kbd>) and click the
<b>Multiplayer</b> tab.</li>
<li>Tick <b>Enable Play Together</b>.</li>
<li>In <b>Play server address</b>, type <code>ws://localhost:8787</code> — the server you just
started. (<code>ws://</code> is only accepted for same-computer testing; real players connect
with <code>wss://</code> — that's Part 4.)</li>
<li>Close the Database and press <b>▶ Playtest</b> (<kbd>F5</kbd>).</li>
<li>On the title screen pick <b>Play Together</b>, type a name, and choose <b>Create Room</b>.
The room code on your screen was just minted by <i>your</i> server.</li>
<li>Now be your own second player: copy the playtest window's address into a <b>second browser
window</b>, pick <b>Play Together ▸ Join a Room</b>, and type the code. Walk around — both
windows see each other move.</li>
</ol>
<div class="tut-done">✅ <b>Checkpoint:</b> two windows, one map, both players waving. Refresh the
health page — it now counts a room and two players.</div>

<h3>Part 4 — Let friends in over the internet</h3>
<p>Away from your own computer, games only connect over <code>wss://</code> — a secure
(encrypted) connection. The Beacon server speaks plain <code>ws://</code>, so you put a small
"TLS proxy" in front of it that handles the secure part. This is the one genuinely advanced
step, and it's the same for any game server:</p>
<ol>
<li>Set up a TLS proxy on the machine that runs the server — <b>Caddy</b> is the easiest
(it fetches certificates automatically), <b>nginx</b> and <b>Cloudflare Tunnel</b> work great
too. Forward the WebSocket upgrade to <code>127.0.0.1:8787</code>.</li>
<li>Start Beacon with <code>--trust-proxy</code> so its join rate-limiting sees each real
player instead of the proxy.</li>
<li>Put the public address — <code>wss://play.your-domain.example</code> — in
<b>Database ▸ Multiplayer ▸ Play server address</b>, and export your game. Everyone who plays
that copy uses your server.</li>
</ol>
<div class="tut-tip">💡 Hosting from home? You'll also need to allow the port through your
firewall and forward it on your router — search "port forwarding" plus your router's name.
A tiny cloud machine (a $5 VPS) is often less fuss than home networking.</div>

<h3>Useful switches</h3>
<table>
<tr><th>Flag</th><th>What it does</th></tr>
<tr><td><code>--project &lt;file&gt;</code></td><td>The game to host (required).</td></tr>
<tr><td><code>--port &lt;n&gt;</code></td><td>Port to listen on (default 8787).</td></tr>
<tr><td><code>--max-players &lt;n&gt;</code></td><td>Ceiling on room size (default 16). A game's own Database setting can make rooms smaller, never bigger.</td></tr>
<tr><td><code>--max-rooms &lt;n&gt;</code></td><td>How many rooms at once (default 1000); past it, players see a friendly "server is full".</td></tr>
<tr><td><code>--no-engine-rooms</code></td><td>Lighter walk-and-chat rooms with no server-side events or battles. (Full engine rooms — with co-op battles — are the default.)</td></tr>
<tr><td><code>--trust-proxy</code></td><td>Behind your TLS proxy only: read the real player address for rate-limiting.</td></tr>
</table>

<h3>Going bigger — a persistent world</h3>
<p>Friend rooms vanish when everyone leaves. A <b>world</b> is different: one shared, always-on
place players return to. One command line:</p>
<pre>node dist/beacon.mjs --project ../MyGame.rpgatlas --world --data ./world-data --engine-events --zone-workers</pre>
<ul>
<li><code>--world</code> — one shared world instead of code-based rooms. Players are recognised
by a <b>passport</b> their device makes automatically — no signup, no email, nothing personal.</li>
<li><code>--data ./world-data</code> — save the world to plain JSON files so it survives a
restart (saves every 30 seconds and on a clean shutdown). Leave it off for a world that resets.</li>
<li><code>--engine-events</code> — run your authored NPCs, cutscenes, and triggers on the
server, so every player shares one living world.</li>
<li><code>--zone-workers</code> — for multi-map worlds: each map runs in its own worker thread.</li>
</ul>
<p>The terminal the world runs in is also your <b>moderation console</b> — type
<code>players</code> (who's on), <code>reports</code> (what's been reported),
<code>ban</code> / <code>unban</code> / <code>bans</code>, or <code>help</code>. Bans are by
passport, so they stick across restarts (with <code>--data</code>) and never involve anyone's
personal information.</p>

<h3>If something goes wrong</h3>
<ul>
<li><b>"Port already in use"</b> — something else has 8787. Start with a different
<code>--port</code> (and match the address in the Database).</li>
<li><b>Your two test windows don't connect</b> — check the address is exactly
<code>ws://localhost:8787</code> and the terminal window is still running.</li>
<li><b>Friends can't connect from elsewhere</b> — off your computer the game requires
<code>wss://</code>; plain <code>ws://</code> to a network address is refused on purpose.
Finish Part 4 (proxy + firewall + router).</li>
<li><b>No monsters online?</b> Server battles start from authored <b>Battle events</b> (a
monster you place, a boss door) — random step encounters stay single-player for now. And a
friend room runs events on your game's <b>starting map</b>; a world server with
<code>--zone-workers</code> runs them on every map.</li>
<li><b>Changed your game?</b> The server reads the file at startup — restart it
(<kbd>Ctrl+C</kbd>, then the same command) to host the new version.</li>
</ul>

<h3>Bonus — the ready-made co-op demo</h3>
<p>Want to see everything working before wiring your own game? From the RPGAtlas folder:</p>
<pre>node scripts/build-coop-demo.mjs
cd server
node dist/beacon.mjs --project ../Atlas_Quest_Coop.json --port 8787</pre>
<p>That hosts the Driftwood Shore beach meet-up: spawn together, wave, <b>Team Up</b>, and fight
the sparkling <b>Practice Dummy</b> crystal side by side.</p>
<p class="dim">Deeper dives (Cloudflare hosting, exact wire privacy, more moderation detail):
the wiki pages <b>Hosting a World</b> and <b>Making Your Game Multiplayer</b>.</p>
`,
  },
  {
    id: "play-together",
    icon: "🕹️",
    title: "Turn On Multiplayer (Play Together)",
    blurb: "One checkbox lets friends join your game online — set it up safely in five minutes.",
    meta: "About 5 minutes · Easy — no server, no accounts",
    html: `
<p>Every RPGAtlas game can go online: friends share a short <b>room code</b>, walk the same maps,
wave, party up, and fight battles side by side. Until you turn it on, nothing about your game
changes — single-player stays exactly as it is.</p>

<h3>Part 1 — Flip the switch</h3>
<ol>
<li>Open <b>Tools ▸ Database…</b> (<kbd>F1</kbd>).</li>
<li>Click the <b>Multiplayer</b> tab.</li>
<li>Tick <b>Enable Play Together</b>.</li>
</ol>
<div class="tut-done">✅ <b>That's the whole feature.</b> Your game's title screen now shows a
<b>Play Together</b> button. Players type a name and either <b>Create Room</b> (they get a code
to share) or <b>Join a Room</b> (they type a friend's code). No accounts, no emails — ever.</div>

<h3>Part 2 — Choose how players talk</h3>
<p>Still on the Multiplayer tab, pick a <b>Chat mode</b>. This is a safety setting, and the
default is the safest:</p>
<ol>
<li><b>Emotes + preset phrases only</b> <i>(default)</i> — players tap emotes and the ready-made
phrases you write. No free typing at all. Perfect for younger players.</li>
<li><b>Filtered free-text chat</b> — players can also type short messages, run through a
bad-word filter, with <b>mute</b> and <b>report</b> built in. Only choose this if you're
comfortable with players typing whatever they like.</li>
<li>Fill in <b>Preset phrases</b> — one per line, short and friendly:
<pre>Follow me!
Nice one!
Need healing!
Over here!</pre>
These always work, whichever chat mode you picked.</li>
</ol>

<h3>Part 3 — Pick where players appear (optional)</h3>
<ol>
<li>By default, joining players appear at your game's normal start position.</li>
<li>Prefer a lobby, town square, or hub map? Under <b>Where players appear</b>, add a
<b>spawn point</b>: pick the map, set X, Y, and facing. Remove it to go back to the default.</li>
</ol>

<h3>Part 4 — Play!</h3>
<ol>
<li>Press <b>▶ Playtest</b> (<kbd>F5</kbd>) and pick <b>Play Together</b> on the title screen.</li>
<li>In game, the <b>💬 Players &amp; Chat</b> button opens the room panel: emotes, your phrases,
and everyone in the room.</li>
<li>Next to a nearby friend, tap <b>Team Up</b>. They get a friendly "wants to team up!" prompt
— once they accept, you're a party: you follow each other through map changes, and when one of
you starts a battle, the other <b>joins the same fight</b>. Everyone commands their own heroes
and keeps their own loot, and nobody's game ends because a shared fight went badly.</li>
<li>The same panel holds the safety tools: <b>Mute</b> (instant and private), <b>Report</b>,
and — for the room's creator — <b>Kick</b> and <b>Ban</b>.</li>
</ol>
<div class="tut-tip">💡 <b>Online battles come from Battle events.</b> Fights you place as
events (a monster to walk up to, a boss) work great in co-op; random step encounters stay
single-player for now. Give your online maps a battle event or two — and note that friend rooms
run events on your game's <b>starting map</b>.</div>

<div class="tut-tip">💡 <b>Where does it connect?</b> Leave <b>Play server address</b> blank to
use Driftwood's free play server. Running your own is its own adventure — see the
<b>Set Up a Multiplayer Server</b> tutorial. And for the page you can show a parent or teacher,
the wiki has <b>Online Safety (Parents &amp; Teachers)</b>.</div>
`,
  },
  {
    id: "advanced-map-editor",
    icon: "🗺️",
    title: "Use the Advanced Map Editor",
    blurb: "Unlimited layers, smart terrain brushes, stamps, gameplay zones, and rule-based auto-detailing.",
    meta: "About 15 minutes · Easy — everything here is optional",
    html: `
<p>The classic Map panel is all you need to make a great map. The <b>Advanced Map Editor</b> is
for when you want more: it works on the <i>same map</i>, side by side, and a map you never touch
with these tools is saved byte-for-byte exactly as before. <kbd>Ctrl+Z</kbd> undo spans both
editors.</p>

<h3>Part 1 — Open it and look around</h3>
<ol>
<li>Press <kbd>F4</kbd> (or use the <b>Advanced</b> menu, or <b>View ▸ Advanced Map Editor</b>).
The panel docks next to your map.</li>
<li>For a guided tour, add the showcase sample: in the <b>Maps</b> panel, use <b>Add sample
map</b> and pick <b>Meridian Village — Advanced</b> — it ships a full layer stack, one zone of
every kind, and two ready-to-run Automap rules.</li>
</ol>

<h3>Part 2 — Layers without limits</h3>
<ol>
<li>In the panel's <b>Layers</b> list, click <b>Add Layer</b>. The classic four layers are still
there — new ones stack above or below them.</li>
<li>Drag layers to reorder; double-click one to rename it.</li>
<li>Per layer, try the controls: <b>visibility</b>, <b>lock</b>, <b>opacity</b>, a <b>blend
mode</b> (normal / add / multiply / screen), a <b>tint</b> color, and the <b>draw slot</b> —
<i>below</i> renders under the player, <i>above</i> renders overhead.</li>
<li>Group related layers with <b>Add Group</b>; groups fold and can nest.</li>
</ol>
<div class="tut-done">✅ What you see is what ships: blend and opacity are baked into the map's
render buffers, so playtests, HD-2D, and exported games look exactly like the editor.</div>

<h3>Part 3 — Paint with a smarter brush</h3>
<ol>
<li>Painting works like the classic editor (pen / erase / fill / rectangle) on whichever layer
is active in the list.</li>
<li>While the Advanced panel is focused, transform the brush: <kbd>X</kbd> flips it left–right,
<kbd>Y</kbd> flips it top–bottom, <kbd>R</kbd> rotates 90°.</li>
<li>Use the panel's own <b>Tiles</b> tab: a search box plus category chips (Terrain, Water,
Floor, Walls, Nature, Objects) — no more scrolling a whole sheet.</li>
</ol>

<h3>Part 4 — Stamps: reuse the good bits</h3>
<ol>
<li>In the Map view, <kbd>Shift</kbd>+drag to select an area you like (a rock cluster, a market
stall).</li>
<li>Pick <b>Advanced ▸ Save Selection as Stamp…</b>. The stamp is saved with your project.</li>
<li>Click <b>📌</b> on the stamp, then click the map to place it — one undo step.</li>
<li>Toggle <b>🎲 random scatter</b> to sprinkle it across your brush area with an adjustable
chance — great for foliage, rubble, and clutter.</li>
</ol>

<h3>Part 5 — Turn a tile sheet into a smart terrain</h3>
<ol>
<li>Import a tile sheet first (see the wiki's <b>Asset Browser</b> page), then open
<b>Advanced ▸ Terrain &amp; Autotile Studio…</b>.</li>
<li>Follow its five steps — <b>Source, Layout, Terrain Types, Rules, Preview</b> — it
auto-detects common arrangements (A2 terrain, animated A1 water, fences, walls, roofs).</li>
<li>The result is a <b>terrain brush</b> that picks its own edges, corners, and inside pieces as
you paint. Add <b>animation</b> (waves!), <b>weighted variations</b> (fields stop tiling
obviously), and <b>pattern completion</b>.</li>
</ol>

<h3>Part 6 — Gameplay zones: draw meaning onto the map</h3>
<ol>
<li>Switch the panel's mode rail to <b>Objects</b>.</li>
<li>Pick a zone kind, then draw a <b>Rectangle</b>, <b>Ellipse</b>, <b>Polygon</b>
(double-click to finish), or <b>Point</b>. The Select tool drags corner handles to reshape.</li>
</ol>
<table>
<tr><th>Zone</th><th>While the player is inside…</th></tr>
<tr><td><b>Encounter</b></td><td>Replaces the map's random-battle pool (with one-click <i>Test Encounter in This Area</i>)</td></tr>
<tr><td><b>Transfer</b></td><td>Warps the player somewhere else on entry</td></tr>
<tr><td><b>Sound</b></td><td>Loops an ambience layer, with optional distance falloff</td></tr>
<tr><td><b>Weather</b></td><td>Applies weather, restoring the map's own on exit</td></tr>
<tr><td><b>Collision</b> / <b>Nav</b></td><td>Makes tiles solid / walkable (stepping stones over water!)</td></tr>
<tr><td><b>Spawn</b> / <b>Custom</b></td><td>Markers and data for plugins (<code>atlas.zonesAt(x, y)</code>)</td></tr>
</table>

<h3>Part 7 — Automap: rules that detail the map for you</h3>
<ol>
<li>Open the <b>Automap drawer</b> (bottom of the panel, or <b>Advanced ▸ Automap Rules…</b>).</li>
<li>Write a plain IF / AND / THEN rule — no scripting. For example: <i>IF this tile is grass AND
it's near water THEN place reeds, 35% of the time.</i></li>
<li>Click <b>Preview</b> — pending changes appear as a green overlay right on the map.</li>
<li>Happy? <b>Apply</b> commits everything as <b>one undo step</b>. The 🎲 button re-rolls a
rule's scatter when you want a different arrangement.</li>
</ol>
<div class="tut-tip">💡 Automap rules are an editor tool only — they never run in the finished
game, and exports are unchanged by having them.</div>
`,
  },
  {
    id: "map-properties",
    icon: "⚙️",
    title: "Configure Map Properties",
    blurb: "Name, size, music, encounters, HD-2D rendering, and screen effects — one dialog, four tabs.",
    meta: "About 10 minutes · Easy",
    html: `
<p>Every map has a settings dialog: <b>Game ▸ Map Properties…</b> (with your map selected in the
Maps panel; <kbd>Ctrl+P</kbd> then "map properties" works too). It's four tabs — take them one at
a time. <b>OK</b> applies everything as a single undo step; <b>Cancel</b> changes nothing.</p>

<h3>Part 1 — The General tab</h3>
<ol>
<li>Give the map a <b>Name</b> players and you will recognise.</li>
<li>Set <b>Width</b> and <b>Height</b> in tiles (5–200 each). Growing a map keeps everything
you've drawn; shrinking trims from the right and bottom edges.</li>
<li>Pick the <b>Tileset</b> and the <b>Music</b> that starts when the player arrives.</li>
<li>Optional flavor, all safe to ignore at first:
<ul>
<li><b>Ambience layers</b> — looping imported audio (wind, surf, market noise) mixed under the
music and crossfaded between maps.</li>
<li><b>Loop left ↔ right / top ↕ bottom</b> — walk off one edge, appear on the other (world
maps!).</li>
<li><b>Parallax background</b> — an image behind the map, with drift and looping.</li>
<li><b>Battle backs</b> — this map's battle floor and wall images.</li>
<li><b>Show on the minimap</b> and <b>Notes</b> (your notes appear in the World View).</li>
</ul></li>
</ol>

<h3>Part 2 — The Encounters tab (random battles)</h3>
<ol>
<li>Set the <b>Encounter rate</b> — average steps between surprise battles. <b>0 turns them
off</b>, and towns usually want 0.</li>
<li>Add <b>Encounter troops</b> — the enemy groups (from your Database) that can appear here.</li>
<li>Want different monsters in one corner of the map? Paint region numbers in <b>Region mode</b>
(<kbd>Tab</kbd> cycles to it), then give that region its own troop list under <b>Region
encounter pools</b>.</li>
<li><b>Night encounter pool</b> — troops that take over between 21:00 and 5:00 on the in-game
clock (leave empty to use the normal list all day).</li>
</ol>
<div class="tut-done">✅ <b>Checkpoint:</b> playtest (<kbd>F5</kbd>) and take a stroll — battles
should start about as often as your rate, and only with troops you listed.</div>

<h3>Part 3 — The HD-2D tab (optional 3D look)</h3>
<ol>
<li>Tick <b>Enabled</b> to render this map in tilted 3D perspective — the classic top-down look
stays the default when it's off.</li>
<li>Set the <b>Camera tilt</b> (25–89°; lower = more dramatic).</li>
<li>Add light and depth as you like: <b>Point lights</b>, <b>Ambient light</b>, <b>Sun
shadows</b>, <b>Water surface</b>, <b>Auto materials</b>, <b>Cliff auto-texturing</b>, and soft
<b>drop shadows</b>.</li>
<li>Now give the map some height: switch to <b>Height mode</b> (<kbd>Tab</kbd>), press
<kbd>0</kbd>–<kbd>9</kbd> to pick an elevation, and paint — raised tiles become 3D blocks,
instant cliffs and plateaus.</li>
<li>Press <kbd>F2</kbd> for the live <b>HD-2D Viewport</b>: it follows your edits, and you can
double-click to drop a point light and drag its gizmo into place.</li>
</ol>

<h3>Part 4 — The Effects tab (atmosphere)</h3>
<ol>
<li>These show in game when HD-2D is enabled. Start subtle: <b>Bloom</b> makes lights glow,
<b>Depth of field</b> softens the distance, <b>Distance fog</b> (with a color) sets mood.</li>
<li><b>Weather particles</b> — rain, snow, or drifting motes.</li>
<li><b>Color grade</b> — one-click looks: Warm, Cool, Night, Sepia, Noir.</li>
<li>Finishing touches: <b>ACES filmic tone mapping</b>, <b>FXAA</b>, <b>SSAO</b>,
<b>Vignette</b>.</li>
<li><b>Day/night cycle</b> lets the sun follow the in-game clock, and <b>Time of day on
entry</b> pins the hour when the player arrives (blank keeps the current time).</li>
</ol>
<div class="tut-tip">💡 A good recipe for a first HD-2D map: Enabled + tilt 50, Point lights on,
Sun shadows on, Bloom on, everything else off. Add one effect at a time and check it in the
<kbd>F2</kbd> viewport.</div>
`,
  },
  {
    id: "first-events",
    icon: "✨",
    title: "Create Your First Events",
    blurb: "Signs, chests, doors, and townsfolk — bring a map to life with ready-made Quick Events.",
    meta: "About 10 minutes · Easy — start here if events are new to you",
    html: `
<p>Events are how things <i>happen</i> in your game: signs that talk, chests that open, doors
that lead somewhere, villagers with something to say. RPGAtlas ships ready-made <b>Quick
Events</b>, so your first working event is three clicks away.</p>

<h3>Part 1 — A sign that talks</h3>
<ol>
<li>Switch to <b>Event mode</b>: press <kbd>Tab</kbd> until the status bar says Event mode (or
click the Event button on the toolbar).</li>
<li><b>Right-click</b> an empty tile — say, beside a house door.</li>
<li>Choose <b>New Quick Event ▸ Sign</b> and type what it should say.</li>
<li>Press <kbd>F5</kbd> to playtest: walk up to the sign, face it, and press <kbd>Z</kbd> or
<kbd>Enter</kbd>. It talks!</li>
</ol>
<div class="tut-done">✅ <b>Checkpoint:</b> that's the whole event loop — place, playtest, read.
Everything bigger is this, with more steps.</div>

<h3>Part 2 — A treasure chest</h3>
<ol>
<li>Still in Event mode, right-click another tile and choose <b>New Quick Event ▸ Chest</b>.</li>
<li>Pick what's inside.</li>
<li>Playtest: open the chest, get the loot — and open it again. It knows it's empty! The quick
event set that up with a <b>self-switch</b>: opening flips the event to a second page ("the
chest is empty") that stays flipped.</li>
</ol>

<h3>Part 3 — A door to another map</h3>
<ol>
<li>Right-click a doorway tile and choose <b>New Quick Event ▸ Transfer</b> (or <b>Door</b> for
one with an opening animation).</li>
<li>Pick the destination map and spot.</li>
<li>Playtest and walk through. Put a matching transfer on the other map to come back!</li>
</ol>
<div class="tut-tip">💡 The Quick Event menu has a whole cast waiting: <b>Villager</b>,
<b>Shopkeeper</b>, <b>Innkeeper</b>, <b>Locked Door</b>, <b>Save Point</b>, <b>Healing
Crystal</b>, <b>Monster</b> (a battle you walk up to — these work in online co-op too!),
<b>Gift NPC</b>, and <b>Quest Giver</b>.</div>

<h3>Part 4 — Peek inside a real event</h3>
<ol>
<li><b>Double-click</b> the chest you made. This is the full event editor — every Quick Event is
a normal event you can study and edit.</li>
<li>Notice the <b>pages</b> (tabs): the last page whose conditions are met is the one that runs.
The chest's page 2 requires self-switch <b>A</b> — flipped when it opens.</li>
<li>Notice the <b>trigger</b>: <i>Action button</i> means "runs when the player presses
<kbd>Z</kbd> facing it". <i>Player touch</i> runs on walking into it; <i>Autorun</i> takes over
the scene (cutscenes); <i>Parallel</i> runs quietly in the background.</li>
<li>The command list is where the magic is — <b>Show Text</b>, <b>Transfer</b>, <b>Change
Items</b>, <b>Battle</b>, and much more. Add a command to the sign, playtest, and see what
happens. <kbd>Ctrl+Z</kbd> undoes anything.</li>
</ol>
<p class="dim">Keep going: drag events to move them, <kbd>Ctrl+C</kbd>/<kbd>Ctrl+V</kbd> to copy
between maps, and <b>Tools ▸ Event Searcher…</b> to find any text, switch, or variable across
your whole game. The wiki's <b>Events</b> page covers every trigger and command.</p>
`,
  },
  {
    id: "share-your-game",
    icon: "📦",
    title: "Export & Share Your Game",
    blurb: "Turn your project into a game file, a web page, or a Windows program players can just run.",
    meta: "About 5 minutes · Easy",
    html: `
<p>When you're ready for other people to play, RPGAtlas packages everything — maps, database,
art, audio, engine — into something players simply run. They don't need RPGAtlas, an installer,
or any setup.</p>

<h3>Part 1 — Keep a safe copy first</h3>
<ol>
<li>Pick <b>File ▸ Export Project As File…</b>. This saves your whole <i>project</i> as one
portable file — your backup, and the file you'd open on another computer to keep working.</li>
<li>Do this before big changes, and keep a copy somewhere safe. (It's also the file a
multiplayer server hosts — see the server tutorial.)</li>
</ol>

<h3>Part 2 — Export the game itself</h3>
<ol>
<li>Pick <b>File ▸ Export Standalone Game…</b>.</li>
<li>Choose what to build:
<ul>
<li><b>Windows program</b> (<code>.exe</code>) — players double-click and play.</li>
<li><b>Web page</b> (<code>.html</code>) — runs in any modern browser, on any computer.</li>
</ul></li>
<li>Send the result to a friend, or upload the web build to a site like itch.io so anyone can
play in their browser.</li>
</ol>
<div class="tut-done">✅ <b>Checkpoint:</b> open your exported game fresh — the title screen,
your maps, your music, all of it runs without the editor anywhere in sight.</div>

<h3>Part 3 — Multiplayer games</h3>
<ol>
<li>Turn on <b>Play Together</b> and choose your settings <i>before</i> exporting — the export
carries your multiplayer settings (including any custom server address) with it.</li>
<li>Every copy of the exported game shows the <b>Play Together</b> button, so your players can
room up with each other from day one.</li>
</ol>

<div class="tut-tip">💡 Your game is <b>yours</b>. Everything you made — maps, story, database,
characters — belongs to you: sell it, remix it, no credit required. Exported games include the
RPGAtlas engine runtime, which stays free and open source (GPL) with its readable source shipped
inside every export. The wiki's <b>Publishing Your Game</b> page has store-by-store tips.</div>
`,
  },
];
