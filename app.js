(() => {
  const $ = (id) => document.getElementById(id);

  const STORAGE_KEY = "zombie_dice_pwa_v1";

  const state = {
    players: [],          // {id, name, total, turns}
    log: [],              // {ts, playerId, brains, shotguns, note}
    target: 13,
    locked: false,

    // Final-round rule:
    // When someone reaches target at end of their turn, everyone ELSE gets one last turn.
    finalRound: {
      active: false,
      starterId: null,
      remainingIds: []    // player IDs who still need their last turn (excludes starter)
    }
  };

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;

      state.players = Array.isArray(parsed.players) ? parsed.players : [];
      state.log = Array.isArray(parsed.log) ? parsed.log : [];
      state.target = Number.isFinite(parsed.target) ? parsed.target : 13;
      state.locked = !!parsed.locked;

      const fr = parsed.finalRound || {};
      state.finalRound.active = !!fr.active;
      state.finalRound.starterId = fr.starterId || null;
      state.finalRound.remainingIds = Array.isArray(fr.remainingIds) ? fr.remainingIds : [];
    } catch {}
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    return d.toLocaleString([], { month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit" });
  }

  function computeLeader() {
    if (state.players.length === 0) return null;
    let best = state.players[0];
    for (const p of state.players) if (p.total > best.total) best = p;
    const ties = state.players.filter(p => p.total === best.total);
    return { best, ties };
  }

  function statusLine() {
    if (state.players.length === 0) {
      return { badge: "Add players", kind: "", text: "Add at least 1 player to start." };
    }
    if (state.locked) {
      return { badge: "Game over", kind: "good", text: "Final round is complete. Tap New Game to play again." };
    }

    if (state.finalRound.active) {
      const remainingNames = state.finalRound.remainingIds
        .map(id => state.players.find(p => p.id === id)?.name)
        .filter(Boolean);

      const starterName = state.players.find(p => p.id === state.finalRound.starterId)?.name || "Someone";

      if (remainingNames.length === 0) {
        return { badge: "Final round complete", kind: "good", text: "Final round is complete. The game is now locked." };
      }

      return {
        badge: "Final round!",
        kind: "warn",
        text: `${starterName} hit ${state.target}+ brains. Remaining last turns: ${remainingNames.join(", ")}.`
      };
    }

    return {
      badge: "Game active",
      kind: "good",
      text: `Playing to ${state.target} brains. When someone reaches it, everyone else gets one last turn.`
    };
  }

  // Auto-advance helpers
  function nextPlayerIdAfter(currentId) {
    if (state.players.length === 0) return null;

    const order = state.players.map(p => p.id);
    const idx = order.indexOf(currentId);
    let i = idx >= 0 ? idx : 0;

    for (let step = 0; step < order.length; step++) {
      i = (i + 1) % order.length;
      const candidate = order[i];

      // If final round is active, the starter should NOT take another turn
      if (state.finalRound.active && candidate === state.finalRound.starterId) continue;

      // If final round is active, only allow players who still have their last turn
      if (state.finalRound.active) {
        if (state.finalRound.remainingIds.includes(candidate)) return candidate;
        continue;
      }

      return candidate;
    }

    // If no valid candidate found, return current
    return currentId;
  }

  function setTurnPlayer(playerId) {
    const sel = $("turnPlayer");
    if (!sel) return;
    sel.value = playerId;
  }

  function rerender() {
    // Target input
    $("targetScore").value = state.target;

    // Player select
    const sel = $("turnPlayer");
    const currentSelected = sel?.value || null;

    sel.innerHTML = "";
    for (const p of state.players) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    }

    // Restore selection if possible
    if (currentSelected && state.players.some(p => p.id === currentSelected)) {
      sel.value = currentSelected;
    }

    // Scoreboard
    const body = $("scoreBody");
    body.innerHTML = "";
    const leader = computeLeader();
    const leaderId = leader?.best?.id ?? null;

    const sorted = [...state.players].sort((a, b) => b.total - a.total);
    for (const p of sorted) {
      const tr = document.createElement("tr");
      const td1 = document.createElement("td");
      const td2 = document.createElement("td");
      const td3 = document.createElement("td");
      td1.textContent = p.name + (p.id === leaderId && leader?.ties?.length === 1 ? " 🏆" : "");
      td2.textContent = String(p.total);
      td3.textContent = String(p.turns);
      tr.append(td1, td2, td3);
      body.appendChild(tr);
    }

    // Leader badge
    const leaderBadge = $("leaderBadge");
    if (state.players.length === 0) {
      leaderBadge.textContent = "No players yet";
    } else if (leader?.ties?.length > 1) {
      leaderBadge.textContent = `Tie: ${leader.ties.map(t => t.name).join(", ")} (${leader.best.total})`;
    } else {
      leaderBadge.textContent = `Leader: ${leader.best.name} (${leader.best.total})`;
    }

    // Status
    const st = statusLine();
    const badge = $("statusBadge");
    badge.className = "pill" + (st.kind ? ` ${st.kind}` : "");
    badge.textContent = st.badge;
    $("statusText").textContent = st.text;

    // Log
    const logEl = $("log");
    if (state.log.length === 0) {
      logEl.textContent = "No turns logged yet.";
    } else {
      logEl.innerHTML = state.log.slice().reverse().map(entry => {
        const name = state.players.find(p => p.id === entry.playerId)?.name || "Unknown";
        const extras = [];
        if (entry.shotguns > 0) extras.push(`shotguns: ${entry.shotguns}`);
        if (entry.note) extras.push(entry.note);
        return `
          <div class="card" style="margin:8px 0; padding:10px;">
            <div><strong>${name}</strong> +${entry.brains} brains</div>
            <div class="muted">${fmtTime(entry.ts)}${extras.length ? " • " + extras.join(" • ") : ""}</div>
          </div>`;
      }).join("");
    }

    // Inputs enabled state
    const canPlay = !state.locked && state.players.length > 0;
    $("logTurnBtn").disabled = !canPlay;
    $("brains").disabled = !canPlay;
    $("shotguns").disabled = !canPlay;
    $("note").disabled = !canPlay;
    $("turnPlayer").disabled = !canPlay;

    $("playerName").disabled = state.locked;
    $("addPlayerBtn").disabled = state.locked;

    $("undoBtn").disabled = state.locked || state.log.length === 0;

    save();
  }

  function addPlayer(name) {
    const n = (name || "").trim();
    if (!n || state.locked) return;
    state.players.push({ id: uid(), name: n, total: 0, turns: 0 });
    rerender();

    // If this is the first player, select them
    if (state.players.length === 1) setTurnPlayer(state.players[0].id);
  }

  function startFinalRound(starterId) {
    state.finalRound.active = true;
    state.finalRound.starterId = starterId;

    // Keep remainingIds in seating order (order players were added)
    state.finalRound.remainingIds = state.players
      .map(p => p.id)
      .filter(id => id !== starterId);
  }

  function maybeAdvanceFinalRound(playerId) {
    if (!state.finalRound.active) return;

    // If this player was due a last turn, mark it done
    const idx = state.finalRound.remainingIds.indexOf(playerId);
    if (idx !== -1) state.finalRound.remainingIds.splice(idx, 1);

    // If everyone else has taken their last turn, lock game
    if (state.finalRound.remainingIds.length === 0) {
      state.locked = true;
    }
  }

  function logTurn(playerId, brains, shotguns, note) {
    if (state.locked) return;
    const p = state.players.find(x => x.id === playerId);
    if (!p) return;

    const b = Math.max(0, Math.floor(Number(brains) || 0));
    const s = Math.max(0, Math.floor(Number(shotguns) || 0));

    // Banked brains (enter 0 if busted)
    p.total += b;
    p.turns += 1;

    state.log.push({
      ts: Date.now(),
      playerId,
      brains: b,
      shotguns: s,
      note: (note || "").trim()
    });

    // Trigger final round if not active yet
    if (!state.finalRound.active && p.total >= state.target) {
      startFinalRound(playerId);
      // Starter does NOT get another turn; everyone else does.
    } else if (state.finalRound.active) {
      // If final round already active, mark down remaining
      maybeAdvanceFinalRound(playerId);
    }

    // Auto-advance
    const nextId = nextPlayerIdAfter(playerId);

    rerender();

    // After re-render, set selection to next player (unless game is locked now)
    if (!state.locked && nextId) setTurnPlayer(nextId);
  }

  function recomputeFinalRoundFromLog() {
    // Reset derived state
    state.locked = false;
    state.finalRound = { active: false, starterId: null, remainingIds: [] };

    // Reset scores/turns then replay log
    for (const pl of state.players) { pl.total = 0; pl.turns = 0; }

    for (const entry of state.log) {
      const p = state.players.find(x => x.id === entry.playerId);
      if (!p) continue;

      p.total += entry.brains;
      p.turns += 1;

      if (!state.finalRound.active && p.total >= state.target) {
        startFinalRound(entry.playerId);
      } else if (state.finalRound.active) {
        maybeAdvanceFinalRound(entry.playerId);
      }
    }
  }

  function undoLast() {
    if (state.locked) return;
    const last = state.log.pop();
    if (!last) return;

    // Recompute everything safely
    recomputeFinalRoundFromLog();
    rerender();

    // Put turn selector back on the person who was undone (nice UX)
    if (!state.locked && state.players.some(p => p.id === last.playerId)) {
      setTurnPlayer(last.playerId);
    }
  }

  function newGame() {
    // Keep players & target, reset everything else
    for (const p of state.players) { p.total = 0; p.turns = 0; }
    state.log = [];
    state.locked = false;
    state.finalRound = { active: false, starterId: null, remainingIds: [] };
    rerender();

    // Select first player again
    if (state.players.length > 0) setTurnPlayer(state.players[0].id);
  }

  function clearData() {
    localStorage.removeItem(STORAGE_KEY);
    state.players = [];
    state.log = [];
    state.target = 13;
    state.locked = false;
    state.finalRound = { active: false, starterId: null, remainingIds: [] };
    rerender();
  }

  function applyTarget() {
    if (state.locked) return;
    const t = Math.max(1, Math.floor(Number($("targetScore").value) || 13));
    state.target = t;
    // Recompute in case changing target mid-game
    recomputeFinalRoundFromLog();
    rerender();
  }

  // Events
  $("addPlayerBtn").addEventListener("click", () => {
    addPlayer($("playerName").value);
    $("playerName").value = "";
    $("playerName").focus();
  });

  $("playerName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      addPlayer($("playerName").value);
      $("playerName").value = "";
      $("playerName").focus();
    }
  });

  $("applyTargetBtn").addEventListener("click", applyTarget);

  $("logTurnBtn").addEventListener("click", () => {
    const pid = $("turnPlayer").value;
    logTurn(pid, $("brains").value, $("shotguns").value, $("note").value);

    // Clear and focus for next entry
    $("brains").value = "";
    $("shotguns").value = "";
    $("note").value = "";
    $("brains").focus();
  });

  $("undoBtn").addEventListener("click", undoLast);
  $("newGameBtn").addEventListener("click", newGame);
  $("clearDataBtn").addEventListener("click", clearData);

  // Init
  load();
  $("targetScore").value = state.target;

  // Ensure derived state is consistent with log
  recomputeFinalRoundFromLog();
  rerender();

  // If we have players and nothing selected, select first
  if (state.players.length > 0 && !$("turnPlayer").value) {
    setTurnPlayer(state.players[0].id);
  }
})();