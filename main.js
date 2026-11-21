"use strict";
const $ = id => document.getElementById(id);
const sides = ["ทีมน้ำเงิน", "ทีมแดง"];
const sideLabels = ["น้ำเงิน", "แดง"];
const actionLabels = { "แบน": "Ban", "เลือก": "Pick" };
const phases = [
  ["Ban 1", "แบน", [[0, 1], [1, 1]]],
  ["Pick 1", "เลือก", [[0, 1]]],
  ["Pick 2", "เลือก", [[1, 2], [0, 2]]],
  ["Pick 3", "เลือก", [[1, 1]]],
  ["Ban 2", "แบน", [[0, 1], [1, 1]]],
  ["Pick 4", "เลือก", [[1, 1]]],
  ["Pick 5", "เลือก", [[0, 2]]],
  ["Pick 6", "เลือก", [[1, 1]]]
];
const turnEnds = new Set([0]);
const turns = phases.flatMap(([, action, groups], phase) => groups.flatMap(([side, count]) =>
  Array.from({ length: count }, () => ({ side, action, phase, count }))
));
let turnOffset = 0;
while (turnOffset < turns.length) {
  turnOffset += turns[turnOffset].count;
  turnEnds.add(turnOffset);
}
const turnDuration = 60000;
const revealDuration = 2000;
const heroTypes = {
  all: ["ทั้งหมด", "", ""],
  attack: ["โจมตี", "⚔", "Attack"],
  magic: ["เวท", "✦", "Magic"],
  defense: ["ป้องกัน", "⬟", "Defense"],
  support: ["สนับสนุน", "✚", "Support"],
  universal: ["สมดุล", "✧", "Universal"]
};
// Codex type names for roster entries that lack a usable type field.
const atlasFallbackTypes = new Map(Object.entries({
  attack: [
    "Amelia", "Bai Long", "Ballista", "Bi Dam", "Black Rose", "Branze & Bransel", "Catty", "Cha Hae-in",
    "Colt", "Dellons", "Deo", "Eve", "Fai", "Feng Yan", "Heavenia", "Hokin",
    "Jane", "Jin", "Jupy", "Kagura", "Karl Heron", "Klahan", "Kyle", "Leo",
    "Lu Bu", "May", "Orkah", "Randgrid", "Rei", "Ryan", "Shane", "Snipper",
    "Soi", "Sunran", "Taka", "Tanjiro Kamado", "Teo", "Xiao", "Zenitsu Agatsuma", "Zhao Yun"
  ],
  magic: [
    "Ariel", "Bane", "Cleo", "Daisy", "Dongyoung", "Espada", "Freyja", "Joker",
    "Juri", "Kyrielle", "Ling Ling", "Melia", "Mercure", "Miho", "Nezha", "Noho",
    "O'Mok", "Pascal", "Reginleif", "Rin", "Ruri", "Sera", "Shinobu Kocho", "Silvesta",
    "Skuld", "Sung Jinwoo", "Sylvia", "Vanessa", "Velika", "Xiao Qiao", "Yeonhee", "Yoongun",
    "Yu Shin", "Yuri"
  ],
  defense: [
    "Aquila", "Aragon", "Evan", "Hellenia", "Knox", "Li", "Radgrid", "Rahkun",
    "Rook", "Rudy", "Yoo Jinho"
  ],
  support: [
    "Alice", "Biscuit", "Chloe", "Clemyth", "Diaochan", "Hayeon", "Karin", "Karon",
    "Lee Joohee", "Lina", "Lucy", "Orly", "Platin", "Rosie", "Sarah", "Yui"
  ],
  universal: [
    "Ace", "Aris", "Asura", "Bai Jiao", "Chancellor", "Eileene", "Elysia", "Gelidus",
    "Giyu Tomioka", "Guan Yu", "Jave", "Judas", "Karma", "Kris", "Lania", "Mist",
    "Nia", "Pallanus", "Rachel", "Sieg", "Spike", "Sun Wukong", "Trude", "Victoria"
  ]
}).flatMap(([type, names]) => names.map(name => [name, type])));
const rarity = ["L++", "L+", "L", "R"];
const roomPrefix = "7k-rta-";
const codePattern = /^[A-F0-9]{16}$/;
const HOST = 2;              // seat: -1 เล่นเครื่องเดียว · 0 น้ำเงิน · 1 แดง · 2 ผู้ชม/เจ้าของห้อง
const joinPattern = /^#join=([A-F0-9]{16})\.([01])\.([a-z0-9]{16,40})$/;
const hostStoreKey = "7k-rta-host-room";
const peerOptions = { host: "0.peerjs.com", port: 443, secure: true };
let roster = new Map(), moves = [], selected = [], remoteSelected = [[], []];
let playerNames = ["", ""], started = false, revision = 0, seat = -1;
let peer = null, link = null, networkReady = false, pending = false, clock;
// ผู้ชม (host)
let roomCode = "", tokens = ["", ""], bound = [null, null], seatLinks = [null, null], peerOpen = false, hostRetry = 0;
// ผู้เล่น (player)
let online = [false, false], joinInfo = null, stopped = false, retryTimer = null;
const cid = (() => {
  try {
    let id = sessionStorage.getItem("7k-rta-cid");
    if (!id) { id = randomToken(); sessionStorage.setItem("7k-rta-cid", id); }
    return id;
  } catch { return randomToken(); }
})();
function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(20)), b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
}
function isPlayer() { return seat === 0 || seat === 1; }
let deadline = null, pausedTime = 0, completionShown = false, heroType = "all";
let reveal = null;
let lastStatus = "กำลังโหลดฮีโร่จาก 7K Atlas";
let atlasFrame;

function node(tag, css, words) {
  const el = document.createElement(tag);
  if (css) el.className = css;
  if (words != null) el.textContent = words;
  return el;
}
function setStatus(message) { lastStatus = message; $("status").textContent = message; }
function current() { return turns[moves.length]; }
function presentedMoves() { return reveal?.from ?? moves.length; }
function playerName(side) { return playerNames[side].trim() || sides[side]; }
function turnSide(turn) {
  const name = playerNames[turn.side].trim();
  return sideLabels[turn.side] + (name ? " · " + name : "");
}
function describeTurn(turn) {
  return turnSide(turn) + " · " + actionLabels[turn.action] + " " + turn.count + " ตัว";
}
function revealTimeLeft() { return reveal ? Math.max(0, reveal.endsAt - performance.now()) : 0; }
function timeLeft() {
  const now = Math.max(performance.now(), reveal?.endsAt ?? 0);
  return deadline === null ? pausedTime : Math.max(0, deadline - now);
}
function setCountdown(duration) {
  pausedTime = started && current() ? duration : 0;
  const start = Math.max(performance.now(), reveal?.endsAt ?? 0);
  deadline = started && current() && (seat === -1 || networkReady) ? start + pausedTime : null;
}
function mayAct() {
  const turn = current();
  return Boolean(started && turn && !reveal && deadline !== null && timeLeft() > 0 && !pending &&
    (seat === -1 || (isPlayer() && networkReady && link?.open && turn.side === seat)));
}
function validSelection(ids, turn, complete) {
  return turn && Array.isArray(ids) && ids.length <= turn.count &&
    (!complete || ids.length === turn.count) && new Set(ids).size === ids.length &&
    ids.every(id => roster.has(id) && !moves.includes(id));
}
function validHistory(history) {
  return Array.isArray(history) && turnEnds.has(history.length) &&
    new Set(history).size === history.length && history.every(id => roster.has(id));
}
function teamHeroes(side, action, count = moves.length) {
  return moves.slice(0, count).flatMap((id, i) =>
    turns[i].side === side && turns[i].action === action ? [roster.get(id)] : []
  );
}
function imageOf(hero, css) {
  const image = node("img", css);
  image.alt = "";
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  if (hero.image) image.src = hero.image;
  else image.hidden = true;
  image.onerror = () => { image.hidden = true; };
  return image;
}
function portraitOf(hero, loading = "lazy") {
  const portrait = node("span", "draft-portrait");
  const image = imageOf(hero);
  image.loading = loading;
  portrait.append(image);
  return portrait;
}
function panel(side) {
  const team = $(side ? "red" : "blue");
  const active = started && turns[presentedMoves()]?.side === side && (seat === -1 || networkReady);
  team.classList.toggle("active", active);
  const header = node("header", "team-head");
  team.setAttribute("aria-label", playerName(side));
  const note = node("span", "", seat === side ? "ฝั่งของคุณ" : "");
  if (seat !== -1 && seat !== side) {
    note.replaceChildren(node("span", "online-dot" + (online[side] ? " on" : "")), online[side] ? "ออนไลน์" : "ยังไม่เข้าห้อง");
  }
  header.append(node("h2", "", playerName(side)), note);
  team.replaceChildren(header);
  for (const [action, total] of [["เลือก", 5], ["แบน", 2]]) {
    const heroes = teamHeroes(side, action, presentedMoves());
    team.append(node("p", "count", action + "  " + heroes.length + " / " + total));
    const list = node("ol", "slots");
    for (let i = 0; i < total; i++) {
      const hero = heroes[i];
      const slot = node("li", hero ? "filled" : "");
      if (hero) {
        slot.classList.toggle("banned", action === "แบน");
        slot.append(portraitOf(hero), node("span", "slot-name", hero.name));
      } else slot.append(node("span", "empty", action === "แบน" ? "⊘" : String(i + 1)));
      slot.title = hero?.name || action + " " + (i + 1);
      list.append(slot);
    }
    team.append(list);
  }
}
function renderSpectatorLive() {
  if (seat !== HOST || !started) return;
  const container = $("spectator-live");
  if (!container) return;
  const moveCount = presentedMoves();
  const turn = turns[moveCount];

  if (!turn) {
    container.replaceChildren();
    const doneBox = node("div", "spectator-done-box");
    const viewBtn = node("button", "gold spectator-view-match-btn", "ดู Match Up");
    viewBtn.type = "button";
    viewBtn.onclick = showMatch;
    doneBox.append(
      node("div", "spectator-done-icon", "⚔"),
      node("h3", "spectator-done-title", "การดราฟเสร็จสิ้น"),
      node("p", "spectator-done-sub", "ครบทีมละ 5 ตัวแล้ว"),
      viewBtn
    );
    container.append(doneBox);
    return;
  }

  const side = turn.side;
  const action = turn.action;
  const count = turn.count;
  const activeHeroes = Array.isArray(remoteSelected[side]) ? remoteSelected[side] : [];

  const head = node("div", "spectator-live-head");
  head.dataset.side = String(side);
  const pill = node("div", "spectator-action-pill");
  pill.dataset.action = actionLabels[action].toLowerCase();
  pill.dataset.side = String(side);
  const liveDot = node("span", "spectator-live-dot");
  pill.append(liveDot, node("span", "", playerName(side) + " · กำลัง" + action + " " + count + " ตัว"));

  const hintText = !networkReady ? "ผู้เล่นหลุดจากการเชื่อมต่อ · หยุดเวลาไว้" :
    activeHeroes.length === count ? "เลือกครบแล้ว · รอผู้เล่นกดยืนยัน" :
      "กำลังทำการเลือกแบบ Real-time (" + activeHeroes.length + "/" + count + ")";
  const hint = node("div", "spectator-turn-hint", hintText);
  head.append(pill, hint);

  const cardsBox = node("div", "spectator-cards");
  if (count > 1) cardsBox.classList.add("double");

  for (let i = 0; i < count; i++) {
    const heroId = activeHeroes[i];
    const hero = heroId ? roster.get(heroId) : null;

    if (hero) {
      const card = node("div", "spectator-card hero-active");
      card.dataset.side = String(side);
      card.dataset.action = actionLabels[action].toLowerCase();
      card.dataset.tier = hero.tier;

      const cardBadge = node("div", "spectator-card-badge", actionLabels[action].toUpperCase());

      const portraitWrap = node("div", "spectator-portrait-wrap");
      if (action === "แบน") portraitWrap.classList.add("banned");
      const img = imageOf(hero, "spectator-hero-img");
      img.loading = "eager";
      portraitWrap.append(img);

      const info = node("div", "spectator-hero-info");
      const name = node("div", "spectator-hero-name", hero.name);
      const enName = node("div", "spectator-hero-en", hero.en);

      const meta = node("div", "spectator-hero-meta");
      const tierBadge = node("span", "spectator-tier-badge", hero.tier);
      tierBadge.dataset.tier = hero.tier;
      meta.append(tierBadge);

      const [typeLabel, typeSymbol] = heroTypes[hero.type] || ["", ""];
      if (hero.type && hero.type !== "all") {
        const typeBadge = node("span", "spectator-type-badge", (typeSymbol ? typeSymbol + " " : "") + typeLabel);
        typeBadge.dataset.type = hero.type;
        meta.append(typeBadge);
      }

      info.append(name, enName, meta);
      card.append(cardBadge, portraitWrap, info);
      cardsBox.append(card);
    } else {
      const card = node("div", "spectator-card waiting-slot");
      card.dataset.side = String(side);

      const box = node("div", "spectator-waiting-box");
      const slotNum = node("div", "spectator-slot-num", "ช่องที่ " + (i + 1));
      const icon = node("div", "spectator-waiting-pulse", "?");
      const text = node("div", "spectator-waiting-text", "กำลัง" + action + "...");
      const sub = node("div", "spectator-waiting-sub", "รอ " + playerName(side) + " เลือกฮีโร่");

      box.append(slotNum, icon, text, sub);
      card.append(box);
      cardsBox.append(card);
    }
  }

  const foot = node("div", "spectator-live-foot");
  const note = node("div", "spectator-live-note");
  if (!networkReady) {
    note.className = "spectator-live-note warn";
    note.textContent = "⚠ ผู้เล่นยังไม่พร้อมหรือหลุดการเชื่อมต่อ";
  } else if (activeHeroes.length === count) {
    note.className = "spectator-live-note ready";
    note.textContent = "✓ เลือกแล้ว " + activeHeroes.map(id => roster.get(id)?.name || id).join(" + ") + " · รอกดยืนยัน";
  } else {
    note.className = "spectator-live-note live";
    note.textContent = "⚡ ถ่ายทอดการเลือกฮีโร่แบบ Real-time";
  }
  foot.append(note);

  container.replaceChildren(head, cardsBox, foot);
}
function updatePool() {
  if (seat === HOST && started) {
    renderSpectatorLive();
    renderBarBans();
  }
  const query = $("search").value.trim().toLowerCase();
  const tier = $("tier").value;
  const hideUsed = $("hide").checked;
  const pool = $("pool");
  let visible = 0;
  const canAct = mayAct();
  const revealedCount = presentedMoves();
  for (const button of pool.querySelectorAll("button[data-id]")) {
    const hero = roster.get(button.dataset.id);
    const index = moves.indexOf(hero.id);
    const i = index < revealedCount ? index : -1;
    button.hidden = (hideUsed && i >= 0) || (tier !== "all" && hero.tier !== tier) ||
      (heroType !== "all" && hero.type !== heroType) ||
      ![hero.name, hero.en].some(name => name.toLowerCase().includes(query));
    if (!button.hidden) visible++;
    button.disabled = i >= 0 || !canAct;
    button.classList.toggle("used", i >= 0);
    button.classList.toggle("banned", i >= 0 && turns[i].action === "แบน");
    button.setAttribute("aria-pressed", String(selected.includes(hero.id)));
    const peekSide = turns[revealedCount]?.side;
    button.classList.toggle("peek", seat === HOST && i < 0 && peekSide !== undefined && remoteSelected[peekSide].includes(hero.id));
    button.lastElementChild.textContent = i < 0 ? "" : turns[i].action;
  }
  $("hero-count").textContent = roster.size ? visible + " ตัว" : "";
  $("empty").hidden = !roster.size || visible > 0;
}
function renderCountdown() {
  const timer = $("timer");
  timer.hidden = !started || !current();
  if (timer.hidden) return;
  const seconds = Math.ceil(timeLeft() / 1000);
  const isSpectatorDraft = seat === HOST && started;
  const time = isSpectatorDraft ?
    String(seconds) :
    String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  if (timer.textContent !== time) timer.textContent = time;
  timer.classList.toggle("urgent", seconds <= 10);
}
function renderBarBans() {
  const isSpectatorDraft = seat === HOST && started;
  const blueBarBans = $("blue-bans");
  const redBarBans = $("red-bans");
  if (!blueBarBans || !redBarBans) return;

  blueBarBans.hidden = !isSpectatorDraft;
  redBarBans.hidden = !isSpectatorDraft;
  if (!isSpectatorDraft) {
    blueBarBans.replaceChildren();
    redBarBans.replaceChildren();
    return;
  }

  const moveCount = presentedMoves();
  for (const side of [0, 1]) {
    const container = side === 0 ? blueBarBans : redBarBans;
    const heroes = teamHeroes(side, "แบน", moveCount);
    const slots = [];
    for (let i = 0; i < 2; i++) {
      const hero = heroes[i];
      const slot = node("div", "bar-ban-slot" + (hero ? " filled" : ""));
      if (hero) {
        slot.classList.add("banned");
        const portrait = portraitOf(hero, "eager");
        slot.append(portrait);
        slot.title = hero.name;
      } else {
        slot.append(node("span", "empty", "⊘"));
        slot.title = "แบน " + (i + 1);
      }
      slots.push(slot);
    }
    container.replaceChildren(...slots);
  }
}
function renderSelection() {
  const turn = turns[presentedMoves()];
  const button = $("confirm");
  const canAct = mayAct();
  $("selection").textContent = selected.length && turn ?
    selected.map(id => roster.get(id).name).join(" · ") + " (" + selected.length + "/" + turn.count + ")" :
    canAct ? "เลือกฮีโร่ " + turn.count + " ตัว แล้วกดยืนยัน" : "";
  button.textContent = turn ? "ยืนยัน " + actionLabels[turn.action] + " " + turn.count + " ตัว" : "จบการดราฟ";
  button.dataset.action = turn ? actionLabels[turn.action].toLowerCase() : "";
  button.dataset.side = String(turn?.side ?? "");
  button.disabled = !canAct || selected.length !== turn?.count;
}
function clearReveal() {
  if (!reveal) return;
  clearTimeout(reveal.timer);
  reveal = null;
  $("draft-reveal").hidden = true;
}
function showReveal(duration) {
  clearReveal();
  const turn = turns[moves.length - 1];
  const from = moves.length - turn.count;
  const popup = $("draft-reveal");
  popup.dataset.side = String(turn.side);
  popup.style.setProperty("--reveal-time", duration + "ms");
  $("reveal-title").textContent = turnSide(turn) + " · " + actionLabels[turn.action];
  $("reveal-heroes").replaceChildren(...moves.slice(from).map(id => {
    const hero = roster.get(id);
    const card = node("li", "reveal-card");
    card.classList.toggle("banned", turn.action === "แบน");
    card.append(portraitOf(hero, "eager"), node("span", "hero-name", hero.name));
    return card;
  }));
  reveal = {
    from, endsAt: performance.now() + duration, timer: setTimeout(() => {
      clearReveal();
      render();
    }, duration)
  };
  popup.hidden = false;
}
function showMatch() {
  const view = $("match-up");
  if (current() || reveal || view.open) return;
  for (const [side, id] of ["match-blue", "match-red"].entries()) {
    const team = $(id);
    const list = node("ol", "match-lineup");
    for (const hero of teamHeroes(side, "เลือก")) {
      const portrait = node("div", "match-portrait");
      const image = imageOf(hero);
      image.loading = "eager";
      portrait.append(image);
      const card = node("li");
      card.append(portrait, node("span", "", hero.name));
      list.append(card);
    }
    team.replaceChildren(node("h3", "", playerName(side)), list);
  }
  view.showModal();
}
function renderPhases(moveCount) {
  const active = started ? moveCount : -1;
  let offset = 0;
  $("phase-list").replaceChildren(...phases.map(([name, action, groups]) => {
    const end = offset + groups.reduce((total, [, count]) => total + count, 0);
    const item = node("li", active >= end ? "done" : active >= offset ? "now" : "");
    item.append(node("span", "phase-name", name));
    for (const [side, count] of groups) {
      const row = node("div", "phase-turn");
      row.dataset.side = String(side);
      row.classList.toggle("now-turn", offset === active);
      row.classList.toggle("done-turn", offset < active);
      if (offset === active) row.setAttribute("aria-current", "step");
      row.setAttribute("aria-label", describeTurn({ side, action, count }));
      row.append(node("span", "", sideLabels[side]), node("span", "", "×" + count));
      item.append(row);
      offset += count;
    }
    return item;
  }));
}
function render() {
  const isSpectatorDraft = seat === HOST && started;
  document.body.classList.toggle("spectator-draft", isSpectatorDraft);
  $("spectator-live").hidden = !isSpectatorDraft;
  $("roster-title").hidden = isSpectatorDraft;
  $("phase-list").hidden = isSpectatorDraft;
  const filtersEl = document.querySelector(".filters");
  if (filtersEl) filtersEl.hidden = isSpectatorDraft;
  $("hero-types").hidden = isSpectatorDraft;
  $("pool").hidden = isSpectatorDraft;
  const confirmEl = document.querySelector(".confirm");
  if (confirmEl) confirmEl.hidden = isSpectatorDraft;
  const footerEl = document.querySelector("footer");
  if (footerEl) footerEl.hidden = isSpectatorDraft;

  const resetBtn = $("reset");
  const topHeader = document.querySelector(".top");
  const centerSection = document.querySelector(".center");
  if (isSpectatorDraft) {
    if (resetBtn && centerSection && resetBtn.parentElement !== centerSection) {
      centerSection.append(resetBtn);
    }
  } else {
    if (resetBtn && topHeader && resetBtn.parentElement !== topHeader) {
      topHeader.append(resetBtn);
    }
  }

  const moveCount = presentedMoves();
  const turn = turns[moveCount];
  renderPhases(moveCount);
  const waiting = online.filter(Boolean).length;
  const title = !roster.size ? "กำลังโหลดคลังฮีโร่" : !turn ? "ดราฟเสร็จแล้ว · ครบทีมละ 5 ตัว" :
    seat === HOST && !peerOpen ? "กำลังเปิดห้อง…" :
      seat === HOST && !networkReady ? (started ? "ผู้เล่นหลุด · หยุดเวลาไว้จนกว่าจะกลับเข้าห้อง" : "รอผู้เล่นเข้าห้องจากลิงก์ (" + waiting + "/2)") :
        isPlayer() && stopped ? "เข้าห้องไม่ได้" :
          isPlayer() && !networkReady ? "กำลังเชื่อมต่อห้อง…" :
            isPlayer() && !(online[0] && online[1]) ? (started ? "อีกฝั่งหลุด · หยุดเวลาไว้" : "รอผู้เล่นอีกฝั่งเข้าห้อง") :
              !started ? (isPlayer() ? "รอผู้ชมเริ่มดราฟ" : "ตั้งชื่อผู้เล่นแล้วกดเริ่มดราฟ") :
                "ตอนนี้ · " + describeTurn(turn);
  $("turn").textContent = title;
  $("turn").dataset.side = String(started ? turn?.side ?? "" : "");
  const next = started && turn ? turns[moveCount + turn.count] : turn;
  const nextLabel = $("next-turn");
  nextLabel.hidden = !turn;
  nextLabel.dataset.side = String(next?.side ?? "");
  nextLabel.textContent = next ? (started ? "ถัดไป · " : "เทิร์นแรก · ") + describeTurn(next) : "จบดราฟหลังเทิร์นนี้";
  $("step").textContent = moveCount + " / " + turns.length;
  $("setup").hidden = started;
  for (const [side, id] of ["blue-name", "red-name"].entries()) {
    const input = $(id);
    input.readOnly = isPlayer();
    if (input.value !== playerNames[side]) input.value = playerNames[side];
  }
  $("start").hidden = isPlayer();
  $("start").disabled = roster.size < turns.length || (seat === HOST && !networkReady);
  $("reset").hidden = isPlayer();
  $("reset").disabled = !started || pending;
  $("connection").textContent = seat === -1 ? "เล่นเครื่องเดียว" :
    seat === HOST ? (started ? "โหมดผู้ชม (Live Draft)" : "ห้องออนไลน์ · คุณเป็นผู้ชม/คุมห้อง") :
      "ผู้เล่นฝั่ง" + sideLabels[seat] + (networkReady ? " · เชื่อมต่อแล้ว" : " · กำลังเชื่อมต่อ");
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(hostStoreKey) || "null"); } catch { }
  $("create").hidden = seat !== -1;
  $("create").disabled = !roster.size;
  $("resume").hidden = seat !== -1 || !saved?.code;
  $("resume").disabled = !roster.size;
  $("leave").hidden = seat !== HOST || isSpectatorDraft;
  $("room-code").hidden = seat === -1 || isSpectatorDraft;
  if (seat !== -1 && roomCode && !isSpectatorDraft) $("room-code").replaceChildren("ห้อง ", node("b", "", roomCode.slice(0, 4) + "…" + roomCode.slice(-4)));
  $("invites").hidden = seat !== HOST || isSpectatorDraft;
  if (seat === HOST && !isSpectatorDraft) {
    for (const box of $("invites").children) {
      const side = Number(box.dataset.side);
      const state = box.querySelector(".invite-state");
      state.textContent = online[side] ? "● เข้าห้องแล้ว" : bound[side] ? "○ หลุด รอกลับเข้า" : "○ ยังไม่มีคนเข้า";
      state.classList.toggle("on", online[side]);
      box.querySelector(".copy-link").disabled = !peerOpen;
    }
  }
  $("show-match").hidden = Boolean(turn);
  panel(0); panel(1); updatePool(); renderSelection(); renderCountdown(); renderBarBans();
  if (isSpectatorDraft) renderSpectatorLive();
  $("status").textContent = lastStatus;
  if (!turn && !completionShown) {
    completionShown = true;
    showMatch();
  } else if (turn) {
    completionShown = false;
    if ($("match-up").open) $("match-up").close();
  }
}
function putRoster(items) {
  const usable = items.filter(h => h && typeof h.id === "string" && typeof h.name === "string" &&
    typeof h.en === "string" && rarity.includes(h.tier) && typeof h.image === "string" &&
    (h.image === "" || h.image.startsWith("https://7katlas.com/images/heroes/")));
  usable.sort((a, b) => rarity.indexOf(a.tier) - rarity.indexOf(b.tier) || a.en.localeCompare(b.en));
  roster = new Map(usable.map(h => {
    const type = h.type !== "all" && Object.hasOwn(heroTypes, h.type) ?
      h.type : atlasFallbackTypes.get(h.en) ?? "all";
    return [h.id, { ...h, type }];
  }));
  $("pool").replaceChildren(...[...roster.values()].map(hero => {
    const card = node("button", "card");
    card.type = "button";
    card.dataset.id = hero.id;
    card.dataset.tier = hero.tier;
    const [label, symbol] = heroTypes[hero.type];
    card.dataset.type = hero.type;
    card.title = [hero.en, hero.type === "all" ? "" : label].filter(Boolean).join(" · ");
    card.append(portraitOf(hero), node("small", "tier", hero.tier), node("span", "hero", hero.name));
    if (symbol) {
      const icon = node("small", "type-symbol", symbol);
      icon.setAttribute("aria-hidden", "true");
      card.append(icon);
    }
    card.append(node("small", "tag"));
    return card;
  }));
  setStatus(!roster.size ? "โหลดคลังฮีโร่ไม่ได้ ลองรีเฟรชหน้า" :
    roster.size < turns.length ? "คลังฮีโร่ไม่พอสำหรับเริ่มดราฟ ลองรีเฟรชหน้า" : "");
  render();
  if (roster.size && joinInfo && isPlayer() && !peer) joinRoom();
}
function advanceTurn(ids) {
  moves = [...moves, ...ids];
  revision++;
  selected = []; remoteSelected = [[], []]; pending = false;
  showReveal(revealDuration);
  setCountdown(turnDuration);
}
function sendState() {
  if (seat !== HOST) return;
  const payload = {
    kind: "state", moves, revision, playerNames, started, remaining: timeLeft(),
    revealRemaining: revealTimeLeft(), notice: lastStatus, online: online.slice(), running: deadline !== null
  };
  for (const channel of seatLinks) if (channel?.open) { try { channel.send(payload); } catch { } }
  saveHost();
}
function saveHost() {
  if (seat !== HOST) return;
  try {
    localStorage.setItem(hostStoreKey, JSON.stringify({
      code: roomCode, tokens, bound, moves, revision, playerNames, started, remaining: timeLeft()
    }));
  } catch { }
}
function tick() {
  if (reveal && revealTimeLeft() === 0) {
    clearReveal();
    render();
  }
  renderCountdown();
  const turn = current();
  if (!turn || reveal || deadline === null || timeLeft() > 0 || isPlayer()) return;
  const choices = (seat === HOST ? remoteSelected[turn.side] : selected).slice();
  const needsFill = choices.length < turn.count;
  const available = [...roster.keys()].filter(id => !moves.includes(id) && !choices.includes(id));
  while (choices.length < turn.count) {
    const index = Math.floor(Math.random() * available.length);
    choices.push(available.splice(index, 1)[0]);
  }
  const message = needsFill ? "ล็อกฮีโร่และสุ่มเติมช่องว่าง" : "ล็อกฮีโร่ที่เลือกไว้";
  setStatus("หมดเวลาของ " + playerName(turn.side) + " · " + message);
  advanceTurn(choices);
  sendState();
  render();
}
function resetDraft() {
  if (isPlayer() || !started || !confirm("ล้างการดราฟและเริ่มใหม่?")) return;
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => { });
  }
  started = false; moves = []; selected = []; remoteSelected = [[], []]; revision++;
  clearReveal();
  setCountdown(0);
  setStatus("");
  sendState();
  render();
}
function startDraft(event) {
  event.preventDefault();
  if (started || isPlayer() || roster.size < turns.length || (seat === HOST && !networkReady)) return;
  if (seat === HOST) {
    try {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => { });
      } else if (document.documentElement.webkitRequestFullscreen) {
        document.documentElement.webkitRequestFullscreen();
      }
    } catch { }
  }
  playerNames = playerNames.map(name => name.trim());
  started = true; revision++;
  setCountdown(turnDuration);
  setStatus("");
  sendState();
  render();
}
function confirmMove() {
  tick();
  if (!mayAct() || !validSelection(selected, current(), true)) return;
  if (isPlayer()) {
    pending = true;
    link.send({ kind: "move", ids: selected, revision });
  } else {
    setStatus("");
    advanceTurn(selected);
    sendState();
  }
  render();
}
function closeEverything() {
  clearTimeout(clock); clearTimeout(retryTimer);
  const oldPeer = peer, oldLinks = [link, ...seatLinks];
  peer = null; link = null; seatLinks = [null, null];
  for (const channel of oldLinks) { try { channel?.close(); } catch { } }
  try { oldPeer?.destroy(); } catch { }
}
function localMode(message) {
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => { });
  }
  const remaining = timeLeft();
  closeEverything();
  seat = -1; networkReady = false; pending = false; peerOpen = false;
  online = [false, false]; roomCode = ""; joinInfo = null; stopped = false;
  selected = []; remoteSelected = [[], []];
  setCountdown(remaining);
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  setStatus(message);
  render();
}

/* ======== ผู้ชม = เจ้าของห้อง (ตัวกลางของห้อง) ======== */
function hostNetworkChanged() {
  const remaining = timeLeft();
  online = seatLinks.map(channel => Boolean(channel?.open));
  const ready = online[0] && online[1];
  if (ready !== networkReady) {
    networkReady = ready;
    setCountdown(remaining);   // ผู้เล่นไม่ครบ = หยุดเวลา, ครบ = เดินต่อ
  }
  sendState();
  render();
}
function deny(channel, text) {
  try { channel.send({ kind: "denied", text }); } catch { }
  setTimeout(() => { try { channel.close(); } catch { } }, 400);
}
function hostData(channel, payload) {
  if (!payload || typeof payload !== "object") return;
  if (payload.kind === "hello") {
    const side = payload.side;
    const who = typeof payload.cid === "string" ? payload.cid.slice(0, 40) : "";
    if ((side !== 0 && side !== 1) || !who || payload.token !== tokens[side]) {
      deny(channel, "ลิงก์ไม่ถูกต้องหรือถูกยกเลิกแล้ว ขอลิงก์ใหม่จากผู้ชม");
      return;
    }
    if (bound[side] && bound[side] !== who) {
      deny(channel, "ลิงก์นี้มีผู้เล่นใช้เข้าห้องแล้ว (ลิงก์ละ 1 คน)");
      return;
    }
    const old = seatLinks[side];
    bound[side] = who;
    seatLinks[side] = channel;
    channel.side = side;
    channel.lastSeen = performance.now();
    if (old && old !== channel) { old.replaced = true; try { old.close(); } catch { } }
    setStatus("ผู้เล่นฝั่ง" + sideLabels[side] + "เข้าห้องแล้ว");
    hostNetworkChanged();
    return;
  }
  const side = channel.side;
  if (side === undefined || seatLinks[side] !== channel) return;
  if (payload.kind === "move" || payload.kind === "preview") {
    tick();
    const turn = current();
    const isCommit = payload.kind === "move";
    if (turn?.side === side && started && networkReady && !reveal && timeLeft() > 0 &&
      payload.revision === revision && validSelection(payload.ids, turn, isCommit)) {
      if (!isCommit) {
        remoteSelected[side] = payload.ids.slice();
        updatePool();
        return;
      }
      setStatus("");
      advanceTurn(payload.ids);
    }
    if (isCommit) {
      sendState();
      render();
    }
  }
}
function hostDropped(channel) {
  const side = channel.side;
  if (side === undefined || seatLinks[side] !== channel) return;
  seatLinks[side] = null;
  remoteSelected[side] = [];
  if (!channel.replaced) setStatus("ผู้เล่นฝั่ง" + sideLabels[side] + "หลุดจากห้อง · ลิงก์เดิมกลับเข้าได้");
  hostNetworkChanged();
}
function openHostPeer() {
  const Peer = globalThis.peerjs?.Peer || globalThis.Peer;
  if (!Peer) { localMode("โหลดระบบห้องไม่ได้ ลองรีเฟรชหน้า"); return; }
  let client;
  try { client = new Peer(roomPrefix + roomCode, peerOptions); }
  catch { localMode("เปิดห้องไม่ได้ ลองใช้ Chrome หรือ Edge"); return; }
  peer = client;
  client.on("open", () => {
    if (peer !== client) return;
    peerOpen = true; hostRetry = 0;
    setStatus(location.protocol.startsWith("http") ?
      "ห้องพร้อมแล้ว · คัดลอกลิงก์ส่งให้ผู้เล่นคนละลิงก์" :
      "ห้องพร้อมแล้ว · แต่หน้านี้เปิดจากไฟล์ในเครื่อง ลิงก์จะใช้ได้เมื่อเปิดจากเว็บ (เช่น GitHub Pages)");
    saveHost();
    render();
  });
  client.on("connection", channel => {
    if (peer !== client) { channel.close(); return; }
    channel.on("open", () => {
      setTimeout(() => { if (channel.side === undefined && channel.open) deny(channel, "ไม่ได้รับอนุญาต"); }, 8000);
    });
    channel.on("data", payload => { channel.lastSeen = performance.now(); if (peer === client && payload?.kind !== "ping") hostData(channel, payload); });
    channel.on("close", () => hostDropped(channel));
    channel.on("error", () => hostDropped(channel));
  });
  client.on("disconnected", () => {
    if (peer !== client) return;
    setTimeout(() => { try { if (peer === client && !client.destroyed) client.reconnect(); } catch { } }, 1500);
  });
  client.on("error", error => {
    if (peer !== client) return;
    if (error.type === "unavailable-id" || error.type === "network" || error.type === "server-error" ||
      error.type === "socket-error" || error.type === "socket-closed") {
      peerOpen = false;
      hostRetry++;
      if (hostRetry > 15) { localMode("เปิดห้องไม่สำเร็จ ลองสร้างห้องใหม่"); return; }
      setStatus(error.type === "unavailable-id" ?
        "กำลังกู้ห้องเดิม… (รอระบบปล่อยรหัสห้อง ครั้งที่ " + hostRetry + ")" :
        "การเชื่อมต่อมีปัญหา กำลังลองใหม่…");
      render();
      try { client.destroy(); } catch { }
      peer = null;
      retryTimer = setTimeout(() => { if (seat === HOST && !peer) openHostPeer(); }, 4000);
    } else if (error.type === "browser-incompatible") {
      localMode("เบราว์เซอร์นี้ไม่รองรับ ลองใช้ Chrome หรือ Edge");
    }
  });
}
function createRoom(saved) {
  if (!roster.size || seat !== -1) return;
  closeEverything();
  seat = HOST; peerOpen = false; hostRetry = 0; networkReady = false;
  online = [false, false]; seatLinks = [null, null]; remoteSelected = [[], []]; selected = []; pending = false;
  clearReveal();
  if (saved && codePattern.test(saved.code) && validHistory(saved.moves)) {
    roomCode = saved.code;
    tokens = saved.tokens; bound = saved.bound || [null, null];
    moves = saved.moves; revision = (saved.revision || 0) + 1;
    playerNames = Array.isArray(saved.playerNames) ? saved.playerNames : ["", ""];
    started = Boolean(saved.started);
    setCountdown(Math.min(turnDuration, Math.max(0, Number(saved.remaining) || turnDuration)));
    setStatus("กำลังเปิดห้องเดิม…");
  } else {
    roomCode = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    tokens = [randomToken(), randomToken()]; bound = [null, null];
    moves = []; revision = 0; started = false;
    setCountdown(0);
    setStatus("กำลังสร้างห้อง…");
  }
  render();
  openHostPeer();
}
function inviteLink(side) {
  return location.href.split("#")[0] + "#join=" + roomCode + "." + side + "." + tokens[side];
}
async function copyInvite(side) {
  const url = inviteLink(side);
  try { await navigator.clipboard.writeText(url); setStatus("คัดลอกลิงก์ฝั่ง" + sideLabels[side] + "แล้ว · ส่งให้ผู้เล่นได้เลย"); }
  catch { window.prompt("คัดลอกลิงก์นี้ส่งให้ผู้เล่นฝั่ง" + sideLabels[side], url); }
}
function renewInvite(side) {
  if (!confirm("สร้างลิงก์ใหม่ให้ฝั่ง" + sideLabels[side] + "? ลิงก์เก่าจะใช้ไม่ได้ และผู้เล่นที่อยู่ฝั่งนี้จะถูกนำออก")) return;
  tokens[side] = randomToken();
  bound[side] = null;
  const channel = seatLinks[side];
  if (channel) { seatLinks[side] = null; channel.replaced = true; deny(channel, "ผู้ชมนำคุณออกจากห้อง"); }
  remoteSelected[side] = [];
  setStatus("สร้างลิงก์ใหม่ฝั่ง" + sideLabels[side] + "แล้ว · ลิงก์เก่าใช้ไม่ได้อีก");
  hostNetworkChanged();
}
function closeRoom() {
  if (!confirm("ปิดห้องนี้? ผู้เล่นทั้งสองฝั่งจะหลุดออก")) return;
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => { });
  }
  for (const channel of seatLinks) { try { channel?.send({ kind: "closed" }); } catch { } }
  try { localStorage.removeItem(hostStoreKey); } catch { }
  setTimeout(() => localMode("ปิดห้องแล้ว"), 150);
}

/* ======== ผู้เล่น (เข้าจากลิงก์เท่านั้น) ======== */
function joinRoom() {
  if (!joinInfo || stopped) return;
  const Peer = globalThis.peerjs?.Peer || globalThis.Peer;
  if (!Peer) { setStatus("โหลดระบบห้องไม่ได้ ลองรีเฟรชหน้า"); return; }
  closeEverything();
  seat = joinInfo.side; roomCode = joinInfo.code;
  networkReady = false; pending = false;
  let client;
  try { client = new Peer(peerOptions); }
  catch { setStatus("เข้าห้องไม่ได้ ลองใช้ Chrome หรือ Edge"); return; }
  peer = client;
  if (!networkReady) setStatus("กำลังเข้าห้อง…");
  render();
  clock = setTimeout(() => { if (peer === client && !networkReady) retryJoin("ยังเชื่อมต่อห้องไม่ได้ กำลังลองใหม่…"); }, 15000);
  client.on("open", () => {
    if (peer !== client) return;
    const channel = client.connect(roomPrefix + roomCode, { reliable: true, serialization: "json" });
    connectPlayer(channel);
  });
  client.on("error", error => {
    if (peer !== client) return;
    if (error.type === "peer-unavailable") retryJoin("ยังไม่พบห้อง · ผู้ชมต้องเปิดหน้าห้องค้างไว้ กำลังลองใหม่…");
    else if (error.type === "browser-incompatible") { stopped = true; setStatus("เบราว์เซอร์นี้ไม่รองรับ ลองใช้ Chrome หรือ Edge"); render(); }
    else retryJoin("การเชื่อมต่อมีปัญหา กำลังลองใหม่…");
  });
}
function retryJoin(message) {
  if (stopped || !isPlayer()) return;
  const remaining = timeLeft();
  closeEverything();
  networkReady = false; pending = false; selected = [];
  setCountdown(remaining);
  setStatus(message);
  render();
  retryTimer = setTimeout(joinRoom, 3000);
}
function connectPlayer(channel) {
  link = channel;
  channel.on("open", () => {
    if (link !== channel) return;
    channel.lastSeen = performance.now();
    channel.send({ kind: "hello", cid, side: joinInfo.side, token: joinInfo.token });
  });
  channel.on("data", payload => {
    if (link !== channel || !payload || typeof payload !== "object") return;
    channel.lastSeen = performance.now();
    if (payload.kind === "ping") return;
    if (payload.kind === "denied") {
      stopped = true; networkReady = false;
      setCountdown(0);
      setStatus(typeof payload.text === "string" ? payload.text.slice(0, 160) : "เข้าห้องไม่ได้");
      closeEverything();
      render();
      return;
    }
    if (payload.kind === "closed") {
      stopped = true; networkReady = false;
      setCountdown(0);
      setStatus("ผู้ชมปิดห้องแล้ว");
      closeEverything();
      render();
      return;
    }
    if (payload.kind !== "state") return;
    const delay = payload.revealRemaining ?? 0;
    if (!validHistory(payload.moves) || !Number.isSafeInteger(payload.revision) || payload.revision < 0 ||
      (networkReady && payload.revision < revision) || typeof payload.started !== "boolean" ||
      (!payload.started && payload.moves.length) || !Number.isFinite(payload.remaining) ||
      payload.remaining < 0 || payload.remaining > turnDuration ||
      !Number.isFinite(delay) || delay < 0 || delay > revealDuration + 500 ||
      !Array.isArray(payload.playerNames) ||
      payload.playerNames.length !== 2 || payload.playerNames.some(name => typeof name !== "string" || name.length > 32) ||
      !Array.isArray(payload.online) || payload.online.length !== 2) return;
    clearTimeout(clock);
    const newState = !networkReady || revision !== payload.revision;
    if (newState || pending) selected = [];
    networkReady = true; pending = false;
    moves = payload.moves; revision = payload.revision;
    playerNames = payload.playerNames; started = payload.started;
    online = payload.online.map(Boolean);
    if (newState) {
      clearReveal();
      if (started && moves.length && delay > 0) showReveal(delay);
    }
    setCountdown(payload.remaining);
    if (payload.running === false) deadline = null;   // ผู้ชมหยุดเวลาไว้ (มีคนหลุด)
    setStatus(typeof payload.notice === "string" ? payload.notice.slice(0, 160) : "");
    render();
  });
  const dropped = () => {
    if (link !== channel || stopped) return;
    retryJoin("หลุดจากห้อง กำลังเชื่อมต่อใหม่…");
  };
  channel.on("close", dropped);
  channel.on("error", dropped);
}
$("pool").onclick = event => {
  const activeRevision = revision;
  tick();
  if (revision !== activeRevision) return;
  const id = event.target.closest("button[data-id]")?.dataset.id;
  const turn = current();
  if (!id || !mayAct() || !validSelection([id], turn, false)) return;
  if (selected.includes(id)) selected = selected.filter(choice => choice !== id);
  else if (turn.count === 1) selected = [id];
  else if (selected.length < turn.count) selected = [...selected, id];
  if (isPlayer() && link?.open) link.send({ kind: "preview", ids: selected, revision });
  updatePool();
  renderSelection();
};
$("hero-types").replaceChildren(...Object.entries(heroTypes).map(([type, [label, symbol, english]]) => {
  const button = node("button", "type-filter");
  button.type = "button";
  button.dataset.type = type;
  button.title = english || label;
  button.setAttribute("aria-pressed", String(type === heroType));
  if (symbol) {
    const icon = node("span", "type-symbol", symbol);
    icon.setAttribute("aria-hidden", "true");
    button.append(icon);
  }
  button.append(node("span", "", label));
  button.onclick = () => {
    heroType = type;
    for (const filter of $("hero-types").children) {
      filter.setAttribute("aria-pressed", String(filter.dataset.type === type));
    }
    updatePool();
  };
  return button;
}));
for (const [side, id] of ["blue-name", "red-name"].entries()) {
  $(id).oninput = event => {
    if (isPlayer() || started) return;
    playerNames[side] = event.target.value.slice(0, 32);
    sendState();
    render();
  };
}
$("search").oninput = $("tier").onchange = $("hide").onchange = updatePool;
$("setup").onsubmit = startDraft;
$("show-match").onclick = showMatch;
$("match-up").addEventListener("close", () => {
  if (!current()) $("show-match").focus();
});
$("confirm").onclick = confirmMove;
$("reset").onclick = resetDraft;
$("create").onclick = () => createRoom(null);
$("resume").onclick = () => {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(hostStoreKey) || "null"); } catch { }
  if (saved) createRoom(saved);
};
$("leave").onclick = closeRoom;
for (const box of $("invites").children) {
  const side = Number(box.dataset.side);
  box.querySelector(".copy-link").onclick = () => copyInvite(side);
  box.querySelector(".renew-link").onclick = () => renewInvite(side);
}
// สัญญาณชีพ: ส่ง ping ทุก 2 วิ ถ้าเงียบเกิน 8 วิ ถือว่าหลุด (WebRTC มักไม่แจ้งทันทีเมื่ออีกฝั่งปิดแท็บ)
setInterval(() => {
  const now = performance.now();
  if (seat === HOST) {
    for (const channel of seatLinks) {
      if (!channel) continue;
      if (now - (channel.lastSeen || now) > 8000) { try { channel.close(); } catch { } hostDropped(channel); continue; }
      if (channel.open) { try { channel.send({ kind: "ping" }); } catch { } }
    }
  } else if (isPlayer() && link?.open && networkReady) {
    if (now - (link.lastSeen || now) > 8000) { retryJoin("ขาดการติดต่อกับห้อง กำลังเชื่อมต่อใหม่…"); return; }
    try { link.send({ kind: "ping" }); } catch { }
  }
}, 2000);
window.addEventListener("beforeunload", event => {
  if (seat === HOST && started && current()) { event.preventDefault(); event.returnValue = ""; }
});
{
  const match = location.hash.match(joinPattern);
  if (match) {
    joinInfo = { code: match[1], side: Number(match[2]), token: match[3] };
    seat = joinInfo.side; roomCode = joinInfo.code;
    lastStatus = "กำลังโหลดฮีโร่ แล้วจะเข้าห้องให้อัตโนมัติ";
  }
}

function acceptAtlas(event) {
  if (event.source !== atlasFrame?.contentWindow || event.data?.kind !== "7k-atlas-rta") return;
  window.removeEventListener("message", acceptAtlas);
  clearTimeout(atlasTimer);
  atlasFrame.remove();
  putRoster(Array.isArray(event.data.items) ? event.data.items : []);
}
window.addEventListener("message", acceptAtlas);
atlasFrame = document.createElement("iframe");
atlasFrame.hidden = true;
atlasFrame.setAttribute("sandbox", "allow-scripts");
atlasFrame.title = "คลังฮีโร่ 7K Atlas";
atlasFrame.srcdoc = '<script src="https://7katlas.com/COMBINE/codex_lite_heroes.js?v=6b83d460c5"><\/script><script>' +
  'const items = typeof HEROES === "undefined" ? [] : HEROES.filter(h => h.status !== "unreleased").map(h => {' +
  'const p=h.portraits||{}, src=p.awk||p.s6||p.s5||p.s4||p.s3;' +
  'const type = typeof h.type === "string" ? h.type.trim().toLowerCase() : "";' +
  'return {id:h.id,name:h.name_th||h.name,en:h.name,tier:h.rarity,type,image:src ? new URL(src,"https://7katlas.com/").href : ""};' +
  '}); parent.postMessage({kind:"7k-atlas-rta",items},"*");<\/script>';
const atlasTimer = setTimeout(() => {
  if (!roster.size) setStatus("โหลดคลังฮีโร่นานกว่าปกติ ตรวจอินเทอร์เน็ตแล้วลองรีเฟรช");
}, 12000);
document.body.append(atlasFrame);
setInterval(tick, 200);
render();
