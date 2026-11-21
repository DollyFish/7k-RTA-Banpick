# AGENTS.md — 7K RTA Draft

Instructions for coding agents (Codex, etc.) working in this repository.

## What this project is

A single-page ban/pick draft tool for **Seven Knights Rebirth RTA**, hosted as a static site (GitHub Pages).
Everything lives in **one file: `index.html`** (HTML + CSS + JS, no build step, no framework, no backend).

Three roles:

| `seat` | Role | Can do |
|---|---|---|
| `-1` | Local mode ("เล่นเครื่องเดียว") | One device plays both sides. No network. |
| `2` (`HOST`) | Spectator / room owner | Creates the room, owns the authoritative state, sets player names, starts/resets the draft, renews invite links. **Never picks heroes.** |
| `0` | Blue player | Joins only via the blue invite link. Acts on blue turns. |
| `1` | Red player | Joins only via the red invite link. Acts on red turns. |

The user-facing UI text is **Thai**. Keep all new UI strings in Thai and match the existing tone.

## Hard requirements (do not break)

1. **Only 2 players can join, and only via invite links.** There is no join-by-room-code UI. Each link carries a secret token for one side.
2. **One link = one person.** The first client (`cid`) to use a side's token is bound to that side (`bound[side]`). Any other `cid` using the same link is rejected with a `denied` message.
3. **The spectator is authoritative.** Players only send intents (`preview`, `move`); the host validates everything and broadcasts the full state. Never let a player mutate state directly.
4. **Timer pauses when either player is disconnected** (`networkReady` is false on the host → `deadline = null`).
5. **Draft rules stay as defined** in `phases` / `turns` (8 phases, 14 turns, some turns pick 2 heroes). Don't change the order unless the user asks.
6. Keep it a **single static file** that works on GitHub Pages. No bundlers, no npm runtime deps, no server code.

## Architecture overview (inside `index.html`)

### Draft core (original logic — keep behavior identical)
- `phases` → expanded into `turns` (`{side, action, phase, count}`); `turnEnds` = valid history lengths.
- State: `moves` (array of hero ids in order), `revision` (incremented on every state change), `started`, `playerNames`, `selected` (local selection for the current turn).
- `current()` = the turn at `moves.length`.
- Timer: `turnDuration = 60000`. `setCountdown(ms)`, `timeLeft()`, `deadline`, `pausedTime`.
- On timeout (`tick()`), the host (or local mode) locks the current selection and **randomly fills** missing slots, then `advanceTurn()`.
- `advanceTurn(ids)` appends moves, bumps `revision`, shows the reveal popup (`revealDuration = 1200`), restarts the countdown.
- Rendering: `render()` → `renderPhases`, `panel(side)`, `updatePool`, `renderSelection`, `renderCountdown`; `showMatch()` opens the Match Up dialog when the draft finishes.
- Validation helpers: `validSelection(ids, turn, complete)`, `validHistory(history)`.

### Hero roster
- Loaded at runtime from **7K Atlas** (`https://7katlas.com/COMBINE/codex_lite_heroes.js`) inside a sandboxed hidden iframe, which `postMessage`s the list back → `acceptAtlas` → `putRoster(items)`.
- `putRoster` filters/validates items, sorts by rarity (`L++`, `L+`, `L`, `R`), assigns hero type (with `atlasFallbackTypes`), builds the pool buttons.
- Images must stay restricted to `https://7katlas.com/images/heroes/`.
- Players auto-join **after** the roster loads (`putRoster` calls `joinRoom()`), because state validation needs the roster.

### Networking (PeerJS / WebRTC, public broker `0.peerjs.com`)
- PeerJS loaded from `cdn.jsdelivr.net/npm/peerjs@1.5.5`. Options in `peerOptions`.
- Room peer id = `roomPrefix + roomCode` (`"7k-rta-"` + 16 hex chars). Only the host registers this id.
- Invite link format: `<page-url>#join=<ROOMCODE>.<side>.<token>` — parsed by `joinPattern`. Built by `inviteLink(side)`.
- Client identity: `cid`, random per browser tab, stored in `sessionStorage` (survives reload in the same tab → seamless rejoin).

**Host-side functions:** `createRoom(saved)`, `openHostPeer()`, `hostData(channel, payload)`, `hostDropped(channel)`, `hostNetworkChanged()`, `sendState()`, `saveHost()`, `copyInvite(side)`, `renewInvite(side)`, `closeRoom()`, `deny(channel, text)`.
Host keeps: `roomCode`, `tokens[2]`, `bound[2]` (cid per side), `seatLinks[2]` (open DataConnection per side), `remoteSelected[2]` (live previews), `online[2]`.

**Player-side functions:** `joinRoom()`, `connectPlayer(channel)`, `retryJoin(message)`. Player keeps `joinInfo`, `link`, `stopped` (true after `denied`/`closed` → no more retries).

**Shared:** `closeEverything()`, `localMode(message)`, `isPlayer()`.

### Message protocol (JSON over PeerJS DataConnection, `serialization: "json"`)

Player → Host:
| kind | fields | meaning |
|---|---|---|
| `hello` | `cid, side, token` | first message; host checks token + binding |
| `preview` | `ids, revision` | current tentative selection (host shows it to the spectator only, also used for timeout lock) |
| `move` | `ids, revision` | confirm selection for the current turn |
| `ping` | — | heartbeat |

Host → Player:
| kind | fields | meaning |
|---|---|---|
| `state` | `moves, revision, playerNames, started, remaining, revealRemaining, notice, online, running` | full authoritative snapshot; `running:false` = timer paused |
| `denied` | `text` | rejected (bad/renewed token, link already used, kicked); client stops retrying |
| `closed` | — | host closed the room |
| `ping` | — | heartbeat |

Rules when touching the protocol:
- Every incoming payload is untrusted. Validate types, ranges, `revision`, turn ownership (`turn.side === channel.side`), and hero ids against `roster` and `moves`.
- A move is accepted only if: draft started, both players online, no reveal in progress, time left > 0, `payload.revision === revision`, and `validSelection(...)` passes.
- Always send full state (not diffs). Late joiners / reconnects must be able to render from one `state` message.

### Disconnect handling
- WebRTC often does not fire `close` when the other side closes the tab, so there is a **heartbeat**: both sides `ping` every 2 s; silence > 8 s = dropped (`hostDropped` on host, `retryJoin` on player).
- Players retry every 3 s while not `stopped`. Host retries opening its peer id (e.g. `unavailable-id` after a refresh) up to 15 times.
- Host persists the room to `localStorage` (`hostStoreKey = "7k-rta-host-room"`) on every `sendState()`; the lobby shows **"กลับเข้าห้องเดิม"** to resume it. `closeRoom()` clears it.

## Coding conventions

- Plain modern JS (`"use strict"`, `const`/`let`, arrow functions), no dependencies besides PeerJS.
- DOM helper: `$ = id => document.getElementById(id)`, element factory `node(tag, className, text)`. Use `textContent` / `node()` — **never inject untrusted strings with `innerHTML`** (names and hero data come from other peers / 7K Atlas).
- Call `render()` after any state change; host must call `sendState()` after any change players should see.
- Keep CSS in the existing `<style>` block, reuse the existing CSS variables (`--gold`, `--blue`, `--red`, `--edge`, `--panel`, …).
- Responsive layouts exist at `max-width: 780px` and `660px` — check mobile when changing layout.
- Respect `prefers-reduced-motion` for any new animation.

## Testing

There is no automated test suite in the repo. To verify networking changes locally:

1. Run a local PeerJS server (Node):
   ```bash
   npm i peer
   node -e "require('peer').PeerServer({port:9000,path:'/',host:'127.0.0.1'})"
   ```
2. Make a **test copy** of `index.html` (do not commit it) where:
   - `peerOptions` → `{host:"127.0.0.1",port:9000,path:"/",secure:false,config:{iceServers:[]}}`
   - optionally replace the 7K Atlas iframe load with a fake roster, e.g.
     `putRoster(Array.from({length:40},(_,i)=>({id:"h"+i,name:"ฮีโร่ "+i,en:"Hero "+i,tier:["L++","L+","L","R"][i%4],type:"attack",image:""})))`
3. Serve it over HTTP (`python3 -m http.server 8080`) — invite links only appear when the page is opened via `http(s)`, not `file://`.
4. Open 3 **separate browser profiles/contexts** (sessionStorage must differ): host creates the room, copies both links, each player opens one.

Checklist to run after networking changes:
- [ ] Both players join via links; host shows both online; start enables.
- [ ] Only the side whose turn it is can select/confirm; host can never act.
- [ ] Host sees the active player's preview (dashed gold card); opponent does not.
- [ ] A third person opening an already-used link gets "ลิงก์นี้มีผู้เล่นใช้เข้าห้องแล้ว".
- [ ] A link with a wrong/renewed token gets "ลิงก์ไม่ถูกต้องหรือถูกยกเลิกแล้ว…".
- [ ] Closing a player tab → within ~8 s host marks them offline and the timer pauses; both remaining screens say so.
- [ ] Reloading a player tab rejoins the same seat and keeps `moves`.
- [ ] "สร้างลิงก์ใหม่" kicks the current player of that side and invalidates the old link.
- [ ] Timeout locks the preview selection and random-fills missing heroes.
- [ ] Host refresh → "กลับเข้าห้องเดิม" restores the room and players reconnect.
- [ ] Local mode (`seat -1`) still works with no network.

## Known limitations

- Depends on the free public PeerJS broker and on direct WebRTC connectivity (no TURN server). Some strict NAT / mobile carrier networks may fail to connect.
- The spectator's tab **is** the room: if it is closed, the room is gone until resumed from the same browser.
- Hero list depends on 7K Atlas availability and its data format (`HEROES` global in `codex_lite_heroes.js`).
