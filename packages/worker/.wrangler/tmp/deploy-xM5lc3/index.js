var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/auth.ts
var KNOWN_DEV_DEFAULTS = [
  "dev-secret-change-in-production",
  "insecure-dev-placeholder",
  "change-me",
  "secret",
  "dev-secret"
];
var MIN_SECRET_BYTES = 32;
function utf8ByteLength(s) {
  return new TextEncoder().encode(s).length;
}
__name(utf8ByteLength, "utf8ByteLength");
function timingSafeEqual(a, b) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  const len = Math.max(ea.length, eb.length);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  }
  return diff === 0;
}
__name(timingSafeEqual, "timingSafeEqual");
function isKnownDevDefault(secret) {
  let matched = 0;
  for (const d of KNOWN_DEV_DEFAULTS) {
    matched |= timingSafeEqual(secret, d) ? 1 : 0;
  }
  return matched === 1;
}
__name(isKnownDevDefault, "isKnownDevDefault");
function serviceUnavailable() {
  return new Response(
    JSON.stringify({ error: "service_unavailable", reason: "server not configured" }),
    { status: 503, headers: { "content-type": "application/json" } }
  );
}
__name(serviceUnavailable, "serviceUnavailable");
function assertSecret(env) {
  const secret = env.JWT_SECRET;
  if (!secret) return serviceUnavailable();
  if (isKnownDevDefault(secret)) return serviceUnavailable();
  if (utf8ByteLength(secret) < MIN_SECRET_BYTES) return serviceUnavailable();
  return null;
}
__name(assertSecret, "assertSecret");

// src/game-do.ts
import { DurableObject } from "cloudflare:workers";

// ../engine/src/deck.ts
var COLORS = ["blue", "red", "yellow", "green"];
var SHAPES = ["triangle", "plus", "square", "circle"];
var NUMBERS = [1, 2, 3, 4];
function createDeck() {
  const deck = [];
  for (const color of COLORS)
    for (const shape of SHAPES)
      for (const number of NUMBERS)
        deck.push({ kind: "regular", color, shape, number });
  deck.push({ kind: "wild" });
  deck.push({ kind: "wild" });
  return deck;
}
__name(createDeck, "createDeck");
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
__name(shuffle, "shuffle");

// ../engine/src/grid.ts
function posKey(p) {
  return `${p.x},${p.y}`;
}
__name(posKey, "posKey");
function fromKey(key) {
  const [x, y] = key.split(",").map(Number);
  return { x, y };
}
__name(fromKey, "fromKey");
function getSegment(grid, pos, axis) {
  const fixed = axis === "row" ? pos.y : pos.x;
  const varying = axis === "row" ? pos.x : pos.y;
  const make = /* @__PURE__ */ __name((v) => axis === "row" ? { x: v, y: fixed } : { x: fixed, y: v }, "make");
  const positions = [pos];
  for (let v = varying - 1; grid.has(posKey(make(v))); v--) positions.unshift(make(v));
  for (let v = varying + 1; grid.has(posKey(make(v))); v++) positions.push(make(v));
  return positions;
}
__name(getSegment, "getSegment");
function getMaximalSegments(grid, pos) {
  const row = getSegment(grid, pos, "row");
  const col = getSegment(grid, pos, "col");
  return [row, col].filter((s) => s.length >= 2);
}
__name(getMaximalSegments, "getMaximalSegments");

// ../engine/src/lineValidator.ts
var COLORS2 = ["blue", "red", "yellow", "green"];
var SHAPES2 = ["triangle", "plus", "square", "circle"];
var NUMBERS2 = [1, 2, 3, 4];
function isValidLine(cards) {
  if (cards.length <= 1) return true;
  const valid = /* @__PURE__ */ __name((vals) => {
    const unique = new Set(vals);
    return unique.size === 1 || unique.size === vals.length;
  }, "valid");
  return valid(cards.map((c) => c.color)) && valid(cards.map((c) => c.shape)) && valid(cards.map((c) => c.number));
}
__name(isValidLine, "isValidLine");
function solveWilds(wilds, lines) {
  if (wilds.length === 0) {
    return lines.every((line) => isValidLine(line)) ? [] : null;
  }
  const allAssignments = [];
  for (const color of COLORS2)
    for (const shape of SHAPES2)
      for (const number of NUMBERS2)
        allAssignments.push({ color, shape, number });
  function solve(idx, assignments) {
    if (idx === wilds.length) {
      for (const line of lines) {
        const resolved = line.map((card) => {
          if (card.kind === "regular") return card;
          const wi = wilds.indexOf(card);
          if (wi === -1) {
            throw new Error("solveWilds: encountered a wild not present in the wilds list (caller must supply the transitive closure of connected wilds)");
          }
          return { kind: "regular", ...assignments[wi] };
        });
        if (!isValidLine(resolved)) return null;
      }
      return assignments;
    }
    for (const a of allAssignments) {
      const result = solve(idx + 1, [...assignments, a]);
      if (result) return result;
    }
    return null;
  }
  __name(solve, "solve");
  return solve(0, []);
}
__name(solveWilds, "solveWilds");
function wildLinesConsistent(grid, seedPositions) {
  const segByKey = /* @__PURE__ */ new Map();
  const wildKeys = /* @__PURE__ */ new Set();
  const queue = [];
  const addSegment = /* @__PURE__ */ __name((seg) => {
    if (seg.length > 4) return false;
    const k = seg.map(posKey).sort().join("|");
    if (segByKey.has(k)) return true;
    segByKey.set(k, seg);
    for (const p of seg) {
      const c = grid.get(posKey(p));
      const pk = posKey(p);
      if (c && c.kind === "wild" && !wildKeys.has(pk)) {
        wildKeys.add(pk);
        queue.push(pk);
      }
    }
    return true;
  }, "addSegment");
  for (const p of seedPositions) {
    for (const seg of getMaximalSegments(grid, p)) if (!addSegment(seg)) return false;
  }
  while (queue.length > 0) {
    const wk = queue.shift();
    for (const seg of getMaximalSegments(grid, fromKey(wk))) if (!addSegment(seg)) return false;
  }
  const sentinelByKey = /* @__PURE__ */ new Map();
  for (const k of wildKeys) sentinelByKey.set(k, { kind: "wild" });
  const resolveCell = /* @__PURE__ */ __name((p) => {
    const k = posKey(p);
    const c = grid.get(k);
    return c.kind === "wild" ? sentinelByKey.get(k) : c;
  }, "resolveCell");
  const wildLines = [];
  for (const seg of segByKey.values()) {
    const cards = seg.map(resolveCell);
    if (cards.some((c) => c.kind === "wild")) wildLines.push(cards);
    else if (!isValidLine(cards)) return false;
  }
  if (wildLines.length === 0) return true;
  const allWilds = [...wildKeys].map((k) => sentinelByKey.get(k));
  return solveWilds(allWilds, wildLines) !== null;
}
__name(wildLinesConsistent, "wildLinesConsistent");

// ../engine/src/playValidator.ts
function validatePlay(grid, placements) {
  if (placements.length === 0) return { valid: false, error: "Must place at least 1 card" };
  if (placements.length > 4) return { valid: false, error: "Cannot place more than 4 cards" };
  if (grid.size === 0 && placements.length === 1) return { valid: true };
  for (const { position } of placements) {
    if (grid.has(posKey(position))) return { valid: false, error: `Cell ${posKey(position)} is already occupied` };
  }
  const keys = placements.map((p) => posKey(p.position));
  if (new Set(keys).size !== keys.length) return { valid: false, error: "Duplicate positions in placement" };
  const xs = placements.map((p) => p.position.x);
  const ys = placements.map((p) => p.position.y);
  const sameRow = new Set(ys).size === 1;
  const sameCol = new Set(xs).size === 1;
  if (!sameRow && !sameCol) return { valid: false, error: "All cards must be in the same row or column" };
  const tentative = new Map(grid);
  for (const { card, position } of placements) tentative.set(posKey(position), card);
  const axis = sameRow ? "row" : "col";
  const anyPos = placements[0].position;
  const segment = getSegment(tentative, anyPos, axis);
  for (const { position } of placements) {
    if (!segment.some((p) => p.x === position.x && p.y === position.y))
      return { valid: false, error: "Placement creates a gap" };
  }
  const isAdjacentToExisting = placements.some(
    ({ position: { x, y } }) => [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }].some((p) => grid.has(posKey(p)))
  );
  if (!isAdjacentToExisting) return { valid: false, error: "Must connect to existing cards" };
  const playedPositions = placements.map((p) => p.position);
  if (!wildLinesConsistent(tentative, playedPositions)) {
    return { valid: false, error: "Invalid line or no valid Wild assignment for this placement" };
  }
  return { valid: true };
}
__name(validatePlay, "validatePlay");

// ../engine/src/scorer.ts
function score(grid, newPositions, opts = {}) {
  const newKeys = new Set(newPositions.map(posKey));
  const cardsPlayed = opts.cardsPlayedThisTurn ?? newPositions.length;
  const seen = /* @__PURE__ */ new Set();
  const affectedSegments = [];
  for (const pos of newPositions) {
    for (const seg of getMaximalSegments(grid, pos)) {
      if (!seg.some((p) => newKeys.has(posKey(p)))) continue;
      const segKey = seg.map(posKey).sort().join("|");
      if (!seen.has(segKey)) {
        seen.add(segKey);
        affectedSegments.push(seg);
      }
    }
  }
  let base = 0;
  let lots = 0;
  for (const seg of affectedSegments) {
    for (const pos of seg) {
      const card = grid.get(posKey(pos));
      if (!card) continue;
      base += card.kind === "regular" ? card.number : 0;
    }
    if (seg.length === 4) lots++;
  }
  let multiplier = 1;
  multiplier *= Math.pow(2, lots);
  if (cardsPlayed === 4) multiplier *= 2;
  if (opts.gameEnding) multiplier *= 2;
  return {
    base,
    multiplier,
    total: base * multiplier,
    affectedLines: affectedSegments.map((seg) => ({
      positions: seg,
      cards: seg.map((p) => grid.get(posKey(p)))
    }))
  };
}
__name(score, "score");

// ../engine/src/wildRecycle.ts
function validateWildRecycle(grid, wildPosition, replacement) {
  const existing = grid.get(posKey(wildPosition));
  if (!existing || existing.kind !== "wild") return false;
  const tentative = new Map(grid);
  tentative.set(posKey(wildPosition), replacement);
  return wildLinesConsistent(tentative, [wildPosition]);
}
__name(validateWildRecycle, "validateWildRecycle");

// ../engine/src/gameLoop.ts
function cardsMatch(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.kind === "wild") return true;
  const bR = b;
  return a.color === bR.color && a.shape === bR.shape && a.number === bR.number;
}
__name(cardsMatch, "cardsMatch");
function handContains(hand, need) {
  const remaining = [...hand];
  for (const card of need) {
    const idx = remaining.findIndex((h) => cardsMatch(h, card));
    if (idx === -1) return false;
    remaining.splice(idx, 1);
  }
  return true;
}
__name(handContains, "handContains");
function isPermutation(trades, order) {
  if (trades.length !== order.length) return false;
  const remaining = [...trades];
  for (const card of order) {
    const idx = remaining.findIndex((t) => cardsMatch(t, card));
    if (idx === -1) return false;
    remaining.splice(idx, 1);
  }
  return true;
}
__name(isPermutation, "isPermutation");
function initGame(playerCount) {
  if (playerCount < 2 || playerCount > 4) throw new Error("playerCount must be 2\u20134");
  const deck = shuffle(createDeck());
  const pile = [...deck];
  let starterCard = pile.shift();
  while (starterCard.kind === "wild") {
    const idx = Math.floor(Math.random() * (pile.length + 1));
    pile.splice(idx, 0, starterCard);
    starterCard = pile.shift();
  }
  const grid = /* @__PURE__ */ new Map();
  grid.set(posKey({ x: 0, y: 0 }), starterCard);
  const playedCards = starterCard.kind === "regular" ? [starterCard] : [];
  const hands = [];
  for (let i = 0; i < playerCount; i++) {
    hands.push(pile.splice(0, 4));
  }
  return {
    grid,
    hands,
    drawPile: pile,
    scores: Array.from({ length: playerCount }, () => 0),
    turnIndex: 0,
    playedCards,
    consecutivePasses: 0,
    finished: false
  };
}
__name(initGame, "initGame");
function applyWildRecycle(state, playerIndex, wildPosition, replacement) {
  if (state.finished) return { error: "Game is over" };
  if (state.turnIndex !== playerIndex) return { error: "Not your turn" };
  if (!handContains(state.hands[playerIndex], [replacement])) return { error: "Replacement card not in hand" };
  if (!validateWildRecycle(state.grid, wildPosition, replacement)) return { error: "Invalid wild recycle" };
  const newGrid = new Map(state.grid);
  newGrid.set(posKey(wildPosition), replacement);
  const newHand = [...state.hands[playerIndex]];
  const replIdx = newHand.findIndex((c) => cardsMatch(c, replacement));
  newHand.splice(replIdx, 1);
  newHand.push({ kind: "wild" });
  const newHands = state.hands.map((h, i) => i === playerIndex ? newHand : h);
  return {
    newState: { ...state, grid: newGrid, hands: newHands }
  };
}
__name(applyWildRecycle, "applyWildRecycle");
function applyPlay(state, playerIndex, placements) {
  if (state.finished) return { error: "Game is over" };
  if (state.turnIndex !== playerIndex) return { error: "Not your turn" };
  if (placements.length === 0) return { error: "Must place at least 1 card" };
  const hand = state.hands[playerIndex];
  const playedCards = placements.map((p) => p.card);
  if (!handContains(hand, playedCards)) return { error: "Played cards not all in hand" };
  const validation = validatePlay(state.grid, placements);
  if (!validation.valid) return { error: validation.error };
  const newGrid = new Map(state.grid);
  for (const { card, position } of placements) newGrid.set(posKey(position), card);
  const gameEnding = state.drawPile.length === 0 && placements.length === hand.length;
  const scoreResult = score(newGrid, placements.map((p) => p.position), {
    cardsPlayedThisTurn: placements.length,
    gameEnding
  });
  let newHand = [...hand];
  for (const card of playedCards) {
    const idx = newHand.findIndex((c) => cardsMatch(c, card));
    newHand.splice(idx, 1);
  }
  const newPile = [...state.drawPile];
  const draws = newPile.splice(0, placements.length);
  newHand = [...newHand, ...draws];
  const newPlayedCards = [
    ...state.playedCards,
    ...playedCards.filter((c) => c.kind === "regular")
  ];
  const newScores = state.scores.map((s, i) => i === playerIndex ? s + scoreResult.total : s);
  const newHands = state.hands.map((h, i) => i === playerIndex ? newHand : h);
  const playerCount = state.hands.length;
  const newTurnIndex = gameEnding ? state.turnIndex : (state.turnIndex + 1) % playerCount;
  return {
    newState: {
      ...state,
      grid: newGrid,
      hands: newHands,
      drawPile: newPile,
      scores: newScores,
      turnIndex: newTurnIndex,
      playedCards: newPlayedCards,
      consecutivePasses: 0,
      // a play breaks any pass streak
      finished: gameEnding
    },
    scoreResult,
    gameOver: gameEnding
  };
}
__name(applyPlay, "applyPlay");
var STALEMATE_PASS_ROUNDS = 3;
function applyPass(state, playerIndex, trades, tradeOrder) {
  if (state.finished) return { error: "Game is over" };
  if (state.turnIndex !== playerIndex) return { error: "Not your turn" };
  if (trades.length > 4) return { error: "Cannot trade more than 4 cards" };
  if (!handContains(state.hands[playerIndex], trades)) return { error: "Trade cards not all in hand" };
  if (!isPermutation(trades, tradeOrder)) return { error: "tradeOrder must be a reordering of the traded cards" };
  let newHand = [...state.hands[playerIndex]];
  for (const card of trades) {
    const idx = newHand.findIndex((c) => cardsMatch(c, card));
    newHand.splice(idx, 1);
  }
  const newPile = [...state.drawPile, ...tradeOrder];
  const draws = newPile.splice(0, trades.length);
  newHand = [...newHand, ...draws];
  const playerCount = state.hands.length;
  const newTurnIndex = (state.turnIndex + 1) % playerCount;
  const newHands = state.hands.map((h, i) => i === playerIndex ? newHand : h);
  const consecutivePasses = (state.consecutivePasses ?? 0) + 1;
  const gameOver = consecutivePasses >= STALEMATE_PASS_ROUNDS * playerCount;
  return {
    newState: {
      ...state,
      hands: newHands,
      drawPile: newPile,
      turnIndex: newTurnIndex,
      consecutivePasses,
      finished: gameOver
    },
    gameOver
  };
}
__name(applyPass, "applyPass");

// ../engine/src/ai/easy.ts
function candidatePlacements(grid, hand) {
  const adjacent = /* @__PURE__ */ new Set();
  for (const key of grid.keys()) {
    const [x, y] = key.split(",").map(Number);
    for (const pos of [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }]) {
      if (!grid.has(posKey(pos))) adjacent.add(posKey(pos));
    }
  }
  const results = [];
  for (const card of hand) {
    for (const key of adjacent) {
      const [x, y] = key.split(",").map(Number);
      const placement = { card, position: { x, y } };
      results.push([placement]);
    }
  }
  return results;
}
__name(candidatePlacements, "candidatePlacements");
function easyMove(state, playerIndex) {
  const hand = state.hands[playerIndex];
  const candidates = candidatePlacements(state.grid, hand);
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  for (const placements of shuffled) {
    if (validatePlay(state.grid, placements).valid) {
      return { type: "play", placements };
    }
  }
  return { type: "pass", trades: hand, tradeOrder: [...hand].reverse() };
}
__name(easyMove, "easyMove");

// ../engine/src/ai/medium.ts
function allSinglePlacements(state, playerIndex) {
  const hand = state.hands[playerIndex];
  const grid = state.grid;
  const adjacent = /* @__PURE__ */ new Set();
  for (const key of grid.keys()) {
    const [x, y] = key.split(",").map(Number);
    for (const pos of [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }]) {
      if (!grid.has(posKey(pos))) adjacent.add(posKey(pos));
    }
  }
  const results = [];
  for (const card of hand) {
    for (const key of adjacent) {
      const [x, y] = key.split(",").map(Number);
      results.push([{ card, position: { x, y } }]);
    }
  }
  return results;
}
__name(allSinglePlacements, "allSinglePlacements");
function mediumMove(state, playerIndex) {
  const candidates = allSinglePlacements(state, playerIndex);
  let bestMove = null;
  let bestScore = -1;
  for (const placements of candidates) {
    if (!validatePlay(state.grid, placements).valid) continue;
    const tentative = new Map(state.grid);
    for (const { card, position } of placements) tentative.set(posKey(position), card);
    const s = score(tentative, placements.map((p) => p.position), {
      cardsPlayedThisTurn: placements.length
    });
    if (s.total > bestScore) {
      bestScore = s.total;
      bestMove = { type: "play", placements };
    }
  }
  if (bestMove) return bestMove;
  return easyMove(state, playerIndex);
}
__name(mediumMove, "mediumMove");

// ../engine/src/ai/hard.ts
function allSinglePlacements2(state, playerIndex) {
  const hand = state.hands[playerIndex];
  const grid = state.grid;
  const adjacent = /* @__PURE__ */ new Set();
  for (const key of grid.keys()) {
    const [x, y] = key.split(",").map(Number);
    for (const pos of [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }]) {
      if (!grid.has(posKey(pos))) adjacent.add(posKey(pos));
    }
  }
  const results = [];
  for (const card of hand) {
    for (const key of adjacent) {
      const [x, y] = key.split(",").map(Number);
      results.push([{ card, position: { x, y } }]);
    }
  }
  return results;
}
__name(allSinglePlacements2, "allSinglePlacements");
function opponentLotSetupPenalty(tentativeGrid) {
  let penalty = 0;
  for (const key of tentativeGrid.keys()) {
    const pos = { x: +key.split(",")[0], y: +key.split(",")[1] };
    for (const seg of getMaximalSegments(tentativeGrid, pos)) {
      if (seg.length === 3) penalty += 5;
    }
  }
  return penalty;
}
__name(opponentLotSetupPenalty, "opponentLotSetupPenalty");
function hardMove(state, playerIndex) {
  const candidates = allSinglePlacements2(state, playerIndex);
  let bestMove = null;
  let bestNet = -Infinity;
  for (const placements of candidates) {
    if (!validatePlay(state.grid, placements).valid) continue;
    const tentative = new Map(state.grid);
    for (const { card, position } of placements) tentative.set(posKey(position), card);
    const s = score(tentative, placements.map((p) => p.position), {
      cardsPlayedThisTurn: placements.length
    });
    const penalty = state.drawPile.length > 0 ? opponentLotSetupPenalty(tentative) : 0;
    const net = s.total - penalty;
    if (net > bestNet) {
      bestNet = net;
      bestMove = { type: "play", placements };
    }
  }
  return bestMove ?? mediumMove(state, playerIndex);
}
__name(hardMove, "hardMove");

// ../engine/src/ai/expert.ts
function allSinglePlacements3(state, playerIndex) {
  const hand = state.hands[playerIndex];
  const grid = state.grid;
  const adjacent = /* @__PURE__ */ new Set();
  for (const key of grid.keys()) {
    const [x, y] = key.split(",").map(Number);
    for (const pos of [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }]) {
      if (!grid.has(posKey(pos))) adjacent.add(posKey(pos));
    }
  }
  const results = [];
  for (const card of hand) {
    for (const key of adjacent) {
      const [x, y] = key.split(",").map(Number);
      results.push([{ card, position: { x, y } }]);
    }
  }
  return results;
}
__name(allSinglePlacements3, "allSinglePlacements");
function inferOpponentCandidates(state, playerIndex) {
  const ownHand = new Set(
    state.hands[playerIndex].filter((c) => c.kind === "regular").map((c) => `${c.color}-${c.shape}-${c.number}`)
  );
  const played = new Set(
    state.playedCards.map((c) => `${c.color}-${c.shape}-${c.number}`)
  );
  const allRegulars = [];
  for (const color of ["blue", "red", "yellow", "green"])
    for (const shape of ["triangle", "plus", "square", "circle"])
      for (const number of [1, 2, 3, 4])
        if (!ownHand.has(`${color}-${shape}-${number}`) && !played.has(`${color}-${shape}-${number}`))
          allRegulars.push({ kind: "regular", color, shape, number });
  return allRegulars;
}
__name(inferOpponentCandidates, "inferOpponentCandidates");
function estimateOpponentBestScore(tentativeGrid, opponentCandidates) {
  const adjacent = /* @__PURE__ */ new Set();
  for (const key of tentativeGrid.keys()) {
    const [x, y] = key.split(",").map(Number);
    for (const pos of [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }]) {
      if (!tentativeGrid.has(posKey(pos))) adjacent.add(posKey(pos));
    }
  }
  let best = 0;
  const sample = opponentCandidates.slice(0, 16);
  for (const card of sample) {
    for (const key of adjacent) {
      const [x, y] = key.split(",").map(Number);
      const pos = { x, y };
      const placements = [{ card, position: pos }];
      if (!validatePlay(tentativeGrid, placements).valid) continue;
      const tentative2 = new Map(tentativeGrid);
      tentative2.set(posKey(pos), card);
      const s = score(tentative2, [pos], { cardsPlayedThisTurn: 1 });
      if (s.total > best) best = s.total;
    }
  }
  return best;
}
__name(estimateOpponentBestScore, "estimateOpponentBestScore");
function expertMove(state, playerIndex) {
  const candidates = allSinglePlacements3(state, playerIndex);
  const opponentCandidates = inferOpponentCandidates(state, playerIndex);
  let bestMove = null;
  let bestNet = -Infinity;
  for (const placements of candidates) {
    if (!validatePlay(state.grid, placements).valid) continue;
    const tentative = new Map(state.grid);
    for (const { card, position } of placements) tentative.set(posKey(position), card);
    const myScore = score(tentative, placements.map((p) => p.position), {
      cardsPlayedThisTurn: placements.length
    }).total;
    const opponentBest = state.drawPile.length > 0 ? estimateOpponentBestScore(tentative, opponentCandidates) : 0;
    const net = myScore - opponentBest;
    if (net > bestNet) {
      bestNet = net;
      bestMove = { type: "play", placements };
    }
  }
  return bestMove ?? hardMove(state, playerIndex);
}
__name(expertMove, "expertMove");

// ../engine/src/ai/index.ts
function AIAgent(difficulty) {
  switch (difficulty) {
    case "easy":
      return easyMove;
    case "medium":
      return mediumMove;
    case "hard":
      return hardMove;
    case "expert":
      return expertMove;
  }
}
__name(AIAgent, "AIAgent");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/buffer_utils.js
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var MAX_INT32 = 2 ** 32;
function concat(...buffers) {
  const size = buffers.reduce((acc, { length }) => acc + length, 0);
  const buf = new Uint8Array(size);
  let i = 0;
  for (const buffer of buffers) {
    buf.set(buffer, i);
    i += buffer.length;
  }
  return buf;
}
__name(concat, "concat");
function encode(string) {
  const bytes = new Uint8Array(string.length);
  for (let i = 0; i < string.length; i++) {
    const code = string.charCodeAt(i);
    if (code > 127) {
      throw new TypeError("non-ASCII string encountered in encode()");
    }
    bytes[i] = code;
  }
  return bytes;
}
__name(encode, "encode");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/base64.js
function encodeBase64(input) {
  if (Uint8Array.prototype.toBase64) {
    return input.toBase64();
  }
  const CHUNK_SIZE = 32768;
  const arr = [];
  for (let i = 0; i < input.length; i += CHUNK_SIZE) {
    arr.push(String.fromCharCode.apply(null, input.subarray(i, i + CHUNK_SIZE)));
  }
  return btoa(arr.join(""));
}
__name(encodeBase64, "encodeBase64");
function decodeBase64(encoded) {
  if (Uint8Array.fromBase64) {
    return Uint8Array.fromBase64(encoded);
  }
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
__name(decodeBase64, "decodeBase64");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/util/base64url.js
function decode(input) {
  if (Uint8Array.fromBase64) {
    return Uint8Array.fromBase64(typeof input === "string" ? input : decoder.decode(input), {
      alphabet: "base64url"
    });
  }
  let encoded = input;
  if (encoded instanceof Uint8Array) {
    encoded = decoder.decode(encoded);
  }
  encoded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return decodeBase64(encoded);
  } catch {
    throw new TypeError("The input to be decoded is not correctly encoded.");
  }
}
__name(decode, "decode");
function encode2(input) {
  let unencoded = input;
  if (typeof unencoded === "string") {
    unencoded = encoder.encode(unencoded);
  }
  if (Uint8Array.prototype.toBase64) {
    return unencoded.toBase64({ alphabet: "base64url", omitPadding: true });
  }
  return encodeBase64(unencoded).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
__name(encode2, "encode");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/crypto_key.js
var unusable = /* @__PURE__ */ __name((name, prop = "algorithm.name") => new TypeError(`CryptoKey does not support this operation, its ${prop} must be ${name}`), "unusable");
var isAlgorithm = /* @__PURE__ */ __name((algorithm, name) => algorithm.name === name, "isAlgorithm");
function getHashLength(hash) {
  return parseInt(hash.name.slice(4), 10);
}
__name(getHashLength, "getHashLength");
function checkHashLength(algorithm, expected) {
  const actual = getHashLength(algorithm.hash);
  if (actual !== expected)
    throw unusable(`SHA-${expected}`, "algorithm.hash");
}
__name(checkHashLength, "checkHashLength");
function getNamedCurve(alg) {
  switch (alg) {
    case "ES256":
      return "P-256";
    case "ES384":
      return "P-384";
    case "ES512":
      return "P-521";
    default:
      throw new Error("unreachable");
  }
}
__name(getNamedCurve, "getNamedCurve");
function checkUsage(key, usage) {
  if (usage && !key.usages.includes(usage)) {
    throw new TypeError(`CryptoKey does not support this operation, its usages must include ${usage}.`);
  }
}
__name(checkUsage, "checkUsage");
function checkSigCryptoKey(key, alg, usage) {
  switch (alg) {
    case "HS256":
    case "HS384":
    case "HS512": {
      if (!isAlgorithm(key.algorithm, "HMAC"))
        throw unusable("HMAC");
      checkHashLength(key.algorithm, parseInt(alg.slice(2), 10));
      break;
    }
    case "RS256":
    case "RS384":
    case "RS512": {
      if (!isAlgorithm(key.algorithm, "RSASSA-PKCS1-v1_5"))
        throw unusable("RSASSA-PKCS1-v1_5");
      checkHashLength(key.algorithm, parseInt(alg.slice(2), 10));
      break;
    }
    case "PS256":
    case "PS384":
    case "PS512": {
      if (!isAlgorithm(key.algorithm, "RSA-PSS"))
        throw unusable("RSA-PSS");
      checkHashLength(key.algorithm, parseInt(alg.slice(2), 10));
      break;
    }
    case "Ed25519":
    case "EdDSA": {
      if (!isAlgorithm(key.algorithm, "Ed25519"))
        throw unusable("Ed25519");
      break;
    }
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87": {
      if (!isAlgorithm(key.algorithm, alg))
        throw unusable(alg);
      break;
    }
    case "ES256":
    case "ES384":
    case "ES512": {
      if (!isAlgorithm(key.algorithm, "ECDSA"))
        throw unusable("ECDSA");
      const expected = getNamedCurve(alg);
      const actual = key.algorithm.namedCurve;
      if (actual !== expected)
        throw unusable(expected, "algorithm.namedCurve");
      break;
    }
    default:
      throw new TypeError("CryptoKey does not support this operation");
  }
  checkUsage(key, usage);
}
__name(checkSigCryptoKey, "checkSigCryptoKey");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/invalid_key_input.js
function message(msg, actual, ...types) {
  types = types.filter(Boolean);
  if (types.length > 2) {
    const last = types.pop();
    msg += `one of type ${types.join(", ")}, or ${last}.`;
  } else if (types.length === 2) {
    msg += `one of type ${types[0]} or ${types[1]}.`;
  } else {
    msg += `of type ${types[0]}.`;
  }
  if (actual == null) {
    msg += ` Received ${actual}`;
  } else if (typeof actual === "function" && actual.name) {
    msg += ` Received function ${actual.name}`;
  } else if (typeof actual === "object" && actual != null) {
    if (actual.constructor?.name) {
      msg += ` Received an instance of ${actual.constructor.name}`;
    }
  }
  return msg;
}
__name(message, "message");
var invalidKeyInput = /* @__PURE__ */ __name((actual, ...types) => message("Key must be ", actual, ...types), "invalidKeyInput");
var withAlg = /* @__PURE__ */ __name((alg, actual, ...types) => message(`Key for the ${alg} algorithm must be `, actual, ...types), "withAlg");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/util/errors.js
var JOSEError = class extends Error {
  static {
    __name(this, "JOSEError");
  }
  static code = "ERR_JOSE_GENERIC";
  code = "ERR_JOSE_GENERIC";
  constructor(message2, options) {
    super(message2, options);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
};
var JWTClaimValidationFailed = class extends JOSEError {
  static {
    __name(this, "JWTClaimValidationFailed");
  }
  static code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } });
    this.claim = claim;
    this.reason = reason;
    this.payload = payload;
  }
};
var JWTExpired = class extends JOSEError {
  static {
    __name(this, "JWTExpired");
  }
  static code = "ERR_JWT_EXPIRED";
  code = "ERR_JWT_EXPIRED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } });
    this.claim = claim;
    this.reason = reason;
    this.payload = payload;
  }
};
var JOSEAlgNotAllowed = class extends JOSEError {
  static {
    __name(this, "JOSEAlgNotAllowed");
  }
  static code = "ERR_JOSE_ALG_NOT_ALLOWED";
  code = "ERR_JOSE_ALG_NOT_ALLOWED";
};
var JOSENotSupported = class extends JOSEError {
  static {
    __name(this, "JOSENotSupported");
  }
  static code = "ERR_JOSE_NOT_SUPPORTED";
  code = "ERR_JOSE_NOT_SUPPORTED";
};
var JWSInvalid = class extends JOSEError {
  static {
    __name(this, "JWSInvalid");
  }
  static code = "ERR_JWS_INVALID";
  code = "ERR_JWS_INVALID";
};
var JWTInvalid = class extends JOSEError {
  static {
    __name(this, "JWTInvalid");
  }
  static code = "ERR_JWT_INVALID";
  code = "ERR_JWT_INVALID";
};
var JWSSignatureVerificationFailed = class extends JOSEError {
  static {
    __name(this, "JWSSignatureVerificationFailed");
  }
  static code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  constructor(message2 = "signature verification failed", options) {
    super(message2, options);
  }
};

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/is_key_like.js
var isCryptoKey = /* @__PURE__ */ __name((key) => {
  if (key?.[Symbol.toStringTag] === "CryptoKey")
    return true;
  try {
    return key instanceof CryptoKey;
  } catch {
    return false;
  }
}, "isCryptoKey");
var isKeyObject = /* @__PURE__ */ __name((key) => key?.[Symbol.toStringTag] === "KeyObject", "isKeyObject");
var isKeyLike = /* @__PURE__ */ __name((key) => isCryptoKey(key) || isKeyObject(key), "isKeyLike");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/helpers.js
function assertNotSet(value, name) {
  if (value) {
    throw new TypeError(`${name} can only be called once`);
  }
}
__name(assertNotSet, "assertNotSet");
function decodeBase64url(value, label, ErrorClass) {
  try {
    return decode(value);
  } catch {
    throw new ErrorClass(`Failed to base64url decode the ${label}`);
  }
}
__name(decodeBase64url, "decodeBase64url");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/type_checks.js
var isObjectLike = /* @__PURE__ */ __name((value) => typeof value === "object" && value !== null, "isObjectLike");
function isObject(input) {
  if (!isObjectLike(input) || Object.prototype.toString.call(input) !== "[object Object]") {
    return false;
  }
  if (Object.getPrototypeOf(input) === null) {
    return true;
  }
  let proto = input;
  while (Object.getPrototypeOf(proto) !== null) {
    proto = Object.getPrototypeOf(proto);
  }
  return Object.getPrototypeOf(input) === proto;
}
__name(isObject, "isObject");
function isDisjoint(...headers) {
  const sources = headers.filter(Boolean);
  if (sources.length === 0 || sources.length === 1) {
    return true;
  }
  let acc;
  for (const header of sources) {
    const parameters = Object.keys(header);
    if (!acc || acc.size === 0) {
      acc = new Set(parameters);
      continue;
    }
    for (const parameter of parameters) {
      if (acc.has(parameter)) {
        return false;
      }
      acc.add(parameter);
    }
  }
  return true;
}
__name(isDisjoint, "isDisjoint");
var isJWK = /* @__PURE__ */ __name((key) => isObject(key) && typeof key.kty === "string", "isJWK");
var isPrivateJWK = /* @__PURE__ */ __name((key) => key.kty !== "oct" && (key.kty === "AKP" && typeof key.priv === "string" || typeof key.d === "string"), "isPrivateJWK");
var isPublicJWK = /* @__PURE__ */ __name((key) => key.kty !== "oct" && key.d === void 0 && key.priv === void 0, "isPublicJWK");
var isSecretJWK = /* @__PURE__ */ __name((key) => key.kty === "oct" && typeof key.k === "string", "isSecretJWK");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/signing.js
function checkKeyLength(alg, key) {
  if (alg.startsWith("RS") || alg.startsWith("PS")) {
    const { modulusLength } = key.algorithm;
    if (typeof modulusLength !== "number" || modulusLength < 2048) {
      throw new TypeError(`${alg} requires key modulusLength to be 2048 bits or larger`);
    }
  }
}
__name(checkKeyLength, "checkKeyLength");
function subtleAlgorithm(alg, algorithm) {
  const hash = `SHA-${alg.slice(-3)}`;
  switch (alg) {
    case "HS256":
    case "HS384":
    case "HS512":
      return { hash, name: "HMAC" };
    case "PS256":
    case "PS384":
    case "PS512":
      return { hash, name: "RSA-PSS", saltLength: parseInt(alg.slice(-3), 10) >> 3 };
    case "RS256":
    case "RS384":
    case "RS512":
      return { hash, name: "RSASSA-PKCS1-v1_5" };
    case "ES256":
    case "ES384":
    case "ES512":
      return { hash, name: "ECDSA", namedCurve: algorithm.namedCurve };
    case "Ed25519":
    case "EdDSA":
      return { name: "Ed25519" };
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87":
      return { name: alg };
    default:
      throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  }
}
__name(subtleAlgorithm, "subtleAlgorithm");
async function getSigKey(alg, key, usage) {
  if (key instanceof Uint8Array) {
    if (!alg.startsWith("HS")) {
      throw new TypeError(invalidKeyInput(key, "CryptoKey", "KeyObject", "JSON Web Key"));
    }
    return crypto.subtle.importKey("raw", key, { hash: `SHA-${alg.slice(-3)}`, name: "HMAC" }, false, [usage]);
  }
  checkSigCryptoKey(key, alg, usage);
  return key;
}
__name(getSigKey, "getSigKey");
async function sign(alg, key, data) {
  const cryptoKey = await getSigKey(alg, key, "sign");
  checkKeyLength(alg, cryptoKey);
  const signature = await crypto.subtle.sign(subtleAlgorithm(alg, cryptoKey.algorithm), cryptoKey, data);
  return new Uint8Array(signature);
}
__name(sign, "sign");
async function verify(alg, key, signature, data) {
  const cryptoKey = await getSigKey(alg, key, "verify");
  checkKeyLength(alg, cryptoKey);
  const algorithm = subtleAlgorithm(alg, cryptoKey.algorithm);
  try {
    return await crypto.subtle.verify(algorithm, cryptoKey, signature, data);
  } catch {
    return false;
  }
}
__name(verify, "verify");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/jwk_to_key.js
var unsupportedAlg = 'Invalid or unsupported JWK "alg" (Algorithm) Parameter value';
function subtleMapping(jwk) {
  let algorithm;
  let keyUsages;
  switch (jwk.kty) {
    case "AKP": {
      switch (jwk.alg) {
        case "ML-DSA-44":
        case "ML-DSA-65":
        case "ML-DSA-87":
          algorithm = { name: jwk.alg };
          keyUsages = jwk.priv ? ["sign"] : ["verify"];
          break;
        default:
          throw new JOSENotSupported(unsupportedAlg);
      }
      break;
    }
    case "RSA": {
      switch (jwk.alg) {
        case "PS256":
        case "PS384":
        case "PS512":
          algorithm = { name: "RSA-PSS", hash: `SHA-${jwk.alg.slice(-3)}` };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "RS256":
        case "RS384":
        case "RS512":
          algorithm = { name: "RSASSA-PKCS1-v1_5", hash: `SHA-${jwk.alg.slice(-3)}` };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "RSA-OAEP":
        case "RSA-OAEP-256":
        case "RSA-OAEP-384":
        case "RSA-OAEP-512":
          algorithm = {
            name: "RSA-OAEP",
            hash: `SHA-${parseInt(jwk.alg.slice(-3), 10) || 1}`
          };
          keyUsages = jwk.d ? ["decrypt", "unwrapKey"] : ["encrypt", "wrapKey"];
          break;
        default:
          throw new JOSENotSupported(unsupportedAlg);
      }
      break;
    }
    case "EC": {
      switch (jwk.alg) {
        case "ES256":
        case "ES384":
        case "ES512":
          algorithm = {
            name: "ECDSA",
            namedCurve: { ES256: "P-256", ES384: "P-384", ES512: "P-521" }[jwk.alg]
          };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "ECDH-ES":
        case "ECDH-ES+A128KW":
        case "ECDH-ES+A192KW":
        case "ECDH-ES+A256KW":
          algorithm = { name: "ECDH", namedCurve: jwk.crv };
          keyUsages = jwk.d ? ["deriveBits"] : [];
          break;
        default:
          throw new JOSENotSupported(unsupportedAlg);
      }
      break;
    }
    case "OKP": {
      switch (jwk.alg) {
        case "Ed25519":
        case "EdDSA":
          algorithm = { name: "Ed25519" };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "ECDH-ES":
        case "ECDH-ES+A128KW":
        case "ECDH-ES+A192KW":
        case "ECDH-ES+A256KW":
          algorithm = { name: jwk.crv };
          keyUsages = jwk.d ? ["deriveBits"] : [];
          break;
        default:
          throw new JOSENotSupported(unsupportedAlg);
      }
      break;
    }
    default:
      throw new JOSENotSupported('Invalid or unsupported JWK "kty" (Key Type) Parameter value');
  }
  return { algorithm, keyUsages };
}
__name(subtleMapping, "subtleMapping");
async function jwkToKey(jwk) {
  if (!jwk.alg) {
    throw new TypeError('"alg" argument is required when "jwk.alg" is not present');
  }
  const { algorithm, keyUsages } = subtleMapping(jwk);
  const keyData = { ...jwk };
  if (keyData.kty !== "AKP") {
    delete keyData.alg;
  }
  delete keyData.use;
  return crypto.subtle.importKey("jwk", keyData, algorithm, jwk.ext ?? (jwk.d || jwk.priv ? false : true), jwk.key_ops ?? keyUsages);
}
__name(jwkToKey, "jwkToKey");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/normalize_key.js
var unusableForAlg = "given KeyObject instance cannot be used for this algorithm";
var cache;
var handleJWK = /* @__PURE__ */ __name(async (key, jwk, alg, freeze = false) => {
  cache ||= /* @__PURE__ */ new WeakMap();
  let cached = cache.get(key);
  if (cached?.[alg]) {
    return cached[alg];
  }
  const cryptoKey = await jwkToKey({ ...jwk, alg });
  if (freeze)
    Object.freeze(key);
  if (!cached) {
    cache.set(key, { [alg]: cryptoKey });
  } else {
    cached[alg] = cryptoKey;
  }
  return cryptoKey;
}, "handleJWK");
var handleKeyObject = /* @__PURE__ */ __name((keyObject, alg) => {
  cache ||= /* @__PURE__ */ new WeakMap();
  let cached = cache.get(keyObject);
  if (cached?.[alg]) {
    return cached[alg];
  }
  const isPublic = keyObject.type === "public";
  const extractable = isPublic ? true : false;
  let cryptoKey;
  if (keyObject.asymmetricKeyType === "x25519") {
    switch (alg) {
      case "ECDH-ES":
      case "ECDH-ES+A128KW":
      case "ECDH-ES+A192KW":
      case "ECDH-ES+A256KW":
        break;
      default:
        throw new TypeError(unusableForAlg);
    }
    cryptoKey = keyObject.toCryptoKey(keyObject.asymmetricKeyType, extractable, isPublic ? [] : ["deriveBits"]);
  }
  if (keyObject.asymmetricKeyType === "ed25519") {
    if (alg !== "EdDSA" && alg !== "Ed25519") {
      throw new TypeError(unusableForAlg);
    }
    cryptoKey = keyObject.toCryptoKey(keyObject.asymmetricKeyType, extractable, [
      isPublic ? "verify" : "sign"
    ]);
  }
  switch (keyObject.asymmetricKeyType) {
    case "ml-dsa-44":
    case "ml-dsa-65":
    case "ml-dsa-87": {
      if (alg !== keyObject.asymmetricKeyType.toUpperCase()) {
        throw new TypeError(unusableForAlg);
      }
      cryptoKey = keyObject.toCryptoKey(keyObject.asymmetricKeyType, extractable, [
        isPublic ? "verify" : "sign"
      ]);
    }
  }
  if (keyObject.asymmetricKeyType === "rsa") {
    let hash;
    switch (alg) {
      case "RSA-OAEP":
        hash = "SHA-1";
        break;
      case "RS256":
      case "PS256":
      case "RSA-OAEP-256":
        hash = "SHA-256";
        break;
      case "RS384":
      case "PS384":
      case "RSA-OAEP-384":
        hash = "SHA-384";
        break;
      case "RS512":
      case "PS512":
      case "RSA-OAEP-512":
        hash = "SHA-512";
        break;
      default:
        throw new TypeError(unusableForAlg);
    }
    if (alg.startsWith("RSA-OAEP")) {
      return keyObject.toCryptoKey({
        name: "RSA-OAEP",
        hash
      }, extractable, isPublic ? ["encrypt"] : ["decrypt"]);
    }
    cryptoKey = keyObject.toCryptoKey({
      name: alg.startsWith("PS") ? "RSA-PSS" : "RSASSA-PKCS1-v1_5",
      hash
    }, extractable, [isPublic ? "verify" : "sign"]);
  }
  if (keyObject.asymmetricKeyType === "ec") {
    const nist = /* @__PURE__ */ new Map([
      ["prime256v1", "P-256"],
      ["secp384r1", "P-384"],
      ["secp521r1", "P-521"]
    ]);
    const namedCurve = nist.get(keyObject.asymmetricKeyDetails?.namedCurve);
    if (!namedCurve) {
      throw new TypeError(unusableForAlg);
    }
    const expectedCurve = { ES256: "P-256", ES384: "P-384", ES512: "P-521" };
    if (expectedCurve[alg] && namedCurve === expectedCurve[alg]) {
      cryptoKey = keyObject.toCryptoKey({
        name: "ECDSA",
        namedCurve
      }, extractable, [isPublic ? "verify" : "sign"]);
    }
    if (alg.startsWith("ECDH-ES")) {
      cryptoKey = keyObject.toCryptoKey({
        name: "ECDH",
        namedCurve
      }, extractable, isPublic ? [] : ["deriveBits"]);
    }
  }
  if (!cryptoKey) {
    throw new TypeError(unusableForAlg);
  }
  if (!cached) {
    cache.set(keyObject, { [alg]: cryptoKey });
  } else {
    cached[alg] = cryptoKey;
  }
  return cryptoKey;
}, "handleKeyObject");
async function normalizeKey(key, alg) {
  if (key instanceof Uint8Array) {
    return key;
  }
  if (isCryptoKey(key)) {
    return key;
  }
  if (isKeyObject(key)) {
    if (key.type === "secret") {
      return key.export();
    }
    if ("toCryptoKey" in key && typeof key.toCryptoKey === "function") {
      try {
        return handleKeyObject(key, alg);
      } catch (err2) {
        if (err2 instanceof TypeError) {
          throw err2;
        }
      }
    }
    let jwk = key.export({ format: "jwk" });
    return handleJWK(key, jwk, alg);
  }
  if (isJWK(key)) {
    if (key.k) {
      return decode(key.k);
    }
    return handleJWK(key, key, alg, true);
  }
  throw new Error("unreachable");
}
__name(normalizeKey, "normalizeKey");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/validate_crit.js
function validateCrit(Err, recognizedDefault, recognizedOption, protectedHeader, joseHeader) {
  if (joseHeader.crit !== void 0 && protectedHeader?.crit === void 0) {
    throw new Err('"crit" (Critical) Header Parameter MUST be integrity protected');
  }
  if (!protectedHeader || protectedHeader.crit === void 0) {
    return /* @__PURE__ */ new Set();
  }
  if (!Array.isArray(protectedHeader.crit) || protectedHeader.crit.length === 0 || protectedHeader.crit.some((input) => typeof input !== "string" || input.length === 0)) {
    throw new Err('"crit" (Critical) Header Parameter MUST be an array of non-empty strings when present');
  }
  let recognized;
  if (recognizedOption !== void 0) {
    recognized = new Map([...Object.entries(recognizedOption), ...recognizedDefault.entries()]);
  } else {
    recognized = recognizedDefault;
  }
  for (const parameter of protectedHeader.crit) {
    if (!recognized.has(parameter)) {
      throw new JOSENotSupported(`Extension Header Parameter "${parameter}" is not recognized`);
    }
    if (joseHeader[parameter] === void 0) {
      throw new Err(`Extension Header Parameter "${parameter}" is missing`);
    }
    if (recognized.get(parameter) && protectedHeader[parameter] === void 0) {
      throw new Err(`Extension Header Parameter "${parameter}" MUST be integrity protected`);
    }
  }
  return new Set(protectedHeader.crit);
}
__name(validateCrit, "validateCrit");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/validate_algorithms.js
function validateAlgorithms(option, algorithms) {
  if (algorithms !== void 0 && (!Array.isArray(algorithms) || algorithms.some((s) => typeof s !== "string"))) {
    throw new TypeError(`"${option}" option must be an array of strings`);
  }
  if (!algorithms) {
    return void 0;
  }
  return new Set(algorithms);
}
__name(validateAlgorithms, "validateAlgorithms");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/check_key_type.js
var tag = /* @__PURE__ */ __name((key) => key?.[Symbol.toStringTag], "tag");
var jwkMatchesOp = /* @__PURE__ */ __name((alg, key, usage) => {
  if (key.use !== void 0) {
    let expected;
    switch (usage) {
      case "sign":
      case "verify":
        expected = "sig";
        break;
      case "encrypt":
      case "decrypt":
        expected = "enc";
        break;
    }
    if (key.use !== expected) {
      throw new TypeError(`Invalid key for this operation, its "use" must be "${expected}" when present`);
    }
  }
  if (key.alg !== void 0 && key.alg !== alg) {
    throw new TypeError(`Invalid key for this operation, its "alg" must be "${alg}" when present`);
  }
  if (Array.isArray(key.key_ops)) {
    let expectedKeyOp;
    switch (true) {
      case (usage === "sign" || usage === "verify"):
      case alg === "dir":
      case alg.includes("CBC-HS"):
        expectedKeyOp = usage;
        break;
      case alg.startsWith("PBES2"):
        expectedKeyOp = "deriveBits";
        break;
      case /^A\d{3}(?:GCM)?(?:KW)?$/.test(alg):
        if (!alg.includes("GCM") && alg.endsWith("KW")) {
          expectedKeyOp = usage === "encrypt" ? "wrapKey" : "unwrapKey";
        } else {
          expectedKeyOp = usage;
        }
        break;
      case (usage === "encrypt" && alg.startsWith("RSA")):
        expectedKeyOp = "wrapKey";
        break;
      case usage === "decrypt":
        expectedKeyOp = alg.startsWith("RSA") ? "unwrapKey" : "deriveBits";
        break;
    }
    if (expectedKeyOp && key.key_ops?.includes?.(expectedKeyOp) === false) {
      throw new TypeError(`Invalid key for this operation, its "key_ops" must include "${expectedKeyOp}" when present`);
    }
  }
  return true;
}, "jwkMatchesOp");
var symmetricTypeCheck = /* @__PURE__ */ __name((alg, key, usage) => {
  if (key instanceof Uint8Array)
    return;
  if (isJWK(key)) {
    if (isSecretJWK(key) && jwkMatchesOp(alg, key, usage))
      return;
    throw new TypeError(`JSON Web Key for symmetric algorithms must have JWK "kty" (Key Type) equal to "oct" and the JWK "k" (Key Value) present`);
  }
  if (!isKeyLike(key)) {
    throw new TypeError(withAlg(alg, key, "CryptoKey", "KeyObject", "JSON Web Key", "Uint8Array"));
  }
  if (key.type !== "secret") {
    throw new TypeError(`${tag(key)} instances for symmetric algorithms must be of type "secret"`);
  }
}, "symmetricTypeCheck");
var asymmetricTypeCheck = /* @__PURE__ */ __name((alg, key, usage) => {
  if (isJWK(key)) {
    switch (usage) {
      case "decrypt":
      case "sign":
        if (isPrivateJWK(key) && jwkMatchesOp(alg, key, usage))
          return;
        throw new TypeError(`JSON Web Key for this operation must be a private JWK`);
      case "encrypt":
      case "verify":
        if (isPublicJWK(key) && jwkMatchesOp(alg, key, usage))
          return;
        throw new TypeError(`JSON Web Key for this operation must be a public JWK`);
    }
  }
  if (!isKeyLike(key)) {
    throw new TypeError(withAlg(alg, key, "CryptoKey", "KeyObject", "JSON Web Key"));
  }
  if (key.type === "secret") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithms must not be of type "secret"`);
  }
  if (key.type === "public") {
    switch (usage) {
      case "sign":
        throw new TypeError(`${tag(key)} instances for asymmetric algorithm signing must be of type "private"`);
      case "decrypt":
        throw new TypeError(`${tag(key)} instances for asymmetric algorithm decryption must be of type "private"`);
    }
  }
  if (key.type === "private") {
    switch (usage) {
      case "verify":
        throw new TypeError(`${tag(key)} instances for asymmetric algorithm verifying must be of type "public"`);
      case "encrypt":
        throw new TypeError(`${tag(key)} instances for asymmetric algorithm encryption must be of type "public"`);
    }
  }
}, "asymmetricTypeCheck");
function checkKeyType(alg, key, usage) {
  switch (alg.substring(0, 2)) {
    case "A1":
    case "A2":
    case "di":
    case "HS":
    case "PB":
      symmetricTypeCheck(alg, key, usage);
      break;
    default:
      asymmetricTypeCheck(alg, key, usage);
  }
}
__name(checkKeyType, "checkKeyType");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/jws/flattened/verify.js
async function flattenedVerify(jws, key, options) {
  if (!isObject(jws)) {
    throw new JWSInvalid("Flattened JWS must be an object");
  }
  if (jws.protected === void 0 && jws.header === void 0) {
    throw new JWSInvalid('Flattened JWS must have either of the "protected" or "header" members');
  }
  if (jws.protected !== void 0 && typeof jws.protected !== "string") {
    throw new JWSInvalid("JWS Protected Header incorrect type");
  }
  if (jws.payload === void 0) {
    throw new JWSInvalid("JWS Payload missing");
  }
  if (typeof jws.signature !== "string") {
    throw new JWSInvalid("JWS Signature missing or incorrect type");
  }
  if (jws.header !== void 0 && !isObject(jws.header)) {
    throw new JWSInvalid("JWS Unprotected Header incorrect type");
  }
  let parsedProt = {};
  if (jws.protected) {
    try {
      const protectedHeader = decode(jws.protected);
      parsedProt = JSON.parse(decoder.decode(protectedHeader));
    } catch {
      throw new JWSInvalid("JWS Protected Header is invalid");
    }
  }
  if (!isDisjoint(parsedProt, jws.header)) {
    throw new JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
  }
  const joseHeader = {
    ...parsedProt,
    ...jws.header
  };
  const extensions = validateCrit(JWSInvalid, /* @__PURE__ */ new Map([["b64", true]]), options?.crit, parsedProt, joseHeader);
  let b64 = true;
  if (extensions.has("b64")) {
    b64 = parsedProt.b64;
    if (typeof b64 !== "boolean") {
      throw new JWSInvalid('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
    }
  }
  const { alg } = joseHeader;
  if (typeof alg !== "string" || !alg) {
    throw new JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
  }
  const algorithms = options && validateAlgorithms("algorithms", options.algorithms);
  if (algorithms && !algorithms.has(alg)) {
    throw new JOSEAlgNotAllowed('"alg" (Algorithm) Header Parameter value not allowed');
  }
  if (b64) {
    if (typeof jws.payload !== "string") {
      throw new JWSInvalid("JWS Payload must be a string");
    }
  } else if (typeof jws.payload !== "string" && !(jws.payload instanceof Uint8Array)) {
    throw new JWSInvalid("JWS Payload must be a string or an Uint8Array instance");
  }
  let resolvedKey = false;
  if (typeof key === "function") {
    key = await key(parsedProt, jws);
    resolvedKey = true;
  }
  checkKeyType(alg, key, "verify");
  const data = concat(jws.protected !== void 0 ? encode(jws.protected) : new Uint8Array(), encode("."), typeof jws.payload === "string" ? b64 ? encode(jws.payload) : encoder.encode(jws.payload) : jws.payload);
  const signature = decodeBase64url(jws.signature, "signature", JWSInvalid);
  const k = await normalizeKey(key, alg);
  const verified = await verify(alg, k, signature, data);
  if (!verified) {
    throw new JWSSignatureVerificationFailed();
  }
  let payload;
  if (b64) {
    payload = decodeBase64url(jws.payload, "payload", JWSInvalid);
  } else if (typeof jws.payload === "string") {
    payload = encoder.encode(jws.payload);
  } else {
    payload = jws.payload;
  }
  const result = { payload };
  if (jws.protected !== void 0) {
    result.protectedHeader = parsedProt;
  }
  if (jws.header !== void 0) {
    result.unprotectedHeader = jws.header;
  }
  if (resolvedKey) {
    return { ...result, key: k };
  }
  return result;
}
__name(flattenedVerify, "flattenedVerify");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/jws/compact/verify.js
async function compactVerify(jws, key, options) {
  if (jws instanceof Uint8Array) {
    jws = decoder.decode(jws);
  }
  if (typeof jws !== "string") {
    throw new JWSInvalid("Compact JWS must be a string or Uint8Array");
  }
  const { 0: protectedHeader, 1: payload, 2: signature, length } = jws.split(".");
  if (length !== 3) {
    throw new JWSInvalid("Invalid Compact JWS");
  }
  const verified = await flattenedVerify({ payload, protected: protectedHeader, signature }, key, options);
  const result = { payload: verified.payload, protectedHeader: verified.protectedHeader };
  if (typeof key === "function") {
    return { ...result, key: verified.key };
  }
  return result;
}
__name(compactVerify, "compactVerify");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/jwt_claims_set.js
var epoch = /* @__PURE__ */ __name((date) => Math.floor(date.getTime() / 1e3), "epoch");
var minute = 60;
var hour = minute * 60;
var day = hour * 24;
var week = day * 7;
var year = day * 365.25;
var REGEX = /^(\+|\-)? ?(\d+|\d+\.\d+) ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)(?: (ago|from now))?$/i;
function secs(str) {
  const matched = REGEX.exec(str);
  if (!matched || matched[4] && matched[1]) {
    throw new TypeError("Invalid time period format");
  }
  const value = parseFloat(matched[2]);
  const unit = matched[3].toLowerCase();
  let numericDate;
  switch (unit) {
    case "sec":
    case "secs":
    case "second":
    case "seconds":
    case "s":
      numericDate = Math.round(value);
      break;
    case "minute":
    case "minutes":
    case "min":
    case "mins":
    case "m":
      numericDate = Math.round(value * minute);
      break;
    case "hour":
    case "hours":
    case "hr":
    case "hrs":
    case "h":
      numericDate = Math.round(value * hour);
      break;
    case "day":
    case "days":
    case "d":
      numericDate = Math.round(value * day);
      break;
    case "week":
    case "weeks":
    case "w":
      numericDate = Math.round(value * week);
      break;
    default:
      numericDate = Math.round(value * year);
      break;
  }
  if (matched[1] === "-" || matched[4] === "ago") {
    return -numericDate;
  }
  return numericDate;
}
__name(secs, "secs");
function validateInput(label, input) {
  if (!Number.isFinite(input)) {
    throw new TypeError(`Invalid ${label} input`);
  }
  return input;
}
__name(validateInput, "validateInput");
var normalizeTyp = /* @__PURE__ */ __name((value) => {
  if (value.includes("/")) {
    return value.toLowerCase();
  }
  return `application/${value.toLowerCase()}`;
}, "normalizeTyp");
var checkAudiencePresence = /* @__PURE__ */ __name((audPayload, audOption) => {
  if (typeof audPayload === "string") {
    return audOption.includes(audPayload);
  }
  if (Array.isArray(audPayload)) {
    return audOption.some(Set.prototype.has.bind(new Set(audPayload)));
  }
  return false;
}, "checkAudiencePresence");
function validateClaimsSet(protectedHeader, encodedPayload, options = {}) {
  let payload;
  try {
    payload = JSON.parse(decoder.decode(encodedPayload));
  } catch {
  }
  if (!isObject(payload)) {
    throw new JWTInvalid("JWT Claims Set must be a top-level JSON object");
  }
  const { typ } = options;
  if (typ && (typeof protectedHeader.typ !== "string" || normalizeTyp(protectedHeader.typ) !== normalizeTyp(typ))) {
    throw new JWTClaimValidationFailed('unexpected "typ" JWT header value', payload, "typ", "check_failed");
  }
  const { requiredClaims = [], issuer, subject, audience, maxTokenAge } = options;
  const presenceCheck = [...requiredClaims];
  if (maxTokenAge !== void 0)
    presenceCheck.push("iat");
  if (audience !== void 0)
    presenceCheck.push("aud");
  if (subject !== void 0)
    presenceCheck.push("sub");
  if (issuer !== void 0)
    presenceCheck.push("iss");
  for (const claim of new Set(presenceCheck.reverse())) {
    if (!(claim in payload)) {
      throw new JWTClaimValidationFailed(`missing required "${claim}" claim`, payload, claim, "missing");
    }
  }
  if (issuer && !(Array.isArray(issuer) ? issuer : [issuer]).includes(payload.iss)) {
    throw new JWTClaimValidationFailed('unexpected "iss" claim value', payload, "iss", "check_failed");
  }
  if (subject && payload.sub !== subject) {
    throw new JWTClaimValidationFailed('unexpected "sub" claim value', payload, "sub", "check_failed");
  }
  if (audience && !checkAudiencePresence(payload.aud, typeof audience === "string" ? [audience] : audience)) {
    throw new JWTClaimValidationFailed('unexpected "aud" claim value', payload, "aud", "check_failed");
  }
  let tolerance;
  switch (typeof options.clockTolerance) {
    case "string":
      tolerance = secs(options.clockTolerance);
      break;
    case "number":
      tolerance = options.clockTolerance;
      break;
    case "undefined":
      tolerance = 0;
      break;
    default:
      throw new TypeError("Invalid clockTolerance option type");
  }
  const { currentDate } = options;
  const now = epoch(currentDate || /* @__PURE__ */ new Date());
  if ((payload.iat !== void 0 || maxTokenAge) && typeof payload.iat !== "number") {
    throw new JWTClaimValidationFailed('"iat" claim must be a number', payload, "iat", "invalid");
  }
  if (payload.nbf !== void 0) {
    if (typeof payload.nbf !== "number") {
      throw new JWTClaimValidationFailed('"nbf" claim must be a number', payload, "nbf", "invalid");
    }
    if (payload.nbf > now + tolerance) {
      throw new JWTClaimValidationFailed('"nbf" claim timestamp check failed', payload, "nbf", "check_failed");
    }
  }
  if (payload.exp !== void 0) {
    if (typeof payload.exp !== "number") {
      throw new JWTClaimValidationFailed('"exp" claim must be a number', payload, "exp", "invalid");
    }
    if (payload.exp <= now - tolerance) {
      throw new JWTExpired('"exp" claim timestamp check failed', payload, "exp", "check_failed");
    }
  }
  if (maxTokenAge) {
    const age = now - payload.iat;
    const max = typeof maxTokenAge === "number" ? maxTokenAge : secs(maxTokenAge);
    if (age - tolerance > max) {
      throw new JWTExpired('"iat" claim timestamp check failed (too far in the past)', payload, "iat", "check_failed");
    }
    if (age < 0 - tolerance) {
      throw new JWTClaimValidationFailed('"iat" claim timestamp check failed (it should be in the past)', payload, "iat", "check_failed");
    }
  }
  return payload;
}
__name(validateClaimsSet, "validateClaimsSet");
var JWTClaimsBuilder = class {
  static {
    __name(this, "JWTClaimsBuilder");
  }
  #payload;
  constructor(payload) {
    if (!isObject(payload)) {
      throw new TypeError("JWT Claims Set MUST be an object");
    }
    this.#payload = structuredClone(payload);
  }
  data() {
    return encoder.encode(JSON.stringify(this.#payload));
  }
  get iss() {
    return this.#payload.iss;
  }
  set iss(value) {
    this.#payload.iss = value;
  }
  get sub() {
    return this.#payload.sub;
  }
  set sub(value) {
    this.#payload.sub = value;
  }
  get aud() {
    return this.#payload.aud;
  }
  set aud(value) {
    this.#payload.aud = value;
  }
  set jti(value) {
    this.#payload.jti = value;
  }
  set nbf(value) {
    if (typeof value === "number") {
      this.#payload.nbf = validateInput("setNotBefore", value);
    } else if (value instanceof Date) {
      this.#payload.nbf = validateInput("setNotBefore", epoch(value));
    } else {
      this.#payload.nbf = epoch(/* @__PURE__ */ new Date()) + secs(value);
    }
  }
  set exp(value) {
    if (typeof value === "number") {
      this.#payload.exp = validateInput("setExpirationTime", value);
    } else if (value instanceof Date) {
      this.#payload.exp = validateInput("setExpirationTime", epoch(value));
    } else {
      this.#payload.exp = epoch(/* @__PURE__ */ new Date()) + secs(value);
    }
  }
  set iat(value) {
    if (value === void 0) {
      this.#payload.iat = epoch(/* @__PURE__ */ new Date());
    } else if (value instanceof Date) {
      this.#payload.iat = validateInput("setIssuedAt", epoch(value));
    } else if (typeof value === "string") {
      this.#payload.iat = validateInput("setIssuedAt", epoch(/* @__PURE__ */ new Date()) + secs(value));
    } else {
      this.#payload.iat = validateInput("setIssuedAt", value);
    }
  }
};

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/jwt/verify.js
async function jwtVerify(jwt, key, options) {
  const verified = await compactVerify(jwt, key, options);
  if (verified.protectedHeader.crit?.includes("b64") && verified.protectedHeader.b64 === false) {
    throw new JWTInvalid("JWTs MUST NOT use unencoded payload");
  }
  const payload = validateClaimsSet(verified.protectedHeader, verified.payload, options);
  const result = { payload, protectedHeader: verified.protectedHeader };
  if (typeof key === "function") {
    return { ...result, key: verified.key };
  }
  return result;
}
__name(jwtVerify, "jwtVerify");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/jws/flattened/sign.js
var FlattenedSign = class {
  static {
    __name(this, "FlattenedSign");
  }
  #payload;
  #protectedHeader;
  #unprotectedHeader;
  constructor(payload) {
    if (!(payload instanceof Uint8Array)) {
      throw new TypeError("payload must be an instance of Uint8Array");
    }
    this.#payload = payload;
  }
  setProtectedHeader(protectedHeader) {
    assertNotSet(this.#protectedHeader, "setProtectedHeader");
    this.#protectedHeader = protectedHeader;
    return this;
  }
  setUnprotectedHeader(unprotectedHeader) {
    assertNotSet(this.#unprotectedHeader, "setUnprotectedHeader");
    this.#unprotectedHeader = unprotectedHeader;
    return this;
  }
  async sign(key, options) {
    if (!this.#protectedHeader && !this.#unprotectedHeader) {
      throw new JWSInvalid("either setProtectedHeader or setUnprotectedHeader must be called before #sign()");
    }
    if (!isDisjoint(this.#protectedHeader, this.#unprotectedHeader)) {
      throw new JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
    }
    const joseHeader = {
      ...this.#protectedHeader,
      ...this.#unprotectedHeader
    };
    const extensions = validateCrit(JWSInvalid, /* @__PURE__ */ new Map([["b64", true]]), options?.crit, this.#protectedHeader, joseHeader);
    let b64 = true;
    if (extensions.has("b64")) {
      b64 = this.#protectedHeader.b64;
      if (typeof b64 !== "boolean") {
        throw new JWSInvalid('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
      }
    }
    const { alg } = joseHeader;
    if (typeof alg !== "string" || !alg) {
      throw new JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
    }
    checkKeyType(alg, key, "sign");
    let payloadS;
    let payloadB;
    if (b64) {
      payloadS = encode2(this.#payload);
      payloadB = encode(payloadS);
    } else {
      payloadB = this.#payload;
      payloadS = "";
    }
    let protectedHeaderString;
    let protectedHeaderBytes;
    if (this.#protectedHeader) {
      protectedHeaderString = encode2(JSON.stringify(this.#protectedHeader));
      protectedHeaderBytes = encode(protectedHeaderString);
    } else {
      protectedHeaderString = "";
      protectedHeaderBytes = new Uint8Array();
    }
    const data = concat(protectedHeaderBytes, encode("."), payloadB);
    const k = await normalizeKey(key, alg);
    const signature = await sign(alg, k, data);
    const jws = {
      signature: encode2(signature),
      payload: payloadS
    };
    if (this.#unprotectedHeader) {
      jws.header = this.#unprotectedHeader;
    }
    if (this.#protectedHeader) {
      jws.protected = protectedHeaderString;
    }
    return jws;
  }
};

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/jws/compact/sign.js
var CompactSign = class {
  static {
    __name(this, "CompactSign");
  }
  #flattened;
  constructor(payload) {
    this.#flattened = new FlattenedSign(payload);
  }
  setProtectedHeader(protectedHeader) {
    this.#flattened.setProtectedHeader(protectedHeader);
    return this;
  }
  async sign(key, options) {
    const jws = await this.#flattened.sign(key, options);
    if (jws.payload === void 0) {
      throw new TypeError("use the flattened module for creating JWS with b64: false");
    }
    return `${jws.protected}.${jws.payload}.${jws.signature}`;
  }
};

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/jwt/sign.js
var SignJWT = class {
  static {
    __name(this, "SignJWT");
  }
  #protectedHeader;
  #jwt;
  constructor(payload = {}) {
    this.#jwt = new JWTClaimsBuilder(payload);
  }
  setIssuer(issuer) {
    this.#jwt.iss = issuer;
    return this;
  }
  setSubject(subject) {
    this.#jwt.sub = subject;
    return this;
  }
  setAudience(audience) {
    this.#jwt.aud = audience;
    return this;
  }
  setJti(jwtId) {
    this.#jwt.jti = jwtId;
    return this;
  }
  setNotBefore(input) {
    this.#jwt.nbf = input;
    return this;
  }
  setExpirationTime(input) {
    this.#jwt.exp = input;
    return this;
  }
  setIssuedAt(input) {
    this.#jwt.iat = input;
    return this;
  }
  setProtectedHeader(protectedHeader) {
    this.#protectedHeader = protectedHeader;
    return this;
  }
  async sign(key, options) {
    const sig = new CompactSign(this.#jwt.data());
    sig.setProtectedHeader(this.#protectedHeader);
    if (Array.isArray(this.#protectedHeader?.crit) && this.#protectedHeader.crit.includes("b64") && this.#protectedHeader.b64 === false) {
      throw new JWTInvalid("JWTs MUST NOT use unencoded payload");
    }
    return sig.sign(key, options);
  }
};

// src/jwt.ts
var ISSUER = "viota";
var AUDIENCE = "viota-web";
var TTL_SECONDS = 24 * 60 * 60;
function keyFor(secret) {
  return new TextEncoder().encode(secret);
}
__name(keyFor, "keyFor");
async function signToken(accountId, secret, now) {
  const builder = new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(accountId).setIssuer(ISSUER).setAudience(AUDIENCE);
  if (now === void 0) {
    builder.setIssuedAt().setExpirationTime("24h");
  } else {
    const iat = Math.floor(now / 1e3);
    builder.setIssuedAt(iat).setExpirationTime(iat + TTL_SECONDS);
  }
  return builder.sign(keyFor(secret));
}
__name(signToken, "signToken");
async function verifyToken(token, secret) {
  try {
    const { payload } = await jwtVerify(token, keyFor(secret), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE
    });
    const sub = payload.sub;
    if (typeof sub !== "string" || sub.length === 0) return null;
    return { accountId: sub };
  } catch {
    return null;
  }
}
__name(verifyToken, "verifyToken");

// src/do/authctx.ts
function unauthorized(reason) {
  return new Response(JSON.stringify({ error: "unauthorized", reason }), {
    status: 401,
    headers: { "content-type": "application/json" }
  });
}
__name(unauthorized, "unauthorized");
function extractBearerToken(request) {
  const h = request.headers.get("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  const token = m ? m[1].trim() : "";
  return token.length > 0 ? token : null;
}
__name(extractBearerToken, "extractBearerToken");
async function requireAuth(request, env) {
  const secret = env.JWT_SECRET;
  if (!secret) return unauthorized("server_misconfigured");
  const token = extractBearerToken(request);
  if (!token) return unauthorized("missing_token");
  const verified = await verifyToken(token, secret);
  if (!verified) return unauthorized("invalid_token");
  return verified;
}
__name(requireAuth, "requireAuth");
async function authenticateToken(token, env) {
  const secret = env.JWT_SECRET;
  if (!secret || typeof token !== "string" || token.length === 0) return null;
  return verifyToken(token, secret);
}
__name(authenticateToken, "authenticateToken");

// src/do/moves.ts
var COLORS3 = ["blue", "red", "yellow", "green"];
var SHAPES3 = ["triangle", "plus", "square", "circle"];
var NUMBERS3 = [1, 2, 3, 4];
function isObj(x) {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
__name(isObj, "isObj");
function isRegularCard(c) {
  return isObj(c) && c.kind === "regular" && typeof c.color === "string" && COLORS3.includes(c.color) && typeof c.shape === "string" && SHAPES3.includes(c.shape) && typeof c.number === "number" && NUMBERS3.includes(c.number);
}
__name(isRegularCard, "isRegularCard");
function isCard(c) {
  return isObj(c) && (c.kind === "wild" || isRegularCard(c));
}
__name(isCard, "isCard");
function isPosition(p) {
  return isObj(p) && Number.isInteger(p.x) && Number.isInteger(p.y);
}
__name(isPosition, "isPosition");
function isPlacement(p) {
  return isObj(p) && isCard(p.card) && isPosition(p.position);
}
__name(isPlacement, "isPlacement");
function cardsEqual(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.kind === "wild") return true;
  const br = b;
  return a.color === br.color && a.shape === br.shape && a.number === br.number;
}
__name(cardsEqual, "cardsEqual");
function isPermutation2(trades, order) {
  if (trades.length !== order.length) return false;
  const remaining = [...trades];
  for (const card of order) {
    const idx = remaining.findIndex((t) => cardsEqual(t, card));
    if (idx === -1) return false;
    remaining.splice(idx, 1);
  }
  return true;
}
__name(isPermutation2, "isPermutation");
var err = /* @__PURE__ */ __name((error) => ({ ok: false, error }), "err");
function validateMovePayloadShape(raw) {
  if (!isObj(raw)) return err("payload must be an object");
  switch (raw.type) {
    case "play": {
      if (!Array.isArray(raw.placements)) return err("placements must be an array");
      if (raw.placements.length < 1 || raw.placements.length > 4) {
        return err("placements length must be 1-4");
      }
      if (!raw.placements.every(isPlacement)) return err("invalid placement");
      return { ok: true, move: { type: "play", placements: raw.placements } };
    }
    case "pass": {
      if (!Array.isArray(raw.trades)) return err("trades must be an array");
      if (!Array.isArray(raw.tradeOrder)) return err("tradeOrder must be an array");
      if (raw.trades.length > 4) return err("cannot trade more than 4 cards");
      if (!raw.trades.every(isCard)) return err("invalid trade card");
      if (!raw.tradeOrder.every(isCard)) return err("invalid tradeOrder card");
      if (!isPermutation2(raw.trades, raw.tradeOrder)) {
        return err("tradeOrder must be a permutation of trades");
      }
      return { ok: true, move: { type: "pass", trades: raw.trades, tradeOrder: raw.tradeOrder } };
    }
    case "wild_recycle": {
      if (!isPosition(raw.wildPosition)) return err("invalid wildPosition");
      if (!isRegularCard(raw.replacement)) return err("replacement must be a regular card");
      return {
        ok: true,
        move: { type: "wild_recycle", wildPosition: raw.wildPosition, replacement: raw.replacement }
      };
    }
    default:
      return err("unknown move type");
  }
}
__name(validateMovePayloadShape, "validateMovePayloadShape");
function applyMovePayload(state, seatIndex, move) {
  switch (move.type) {
    case "play": {
      const r = applyPlay(state, seatIndex, move.placements);
      if ("error" in r) return { error: r.error };
      return { newState: r.newState, scoreDelta: r.scoreResult.total, gameOver: r.gameOver };
    }
    case "pass": {
      const r = applyPass(state, seatIndex, move.trades, move.tradeOrder);
      if ("error" in r) return { error: r.error };
      return { newState: r.newState, scoreDelta: 0, gameOver: r.gameOver };
    }
    case "wild_recycle": {
      const r = applyWildRecycle(state, seatIndex, move.wildPosition, move.replacement);
      if ("error" in r) return { error: r.error };
      return { newState: r.newState, scoreDelta: 0, gameOver: false };
    }
  }
}
__name(applyMovePayload, "applyMovePayload");

// src/do/replay.ts
function replay(initialState, moves) {
  const sorted = [...moves].sort((a, b) => a.move_index - b.move_index);
  let state = initialState;
  for (const m of sorted) {
    if (m.reverted) continue;
    const payload = JSON.parse(m.payload);
    const applied = applyMovePayload(state, m.seat_index, payload);
    if ("error" in applied) {
      throw new Error(`replay diverged at move_index ${m.move_index}: ${applied.error}`);
    }
    state = applied.newState;
  }
  return state;
}
__name(replay, "replay");

// src/do/timers.ts
function setTimer(sql, kind, seat, fireAt) {
  sql.exec(
    `INSERT INTO timers (kind, seat, fire_at) VALUES (?, ?, ?)
     ON CONFLICT(kind, seat) DO UPDATE SET fire_at = excluded.fire_at`,
    kind,
    seat,
    fireAt
  );
}
__name(setTimer, "setTimer");
function clearTimer(sql, kind, seat) {
  sql.exec(`DELETE FROM timers WHERE kind = ? AND seat = ?`, kind, seat);
}
__name(clearTimer, "clearTimer");
function hasTimer(sql, kind, seat) {
  return [...sql.exec(`SELECT 1 FROM timers WHERE kind = ? AND seat = ? LIMIT 1`, kind, seat)].length > 0;
}
__name(hasTimer, "hasTimer");
function dueTimers(sql, now) {
  return [...sql.exec(`SELECT kind, seat, fire_at FROM timers WHERE fire_at <= ? ORDER BY fire_at ASC`, now)].map(
    (r) => ({ kind: r.kind, seat: Number(r.seat), fire_at: Number(r.fire_at) })
  );
}
__name(dueTimers, "dueTimers");
function minFireAt(sql) {
  const r = [...sql.exec(`SELECT MIN(fire_at) AS m FROM timers`)][0];
  return r && r.m != null ? Number(r.m) : null;
}
__name(minFireAt, "minFireAt");
function creditEvictionGap(sql, gap) {
  if (gap <= 0) return;
  sql.exec(`UPDATE timers SET fire_at = fire_at + ? WHERE kind IN ('grace','turn','soft')`, gap);
}
__name(creditEvictionGap, "creditEvictionGap");
async function rearmAlarm(ctx, sql) {
  const min = minFireAt(sql);
  if (min == null) {
    await ctx.storage.deleteAlarm();
  } else {
    await ctx.storage.setAlarm(min);
  }
}
__name(rearmAlarm, "rearmAlarm");

// src/do/veto.ts
function computeReversibleTail(moves, seatIndex) {
  const live = moves.filter((m) => !m.reverted).sort((a, b) => a.move_index - b.move_index);
  const tail = [];
  for (let i = live.length - 1; i >= 0; i--) {
    const m = live[i];
    if (m.by_ai && m.seat_index === seatIndex) tail.push(m);
    else break;
  }
  return tail.reverse();
}
__name(computeReversibleTail, "computeReversibleTail");
function performVeto(repo, sql, seatIndex, now) {
  const meta = repo.getMeta();
  if (!meta) return { ok: false };
  const initial = repo.getInitialState();
  if (!initial) return { ok: false };
  const tail = computeReversibleTail(repo.getMovesSince(0), seatIndex);
  if (tail.length === 0) return { ok: false };
  for (const m of tail) repo.markReverted(m.move_index);
  const rebuilt = replay(initial, repo.getMovesSince(0));
  repo.putSnapshot(rebuilt);
  repo.putMeta({
    ...meta,
    current_seat: rebuilt.turnIndex,
    status: rebuilt.finished ? meta.status : "active"
  });
  clearTimer(sql, "grace", seatIndex);
  clearTimer(sql, "turn", seatIndex);
  clearTimer(sql, "ai_step", seatIndex);
  clearTimer(sql, "soft", seatIndex);
  repo.setControlledByAi(seatIndex, false);
  repo.setPresence(seatIndex, now);
  return { ok: true, rebuilt, revertedIndices: tail.map((m) => m.move_index), moveIndex: meta.move_index };
}
__name(performVeto, "performVeto");

// src/do/state-codec.ts
function serializeState(gs) {
  const payload = {
    grid: [...gs.grid.entries()],
    hands: gs.hands,
    drawPile: gs.drawPile,
    scores: gs.scores,
    turnIndex: gs.turnIndex,
    playedCards: gs.playedCards,
    consecutivePasses: gs.consecutivePasses ?? 0,
    finished: gs.finished ?? false
  };
  return JSON.stringify(payload);
}
__name(serializeState, "serializeState");
function deserializeState(s) {
  const p = JSON.parse(s);
  return {
    grid: new Map(p.grid),
    hands: p.hands,
    drawPile: p.drawPile,
    scores: p.scores,
    turnIndex: p.turnIndex,
    playedCards: p.playedCards,
    consecutivePasses: p.consecutivePasses ?? 0,
    finished: p.finished ?? false
  };
}
__name(deserializeState, "deserializeState");

// src/do/storage.ts
var migrateV1 = /* @__PURE__ */ __name((sql) => {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      id             INTEGER PRIMARY KEY CHECK (id = 1),
      move_index     INTEGER NOT NULL DEFAULT 0,
      status         TEXT    NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','completed','stalemate','abandoned')),
      current_seat   INTEGER NOT NULL DEFAULT 0,
      player_count   INTEGER NOT NULL,
      engine_version TEXT    NOT NULL,
      game_uuid      TEXT    NOT NULL
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS initial_state (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      state_json TEXT NOT NULL
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS snapshot (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      state_json TEXT NOT NULL
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS moves (
      move_index             INTEGER PRIMARY KEY,
      turn_number            INTEGER NOT NULL,
      seat_index             INTEGER NOT NULL,
      type                   TEXT    NOT NULL CHECK (type IN ('play','pass','wild_recycle')),
      payload                TEXT    NOT NULL,
      score_delta            INTEGER NOT NULL DEFAULT 0,
      score_after            INTEGER NOT NULL DEFAULT 0,
      by_ai                  INTEGER NOT NULL DEFAULT 0,
      ai_difficulty          TEXT,
      controlling_account_id TEXT,
      client_move_id         TEXT,
      reverted               INTEGER NOT NULL DEFAULT 0,
      created_at             INTEGER NOT NULL,
      UNIQUE (client_move_id)
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS seats (
      seat_index       INTEGER PRIMARY KEY,
      owner_account_id TEXT,
      ghost_id         TEXT,
      owner_type       TEXT    NOT NULL CHECK (owner_type IN ('human','ai','ghost','open')),
      display_name     TEXT,
      ai_difficulty    TEXT,
      controlled_by_ai INTEGER NOT NULL DEFAULT 0,
      disconnected_at  INTEGER,
      last_seen_at     INTEGER,
      final_score      INTEGER
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS timers (
      kind    TEXT    NOT NULL CHECK (kind IN ('grace','turn','ai_step','heal','soft')),
      seat    INTEGER,
      fire_at INTEGER NOT NULL,
      PRIMARY KEY (kind, seat)
    )
  `);
}, "migrateV1");
var migrateV2 = /* @__PURE__ */ __name((sql) => {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS runtime (
      id                INTEGER PRIMARY KEY CHECK (id = 1),
      last_processed_at INTEGER
    )
  `);
}, "migrateV2");
var migrateV3 = /* @__PURE__ */ __name((sql) => {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS archive_outbox (
      move_index INTEGER PRIMARY KEY,
      flushed    INTEGER NOT NULL DEFAULT 0
    )
  `);
}, "migrateV3");
var migrateV4 = /* @__PURE__ */ __name((sql) => {
  sql.exec(`DROP TABLE IF EXISTS meta_v4`);
  sql.exec(`
    CREATE TABLE meta_v4 (
      id             INTEGER PRIMARY KEY CHECK (id = 1),
      move_index     INTEGER NOT NULL DEFAULT 0,
      status         TEXT    NOT NULL DEFAULT 'active'
                       CHECK (status IN ('waiting','active','completed','stalemate','abandoned')),
      current_seat   INTEGER NOT NULL DEFAULT 0,
      player_count   INTEGER NOT NULL,
      engine_version TEXT    NOT NULL,
      game_uuid      TEXT    NOT NULL,
      code           TEXT
    )
  `);
  sql.exec(
    `INSERT INTO meta_v4 (id, move_index, status, current_seat, player_count, engine_version, game_uuid)
     SELECT id, move_index, status, current_seat, player_count, engine_version, game_uuid FROM meta`
  );
  sql.exec(`DROP TABLE meta`);
  sql.exec(`ALTER TABLE meta_v4 RENAME TO meta`);
}, "migrateV4");
var migrateV5 = /* @__PURE__ */ __name((sql) => {
  sql.exec(`ALTER TABLE meta ADD COLUMN host_seat INTEGER NOT NULL DEFAULT 0`);
}, "migrateV5");
var MIGRATIONS = [migrateV1, migrateV2, migrateV3, migrateV4, migrateV5];
function runMigrations(sql, migrations = MIGRATIONS) {
  sql.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`);
  const rows = [...sql.exec(`SELECT version FROM schema_version LIMIT 1`)];
  let current = rows.length ? Number(rows[0].version) : 0;
  if (rows.length === 0) {
    sql.exec(`INSERT INTO schema_version (version) VALUES (0)`);
    current = 0;
  }
  for (let v = current; v < migrations.length; v++) {
    migrations[v](sql);
  }
  sql.exec(`UPDATE schema_version SET version = ?`, migrations.length);
}
__name(runMigrations, "runMigrations");
var GameRepository = class _GameRepository {
  constructor(sql) {
    this.sql = sql;
  }
  sql;
  static {
    __name(this, "GameRepository");
  }
  all(query, ...bindings) {
    return [...this.sql.exec(query, ...bindings)];
  }
  getMeta() {
    const r = this.all(`SELECT * FROM meta WHERE id = 1`)[0];
    if (!r) return null;
    return {
      move_index: Number(r.move_index),
      status: r.status,
      current_seat: Number(r.current_seat),
      player_count: Number(r.player_count),
      engine_version: String(r.engine_version),
      game_uuid: String(r.game_uuid),
      code: r.code == null ? null : String(r.code),
      host_seat: r.host_seat == null ? 0 : Number(r.host_seat)
    };
  }
  putMeta(m) {
    this.sql.exec(
      `INSERT INTO meta (id, move_index, status, current_seat, player_count, engine_version, game_uuid, code, host_seat)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         move_index = excluded.move_index,
         status = excluded.status,
         current_seat = excluded.current_seat,
         player_count = excluded.player_count,
         engine_version = excluded.engine_version,
         game_uuid = excluded.game_uuid,
         code = excluded.code,
         host_seat = excluded.host_seat`,
      m.move_index,
      m.status,
      m.current_seat,
      m.player_count,
      m.engine_version,
      m.game_uuid,
      m.code,
      m.host_seat ?? 0
    );
  }
  /** Write the immutable post-deal state exactly once; later writes are no-ops. */
  putInitialState(gs) {
    this.sql.exec(
      `INSERT INTO initial_state (id, state_json) VALUES (1, ?) ON CONFLICT(id) DO NOTHING`,
      serializeState(gs)
    );
  }
  /** SERVER-ONLY. There is deliberately NO client-reachable path to this. */
  getInitialState() {
    const r = this.all(`SELECT state_json FROM initial_state WHERE id = 1`)[0];
    return r ? deserializeState(String(r.state_json)) : null;
  }
  putSnapshot(gs) {
    this.sql.exec(
      `INSERT INTO snapshot (id, state_json) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json`,
      serializeState(gs)
    );
  }
  getSnapshot() {
    const r = this.all(`SELECT state_json FROM snapshot WHERE id = 1`)[0];
    return r ? deserializeState(String(r.state_json)) : null;
  }
  static mapMoveRow(r) {
    return {
      move_index: Number(r.move_index),
      turn_number: Number(r.turn_number),
      seat_index: Number(r.seat_index),
      type: r.type,
      payload: String(r.payload),
      score_delta: Number(r.score_delta),
      score_after: Number(r.score_after),
      by_ai: Number(r.by_ai) === 1,
      ai_difficulty: r.ai_difficulty == null ? null : String(r.ai_difficulty),
      controlling_account_id: r.controlling_account_id == null ? null : String(r.controlling_account_id),
      client_move_id: r.client_move_id == null ? null : String(r.client_move_id),
      reverted: Number(r.reverted) === 1,
      created_at: Number(r.created_at)
    };
  }
  getMovesSince(k) {
    return this.all(`SELECT * FROM moves WHERE move_index > ? ORDER BY move_index ASC`, k).map(
      _GameRepository.mapMoveRow
    );
  }
  /** A single move row by index (for the archive write-through), or null. */
  getMove(moveIndex) {
    const r = this.all(`SELECT * FROM moves WHERE move_index = ?`, moveIndex)[0];
    return r ? _GameRepository.mapMoveRow(r) : null;
  }
  // ---- archive_outbox (DO-local write-through queue to D1) -----------------
  /** Enqueue (or re-arm) a move for D1 flush: sets flushed=0 even if present, so
   *  a veto's reverted rows are re-flushed. Synchronous SQL — safe in a span. */
  enqueueOutbox(moveIndex) {
    this.sql.exec(
      `INSERT INTO archive_outbox (move_index, flushed) VALUES (?, 0)
       ON CONFLICT(move_index) DO UPDATE SET flushed = 0`,
      moveIndex
    );
  }
  /** Mark an outbox row flushed after its D1 write-through succeeded. */
  markOutboxFlushed(moveIndex) {
    this.sql.exec(`UPDATE archive_outbox SET flushed = 1 WHERE move_index = ?`, moveIndex);
  }
  /** Move indices still awaiting a D1 flush (ascending) — the cron/tick retry set. */
  unflushedOutbox() {
    return this.all(`SELECT move_index FROM archive_outbox WHERE flushed = 0 ORDER BY move_index ASC`).map(
      (r) => Number(r.move_index)
    );
  }
  /**
   * Append one move row. `move_index` is the PK and `client_move_id` is UNIQUE,
   * so a duplicate index (impossible in a sync span — a backstop) or a duplicate
   * client id will THROW; the caller catches it and returns a benign conflict.
   */
  insertMove(m) {
    this.sql.exec(
      `INSERT INTO moves
         (move_index, turn_number, seat_index, type, payload, score_delta,
          score_after, by_ai, ai_difficulty, controlling_account_id,
          client_move_id, reverted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      m.move_index,
      m.turn_number,
      m.seat_index,
      m.type,
      m.payload,
      m.score_delta,
      m.score_after,
      m.by_ai ? 1 : 0,
      m.ai_difficulty,
      m.controlling_account_id,
      m.client_move_id,
      m.reverted ? 1 : 0,
      m.created_at
    );
    this.enqueueOutbox(m.move_index);
  }
  /** In-txn idempotency probe (SQLite permits multiple NULL client_move_id). */
  moveExistsByClientId(clientMoveId) {
    return this.all(`SELECT 1 FROM moves WHERE client_move_id = ? LIMIT 1`, clientMoveId).length > 0;
  }
  /**
   * Count of committed turn-completing moves (play/pass, not reverted). A
   * wild_recycle does NOT complete a turn. `turn_number` for the next move is
   * this count + 1, so a recycle and the play/pass that follows it share a turn.
   */
  countTurnCompletingMoves() {
    const r = this.all(`SELECT COUNT(*) AS c FROM moves WHERE type IN ('play','pass') AND reverted = 0`)[0];
    return r ? Number(r.c) : 0;
  }
  /**
   * The seat this account owns in THIS game, or null. Ownership is resolved
   * LIVE per request (never trusted from a token claim). A game binds at most
   * one seat per account, so the first match is authoritative.
   */
  seatOwnedBy(accountId) {
    return this.getSeats().find((s) => s.owner_account_id === accountId) ?? null;
  }
  /**
   * Mark a move row reverted (NEVER delete — audit + data fidelity). Used only
   * by the bounded veto; replay then skips it. Idempotent.
   */
  markReverted(moveIndex) {
    this.sql.exec(`UPDATE moves SET reverted = 1 WHERE move_index = ?`, moveIndex);
  }
  getSeats() {
    return this.all(`SELECT * FROM seats ORDER BY seat_index ASC`).map((r) => ({
      seat_index: Number(r.seat_index),
      owner_account_id: r.owner_account_id == null ? null : String(r.owner_account_id),
      ghost_id: r.ghost_id == null ? null : String(r.ghost_id),
      owner_type: r.owner_type,
      display_name: r.display_name == null ? null : String(r.display_name),
      ai_difficulty: r.ai_difficulty == null ? null : String(r.ai_difficulty),
      controlled_by_ai: Number(r.controlled_by_ai) === 1,
      disconnected_at: r.disconnected_at == null ? null : Number(r.disconnected_at),
      last_seen_at: r.last_seen_at == null ? null : Number(r.last_seen_at),
      final_score: r.final_score == null ? null : Number(r.final_score)
    }));
  }
  /** Wall-clock of the last handler/alarm entry (null before the first one). */
  getLastProcessedAt() {
    const r = this.all(`SELECT last_processed_at FROM runtime WHERE id = 1`)[0];
    return r && r.last_processed_at != null ? Number(r.last_processed_at) : null;
  }
  setLastProcessedAt(now) {
    this.sql.exec(
      `INSERT INTO runtime (id, last_processed_at) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET last_processed_at = excluded.last_processed_at`,
      now
    );
  }
  /** Targeted AI-control flip (avoids a full read-modify-write of the seat). */
  setControlledByAi(seat, value) {
    this.sql.exec(`UPDATE seats SET controlled_by_ai = ? WHERE seat_index = ?`, value ? 1 : 0, seat);
  }
  /** Heartbeat: refresh presence and clear any disconnect mark for a seat. */
  setPresence(seat, now) {
    this.sql.exec(`UPDATE seats SET last_seen_at = ?, disconnected_at = NULL WHERE seat_index = ?`, now, seat);
  }
  /** Mark a seat disconnected (arming grace/turn is the caller's job). */
  setDisconnectedAt(seat, now) {
    this.sql.exec(`UPDATE seats SET disconnected_at = ? WHERE seat_index = ?`, now, seat);
  }
  putSeat(s) {
    this.sql.exec(
      `INSERT INTO seats
         (seat_index, owner_account_id, ghost_id, owner_type, display_name,
          ai_difficulty, controlled_by_ai, disconnected_at, last_seen_at, final_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(seat_index) DO UPDATE SET
         owner_account_id = excluded.owner_account_id,
         ghost_id = excluded.ghost_id,
         owner_type = excluded.owner_type,
         display_name = excluded.display_name,
         ai_difficulty = excluded.ai_difficulty,
         controlled_by_ai = excluded.controlled_by_ai,
         disconnected_at = excluded.disconnected_at,
         last_seen_at = excluded.last_seen_at,
         final_score = excluded.final_score`,
      s.seat_index,
      s.owner_account_id,
      s.ghost_id,
      s.owner_type,
      s.display_name,
      s.ai_difficulty,
      s.controlled_by_ai ? 1 : 0,
      s.disconnected_at,
      s.last_seen_at,
      s.final_score
    );
  }
};

// src/do/init.ts
var DEFAULT_ENGINE_VERSION = "viota-engine@0";
function dealInto(repo, playerCount, opts = {}) {
  const existing = repo.getInitialState();
  if (existing) {
    const meta2 = repo.getMeta();
    if (meta2) return { initialState: existing, meta: meta2 };
  }
  const initialState = initGame(playerCount);
  const prior = repo.getMeta();
  const meta = {
    move_index: 0,
    status: "active",
    current_seat: initialState.turnIndex,
    player_count: playerCount,
    engine_version: prior?.engine_version ?? opts.engineVersion ?? DEFAULT_ENGINE_VERSION,
    game_uuid: prior?.game_uuid ?? opts.gameUuid ?? crypto.randomUUID(),
    code: prior?.code ?? null
  };
  repo.putInitialState(initialState);
  repo.putSnapshot(initialState);
  repo.putMeta(meta);
  return { initialState, meta };
}
__name(dealInto, "dealInto");
function initGameForOnline(repo, playerCount, seatOwners, opts = {}) {
  const existing = repo.getInitialState();
  if (existing) {
    const meta = repo.getMeta();
    if (meta) return { initialState: existing, meta };
  }
  for (let i = 0; i < playerCount; i++) {
    const o = seatOwners[i] ?? { ownerType: "open" };
    repo.putSeat({
      seat_index: i,
      owner_account_id: o.accountId ?? null,
      ghost_id: o.ghostId ?? null,
      owner_type: o.ownerType,
      display_name: o.displayName ?? null,
      ai_difficulty: o.aiDifficulty ?? null,
      controlled_by_ai: o.controlledByAi ?? o.ownerType === "ai",
      disconnected_at: null,
      last_seen_at: null,
      final_score: null
    });
  }
  return dealInto(repo, playerCount, opts);
}
__name(initGameForOnline, "initGameForOnline");
function createWaitingRoom(repo, opts) {
  const existing = repo.getMeta();
  if (existing) return { meta: existing };
  const meta = {
    move_index: 0,
    status: "waiting",
    current_seat: 0,
    player_count: opts.playerCount,
    engine_version: opts.engineVersion ?? DEFAULT_ENGINE_VERSION,
    game_uuid: opts.gameUuid ?? crypto.randomUUID(),
    code: opts.code ?? null,
    host_seat: 0
    // the room creator seats at 0 and is the initial host
  };
  repo.putMeta(meta);
  repo.putSeat({
    seat_index: 0,
    owner_account_id: opts.hostAccountId,
    ghost_id: null,
    owner_type: "human",
    display_name: opts.hostDisplayName,
    ai_difficulty: null,
    controlled_by_ai: false,
    disconnected_at: null,
    last_seen_at: null,
    final_score: null
  });
  for (let i = 1; i < opts.playerCount; i++) {
    repo.putSeat({
      seat_index: i,
      owner_account_id: null,
      ghost_id: null,
      owner_type: "open",
      display_name: null,
      ai_difficulty: null,
      controlled_by_ai: false,
      disconnected_at: null,
      last_seen_at: null,
      final_score: null
    });
  }
  return { meta };
}
__name(createWaitingRoom, "createWaitingRoom");

// src/do/view.ts
function buildWaitingRoomView(repo) {
  const meta = repo.getMeta();
  const seats = repo.getSeats();
  return {
    status: "waiting",
    playerCount: meta?.player_count ?? 0,
    code: meta?.code ?? null,
    hostSeat: meta?.host_seat ?? 0,
    openSeats: seats.filter((s) => s.owner_type === "open").length,
    seats: seats.map((s) => ({
      seatIndex: s.seat_index,
      ownerType: s.owner_type,
      displayName: s.display_name
    }))
  };
}
__name(buildWaitingRoomView, "buildWaitingRoomView");
function buildClientView(state, seatIndex) {
  return {
    grid: [...state.grid.entries()],
    mySeat: seatIndex,
    myHand: state.hands[seatIndex] ?? [],
    // own hand FULL
    handCounts: state.hands.map((h) => h.length),
    // others -> COUNT only
    drawPileCount: state.drawPile.length,
    // COUNT only, never the array
    scores: state.scores,
    turnIndex: state.turnIndex,
    playedCards: state.playedCards,
    consecutivePasses: state.consecutivePasses ?? 0,
    finished: state.finished ?? false
  };
}
__name(buildClientView, "buildClientView");

// src/d1/accounts.ts
var CRED_MIN_LEN = 16;
var CRED_MAX_LEN = 512;
function isValidDeviceCredential(cred) {
  return typeof cred === "string" && cred.length >= CRED_MIN_LEN && cred.length <= CRED_MAX_LEN;
}
__name(isValidDeviceCredential, "isValidDeviceCredential");
async function hashCredential(cred) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cred));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hashCredential, "hashCredential");
function sanitizeDisplayName(raw) {
  if (typeof raw !== "string") return "";
  let s = raw.normalize("NFC");
  s = s.replace(/[\p{Cc}\p{Cf}]/gu, "");
  s = s.replace(/[<>&"'`]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return [...s].slice(0, 24).join("");
}
__name(sanitizeDisplayName, "sanitizeDisplayName");
async function quickAccount(db, params) {
  const existing = await db.prepare("SELECT id FROM accounts WHERE credential_hash = ?").bind(params.credentialHash).first();
  if (existing) return { accountId: existing.id, isNew: false };
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO accounts (id, credential_hash, username, display_name, created_at)
       VALUES (?, ?, NULL, ?, ?)
       ON CONFLICT(credential_hash) DO NOTHING`
  ).bind(id, params.credentialHash, params.displayName, params.now).run();
  const row = await db.prepare("SELECT id FROM accounts WHERE credential_hash = ?").bind(params.credentialHash).first();
  const accountId = row?.id ?? id;
  return { accountId, isNew: accountId === id };
}
__name(quickAccount, "quickAccount");
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
__name(json, "json");
async function handleAuthQuick(request, env) {
  if (!env.JWT_SECRET) return json({ error: "service_unavailable" }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  if (!isValidDeviceCredential(body.deviceCredential)) {
    return json({ error: "invalid_credential" }, 400);
  }
  const displayName = sanitizeDisplayName(body.displayName);
  if (displayName.length === 0) return json({ error: "invalid_display_name" }, 400);
  const credentialHash = await hashCredential(body.deviceCredential);
  const { accountId } = await quickAccount(env.DB, { credentialHash, displayName, now: Date.now() });
  const token = await signToken(accountId, env.JWT_SECRET);
  return json({ token, accountId });
}
__name(handleAuthQuick, "handleAuthQuick");

// src/do/client-move.ts
function toClientMove(m) {
  const raw = JSON.parse(m.payload);
  let payload;
  if (m.type === "pass") {
    const trades = Array.isArray(raw.trades) ? raw.trades : [];
    payload = { type: "pass", tradedCount: trades.length };
  } else {
    payload = raw;
  }
  return {
    moveIndex: m.move_index,
    turnNumber: m.turn_number,
    seatIndex: m.seat_index,
    type: m.type,
    payload,
    scoreDelta: m.score_delta,
    scoreAfter: m.score_after,
    byAi: m.by_ai
  };
}
__name(toClientMove, "toClientMove");

// src/do/apply.ts
function applyAndPersist(_sql, repo, params) {
  const now = params.now ?? Date.now();
  const meta = repo.getMeta();
  if (!meta) return { error: "game_not_found" };
  if (meta.status !== "active") return { error: "game_over" };
  const snapshot = repo.getSnapshot();
  if (!snapshot) return { error: "no_snapshot" };
  if (params.clientMoveId != null && repo.moveExistsByClientId(params.clientMoveId)) {
    return { duplicate: true, view: buildClientView(snapshot, params.seatIndex) };
  }
  const seats = repo.getSeats();
  const seat = seats[params.seatIndex];
  if (!seat) return { error: "not_your_seat" };
  if (!params.byAi && (params.accountId == null || params.accountId !== seat.owner_account_id)) {
    return { error: "not_your_seat" };
  }
  if (params.requireAiControlled) {
    if (params.expectedSeat == null || meta.current_seat !== params.expectedSeat) {
      return { error: "reclaimed" };
    }
    const guardSeat = seats[params.expectedSeat];
    if (!guardSeat || !guardSeat.controlled_by_ai) return { error: "reclaimed" };
  }
  if (params.move.type !== "wild_recycle" && params.seatIndex !== meta.current_seat) {
    return { error: "not_your_turn" };
  }
  const applied = applyMovePayload(snapshot, params.seatIndex, params.move);
  if ("error" in applied) return { error: applied.error };
  const { newState, scoreDelta, gameOver } = applied;
  const moveIndex = meta.move_index + 1;
  const turnNumber = repo.countTurnCompletingMoves() + 1;
  const scoreAfter = newState.scores[params.seatIndex] ?? 0;
  const newStatus = gameOver ? params.move.type === "pass" ? "stalemate" : "completed" : "active";
  try {
    repo.insertMove({
      move_index: moveIndex,
      turn_number: turnNumber,
      seat_index: params.seatIndex,
      type: params.move.type,
      payload: JSON.stringify(params.move),
      score_delta: scoreDelta,
      score_after: scoreAfter,
      by_ai: params.byAi ?? false,
      ai_difficulty: params.aiDifficulty ?? null,
      controlling_account_id: seat.owner_account_id,
      client_move_id: params.clientMoveId,
      reverted: false,
      created_at: now
    });
  } catch {
    return { error: "conflict" };
  }
  repo.putSnapshot(newState);
  repo.putMeta({ ...meta, move_index: moveIndex, current_seat: newState.turnIndex, status: newStatus });
  return { ok: true, moveIndex, view: buildClientView(newState, params.seatIndex) };
}
__name(applyAndPersist, "applyAndPersist");

// src/do/constants.ts
var PRESENCE_MS = 45e3;
var SOFT_TURN_MS = 75e3;
var AI_STEP_MS = 800;
var HEAL_MS = 6e4;
var ABANDON_MS = 6e5;
var GLOBAL_SEAT = -1;

// src/do/presence.ts
function isSeatPresent(seat, now) {
  return seat.last_seen_at != null && now - seat.last_seen_at <= PRESENCE_MS;
}
__name(isSeatPresent, "isSeatPresent");
function isAnyHumanPresent(repo, now) {
  return repo.getSeats().some((s) => isSeatPresent(s, now));
}
__name(isAnyHumanPresent, "isAnyHumanPresent");
function seatIndexPresent(repo, seatIndex, now) {
  const s = repo.getSeats()[seatIndex];
  return !!s && isSeatPresent(s, now);
}
__name(seatIndexPresent, "seatIndexPresent");
function maxLastSeen(repo) {
  let max = null;
  for (const s of repo.getSeats()) {
    if (s.last_seen_at != null && (max == null || s.last_seen_at > max)) max = s.last_seen_at;
  }
  return max;
}
__name(maxLastSeen, "maxLastSeen");
function promoteHost(repo, departingSeat, now) {
  const meta = repo.getMeta();
  if (!meta) return null;
  const host = meta.host_seat ?? 0;
  if (host !== departingSeat) return null;
  const successor = repo.getSeats().find((s) => s.seat_index !== departingSeat && s.owner_type === "human" && isSeatPresent(s, now));
  if (!successor) return null;
  repo.putMeta({ ...meta, host_seat: successor.seat_index });
  return successor.seat_index;
}
__name(promoteHost, "promoteHost");
function autoCover(deps, repo, sql, seat, now) {
  const seatRow = repo.getSeats()[seat];
  if (!seatRow) return;
  repo.setControlledByAi(seat, true);
  clearTimer(sql, "grace", seat);
  clearTimer(sql, "turn", seat);
  clearTimer(sql, "soft", seat);
  setTimer(sql, "ai_step", seat, now);
  deps.broadcast({ type: "ai_cover", seat });
}
__name(autoCover, "autoCover");

// src/do/drive.ts
function toMovePayload(m) {
  if (m.type === "play") return { type: "play", placements: m.placements };
  return { type: "pass", trades: m.trades, tradeOrder: m.tradeOrder };
}
__name(toMovePayload, "toMovePayload");
function driveIfAI(deps, repo, sql, now) {
  const meta = repo.getMeta();
  if (!meta || meta.status !== "active") {
    if (meta) clearTimer(sql, "ai_step", meta.current_seat);
    return;
  }
  if (!isAnyHumanPresent(repo, now)) {
    clearTimer(sql, "ai_step", meta.current_seat);
    return;
  }
  const currentSeat = meta.current_seat;
  const seat = repo.getSeats()[currentSeat];
  if (!seat) return;
  if (!seat.controlled_by_ai) {
    clearTimer(sql, "ai_step", currentSeat);
    if (isSeatPresent(seat, now) && !hasTimer(sql, "soft", currentSeat)) {
      setTimer(sql, "soft", currentSeat, now + SOFT_TURN_MS);
    }
    return;
  }
  const snapshot = repo.getSnapshot();
  if (!snapshot) return;
  const move = toMovePayload(AIAgent("medium")(snapshot, currentSeat));
  const targetMoveIndex = meta.move_index + 1;
  const result = deps.ctx.storage.transactionSync(
    () => applyAndPersist(sql, repo, {
      seatIndex: currentSeat,
      move,
      clientMoveId: `ai:${currentSeat}:${targetMoveIndex}`,
      accountId: null,
      byAi: true,
      aiDifficulty: "medium",
      expectedSeat: currentSeat,
      requireAiControlled: true,
      now
    })
  );
  clearTimer(sql, "ai_step", currentSeat);
  if ("ok" in result && result.ok) {
    deps.nudge(result.moveIndex);
    const after = repo.getMeta();
    if (after && after.status === "active") {
      const nextRow = repo.getSeats()[after.current_seat];
      if (nextRow && nextRow.controlled_by_ai) {
        setTimer(sql, "ai_step", after.current_seat, now + AI_STEP_MS);
      }
    }
  }
}
__name(driveIfAI, "driveIfAI");

// src/do/archive.ts
async function flushMove(db, gameUuid, m) {
  await db.prepare(
    `INSERT INTO moves
         (game_uuid, move_index, turn_number, seat_index, type, payload,
          score_delta, score_after, by_ai, ai_difficulty, controlling_account_id,
          reverted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_uuid, move_index) DO UPDATE SET reverted = excluded.reverted`
  ).bind(
    gameUuid,
    m.move_index,
    m.turn_number,
    m.seat_index,
    m.type,
    m.payload,
    m.score_delta,
    m.score_after,
    m.by_ai ? 1 : 0,
    m.ai_difficulty,
    m.controlling_account_id,
    m.reverted ? 1 : 0,
    m.created_at
  ).run();
}
__name(flushMove, "flushMove");
async function flushGameCreate(db, game, seats) {
  await db.prepare(
    `INSERT INTO games
         (game_uuid, mode, status, player_count, source, engine_version,
          created_at, last_activity_at, code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_uuid) DO UPDATE SET last_activity_at = excluded.last_activity_at`
  ).bind(
    game.gameUuid,
    game.mode,
    game.status,
    game.playerCount,
    game.source,
    game.engineVersion,
    game.createdAt,
    game.lastActivityAt,
    game.code
  ).run();
  const stmts = seats.map(
    (s) => db.prepare(
      `INSERT INTO game_players
           (game_uuid, seat_index, account_id, ghost_id, owner_type, display_name, final_score)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(game_uuid, seat_index) DO NOTHING`
    ).bind(game.gameUuid, s.seat_index, s.owner_account_id, s.ghost_id, s.owner_type, s.display_name, s.final_score)
  );
  if (stmts.length) await db.batch(stmts);
}
__name(flushGameCreate, "flushGameCreate");
async function upsertGamePlayers(db, gameUuid, seats) {
  const stmts = seats.map(
    (s) => db.prepare(
      `INSERT INTO game_players
           (game_uuid, seat_index, account_id, ghost_id, owner_type, display_name, final_score)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(game_uuid, seat_index) DO UPDATE SET
           account_id = excluded.account_id,
           ghost_id = excluded.ghost_id,
           owner_type = excluded.owner_type,
           display_name = excluded.display_name`
    ).bind(gameUuid, s.seat_index, s.owner_account_id, s.ghost_id, s.owner_type, s.display_name, s.final_score)
  );
  if (stmts.length) await db.batch(stmts);
}
__name(upsertGamePlayers, "upsertGamePlayers");
async function setGameStatus(db, gameUuid, status, ts) {
  await db.prepare(`UPDATE games SET status = ?, last_activity_at = ? WHERE game_uuid = ?`).bind(status, ts, gameUuid).run();
}
__name(setGameStatus, "setGameStatus");
async function flushGameEnd(db, gameUuid, end) {
  await db.prepare(
    `UPDATE games
         SET status = ?, outcome = ?, winner_seat = ?, ended_at = ?, last_activity_at = ?
       WHERE game_uuid = ?`
  ).bind(end.status, end.outcome, end.winnerSeat, end.endedAt, end.lastActivityAt, gameUuid).run();
  const stmts = end.finalScores.map(
    (score2, seat) => db.prepare(`UPDATE game_players SET final_score = ? WHERE game_uuid = ? AND seat_index = ?`).bind(score2, gameUuid, seat)
  );
  if (stmts.length) await db.batch(stmts);
}
__name(flushGameEnd, "flushGameEnd");
async function touchActivity(db, gameUuid, ts) {
  await db.prepare(`UPDATE games SET last_activity_at = ? WHERE game_uuid = ?`).bind(ts, gameUuid).run();
}
__name(touchActivity, "touchActivity");
async function resolveActiveGameByCode(db, code) {
  const row = await db.prepare(
    `SELECT game_uuid FROM games
       WHERE code = ? AND status IN ('waiting','active')
       ORDER BY last_activity_at DESC LIMIT 1`
  ).bind(code).first();
  return row?.game_uuid ?? null;
}
__name(resolveActiveGameByCode, "resolveActiveGameByCode");
function winnerSeatOf(scores) {
  if (scores.length === 0) return null;
  let best = 0;
  for (let i = 1; i < scores.length; i++) if ((scores[i] ?? 0) > (scores[best] ?? 0)) best = i;
  return best;
}
__name(winnerSeatOf, "winnerSeatOf");

// src/game-do.ts
function json2(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}
__name(json2, "json");
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s) {
  return UUID_RE.test(s);
}
__name(isUuid, "isUuid");
function statusForError(error) {
  switch (error) {
    case "not_your_seat":
      return 403;
    case "game_over":
    case "not_your_turn":
    case "conflict":
    case "reclaimed":
      return 409;
    case "game_not_found":
    case "no_snapshot":
      return 404;
    default:
      return 400;
  }
}
__name(statusForError, "statusForError");
var GameDO = class extends DurableObject {
  static {
    __name(this, "GameDO");
  }
  repo;
  constructor(ctx, env) {
    super(ctx, env);
    if (!ctx.storage.sql) {
      throw new Error("GameDO requires a SQLite-backed Durable Object (new_sqlite_classes)");
    }
    ctx.blockConcurrencyWhile(async () => {
      runMigrations(ctx.storage.sql);
    });
    this.repo = new GameRepository(ctx.storage.sql);
  }
  /** Proves @viota/engine bundles and runs inside the workerd runtime. */
  ping() {
    return initGame(2).drawPile.length;
  }
  async fetch(request) {
    const guard = assertSecret(this.env);
    if (guard) return guard;
    if ((request.headers.get("Upgrade") ?? "").toLowerCase() === "websocket") {
      return this.handleWebSocketUpgrade();
    }
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "POST" && path === "/init") {
      return this.handleInit(request);
    }
    if (request.method === "POST" && path === "/create-room") {
      return this.handleCreateRoom(request);
    }
    if (request.method === "POST" && path === "/join") {
      return this.handleJoin(request);
    }
    if (request.method === "POST" && path === "/start") {
      return this.handleStart(request);
    }
    if (request.method === "POST" && path === "/leave") {
      return this.handleLeave(request);
    }
    if (request.method === "POST" && path === "/move") {
      return this.handleMove(request);
    }
    if (request.method === "POST" && path === "/heartbeat") {
      return this.handleHeartbeat(request);
    }
    if (request.method === "POST" && path === "/reclaim") {
      return this.handleReclaim(request);
    }
    if (request.method === "POST" && path === "/veto") {
      return this.handleVeto(request);
    }
    if (request.method === "GET" && path === "/sync") {
      return this.handleSync(request, url);
    }
    if (request.method === "POST" && path === "/tick") {
      return this.handleTick();
    }
    return json2({ error: "not_found" }, 404);
  }
  // ---- WebSocket Hibernation API -----------------------------------------
  //
  // Sockets are accepted via ctx.acceptWebSocket (hibernatable) and handled by
  // the webSocket* DO METHODS below — NEVER server.accept()/addEventListener,
  // which pin the DO in memory and defeat hibernation. Per-socket identity is
  // stashed via serializeAttachment (survives hibernation); fan-out enumerates
  // ctx.getWebSockets() rather than any in-memory Map.
  handleWebSocketUpgrade() {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ authed: false });
    return new Response(null, { status: 101, webSocket: client });
  }
  /** Generic seat-agnostic fan-out to every attached socket (nudges, toasts). */
  broadcast(payload) {
    const data = JSON.stringify(payload);
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.send(data);
      } catch {
      }
    }
    return sockets.length;
  }
  /** "There's news at index N" — never any hand data. */
  nudge(moveIndex) {
    return this.broadcast({ type: "nudge", moveIndex });
  }
  /** Deps for the drive loop (the ONLY code path that produces AI moves). */
  driveDeps() {
    return { ctx: this.ctx, nudge: /* @__PURE__ */ __name((i) => this.nudge(i), "nudge") };
  }
  /** Deps for auto-cover (broadcast the dismissible ai_cover toast). */
  coverDeps() {
    return { broadcast: /* @__PURE__ */ __name((p) => this.broadcast(p), "broadcast") };
  }
  // ---- D1 archive write-through (must-fix #8) -----------------------------
  //
  // The DO SQLite copy is authoritative live truth; D1 is the rebuildable
  // archive. Every mutating handler ends with `ctx.waitUntil(archiveTick(now))`
  // (NEVER inside a transactionSync span, NEVER blocking the move response). A
  // D1 failure only leaves outbox rows unflushed for the cron/`/tick` to retry.
  /** Drain the DO-local archive_outbox to D1: every enqueued move (human/AI/
   *  floor) is upserted, then the row is marked flushed. Stops on the first D1
   *  error, leaving the rest unflushed for retry. `db` is injectable for tests. */
  async flushOutbox(now, db = this.env.DB) {
    const meta = this.repo.getMeta();
    if (!meta) return;
    const gameUuid = meta.game_uuid;
    let flushedAny = false;
    for (const idx of this.repo.unflushedOutbox()) {
      const m = this.repo.getMove(idx);
      if (!m) {
        this.repo.markOutboxFlushed(idx);
        continue;
      }
      try {
        await flushMove(db, gameUuid, m);
        this.repo.markOutboxFlushed(idx);
        flushedAny = true;
      } catch {
        return;
      }
    }
    if (flushedAny) {
      try {
        await touchActivity(db, gameUuid, now);
      } catch {
      }
    }
  }
  /** Flush the outbox, then finalize the archive game row iff the game ended. A
   *  game-end tick therefore leaves ZERO unflushed outbox rows. Never rejects. */
  async archiveTick(now, db = this.env.DB) {
    await this.flushOutbox(now, db);
    const meta = this.repo.getMeta();
    if (!meta || meta.status === "active") return;
    const scores = this.repo.getSnapshot()?.scores ?? [];
    try {
      await flushGameEnd(db, meta.game_uuid, {
        status: meta.status,
        outcome: meta.status,
        winnerSeat: meta.status === "completed" ? winnerSeatOf(scores) : null,
        endedAt: now,
        lastActivityAt: now,
        finalScores: scores
      });
    } catch {
    }
  }
  /** Write the games + game_players index rows to D1 at creation (registry). */
  async archiveGameCreate(now, code) {
    const meta = this.repo.getMeta();
    if (!meta) return;
    const game = {
      gameUuid: meta.game_uuid,
      mode: "online",
      status: meta.status,
      playerCount: meta.player_count,
      source: "online_authoritative",
      // forced server-side; never client-settable
      engineVersion: meta.engine_version,
      createdAt: now,
      lastActivityAt: now,
      code
    };
    try {
      await flushGameCreate(this.env.DB, game, this.repo.getSeats());
    } catch {
    }
  }
  /** Write-through a seat change (a /join) to the D1 game_players index + touch
   *  the registry activity. Best-effort; the DO SQLite copy is authoritative. */
  async archiveSeats(now) {
    const meta = this.repo.getMeta();
    if (!meta) return;
    try {
      await upsertGamePlayers(this.env.DB, meta.game_uuid, this.repo.getSeats());
      await touchActivity(this.env.DB, meta.game_uuid, now);
    } catch {
    }
  }
  /** Sync the D1 registry when a room goes live at /start: flip the status to
   *  'active' and upsert the final roster (AI fills + joiners). Best-effort. */
  async archiveGameStart(now) {
    const meta = this.repo.getMeta();
    if (!meta) return;
    try {
      await setGameStatus(this.env.DB, meta.game_uuid, meta.status, now);
      await upsertGamePlayers(this.env.DB, meta.game_uuid, this.repo.getSeats());
    } catch {
    }
  }
  // ---- Alarm handler (the never-stall floor + timer-wheel dispatch) --------
  //
  // The single platform Alarm fires at min(fire_at). It is wrapped in try/catch
  // and ALWAYS re-arms before returning (CF abandons an alarm after ~6 retries;
  // we never leave it unset while work remains). On a RETRY (`alarmInfo.isRetry`
  // — CF re-fires the SAME alarm after a kill/throw), we take the O(1) pass
  // floor instead of recomputing, so a CPU limit degrades AI quality, never
  // liveness (must-fix #2). A persisted attempt-counter is deliberately NOT
  // used: a rolled-back counter would re-run the killed path forever.
  async alarm(alarmInfo) {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    try {
      const gap = this.onWake(sql, now);
      if (alarmInfo?.isRetry) {
        this.applyFloor(sql, now);
        await rearmAlarm(this.ctx, sql);
        this.ctx.waitUntil(this.archiveTick(now));
        return;
      }
      const threshold = gap > PRESENCE_MS ? now : Math.max(now, minFireAt(sql) ?? now);
      for (const t of dueTimers(sql, threshold)) {
        switch (t.kind) {
          case "grace":
          case "turn": {
            if (seatIndexPresent(this.repo, t.seat, now)) {
              clearTimer(sql, "grace", t.seat);
              clearTimer(sql, "turn", t.seat);
            } else {
              autoCover(this.coverDeps(), this.repo, sql, t.seat, now);
            }
            break;
          }
          case "soft":
            autoCover(this.coverDeps(), this.repo, sql, t.seat, now);
            break;
          case "ai_step":
            clearTimer(sql, "ai_step", t.seat);
            driveIfAI(this.driveDeps(), this.repo, sql, now);
            break;
          case "heal":
            clearTimer(sql, "heal", t.seat);
            this.healTick(sql, now);
            break;
        }
      }
      await rearmAlarm(this.ctx, sql);
      this.ctx.waitUntil(this.archiveTick(now));
    } catch {
      try {
        await rearmAlarm(this.ctx, sql);
      } catch {
      }
    }
  }
  /**
   * On any DO wake: compute the eviction gap from `last_processed_at`, credit it
   * to absence deadlines (grace/turn/soft) when it exceeds one presence window
   * so a returning player gets a fresh window instead of an instant cover, then
   * stamp `last_processed_at = now`. Returns the gap. Idempotent per wake.
   */
  onWake(sql, now) {
    const last = this.repo.getLastProcessedAt();
    const gap = last == null ? 0 : now - last;
    if (gap > PRESENCE_MS) creditEvictionGap(sql, gap);
    this.repo.setLastProcessedAt(now);
    return gap;
  }
  /** Ensure the abandon/re-drive self-tick is armed while the game is active. */
  ensureHeal(sql, now) {
    if (!hasTimer(sql, "heal", GLOBAL_SEAT)) setTimer(sql, "heal", GLOBAL_SEAT, now + HEAL_MS);
  }
  /**
   * The `heal` self-tick: while active, keep re-driving as a safety net and,
   * when ZERO humans have been present for longer than the abandon window, mark
   * the game abandoned (recoverable by replay if reopened). While humans are
   * present (or the abandon window has not elapsed) it re-arms itself.
   */
  healTick(sql, now) {
    const meta = this.repo.getMeta();
    if (!meta || meta.status !== "active") return;
    if (isAnyHumanPresent(this.repo, now)) {
      driveIfAI(this.driveDeps(), this.repo, sql, now);
      setTimer(sql, "heal", GLOBAL_SEAT, now + HEAL_MS);
      return;
    }
    const seen = maxLastSeen(this.repo);
    if (seen != null && now - seen > ABANDON_MS) {
      this.repo.putMeta({ ...meta, status: "abandoned" });
      this.ctx.waitUntil(this.archiveTick(now));
      return;
    }
    setTimer(sql, "heal", GLOBAL_SEAT, now + HEAL_MS);
  }
  /**
   * The CPU-kill floor: an O(1) always-legal `applyPass([],[])` for the current
   * AI-covered seat. This CANNOT be CPU-killed, so it guarantees the turn
   * advances past a seat whose smart computation was killed mid-invocation. The
   * deterministic `floor:seat:targetMoveIndex` id makes a re-fire benign.
   */
  applyFloor(sql, now) {
    const meta = this.repo.getMeta();
    if (!meta || meta.status !== "active") return;
    const seat = meta.current_seat;
    const seatRow = this.repo.getSeats()[seat];
    if (!seatRow || !seatRow.controlled_by_ai) return;
    const snapshot = this.repo.getSnapshot();
    if (!snapshot) return;
    const targetMoveIndex = meta.move_index + 1;
    const result = this.ctx.storage.transactionSync(
      () => applyAndPersist(sql, this.repo, {
        seatIndex: seat,
        move: { type: "pass", trades: [], tradeOrder: [] },
        clientMoveId: `floor:${seat}:${targetMoveIndex}`,
        accountId: null,
        byAi: true,
        aiDifficulty: "floor",
        expectedSeat: seat,
        requireAiControlled: true,
        now
      })
    );
    if ("ok" in result && result.ok) {
      this.nudge(result.moveIndex);
      const after = this.repo.getMeta();
      if (after && after.status === "active") {
        const nextRow = this.repo.getSeats()[after.current_seat];
        if (nextRow && nextRow.controlled_by_ai) setTimer(sql, "ai_step", after.current_seat, now);
      }
    }
  }
  async webSocketMessage(ws, message2) {
    const att = ws.deserializeAttachment() ?? { authed: false };
    const text = typeof message2 === "string" ? message2 : new TextDecoder().decode(message2);
    let frame;
    try {
      frame = JSON.parse(text);
    } catch {
      frame = null;
    }
    if (!att.authed) {
      if (!frame || frame.type !== "auth" || typeof frame.token !== "string") {
        ws.close(4001, "auth required");
        return;
      }
      const auth = await authenticateToken(frame.token, this.env);
      if (!auth) {
        ws.close(4001, "invalid token");
        return;
      }
      const seat = this.repo.seatOwnedBy(auth.accountId);
      if (!seat) {
        ws.close(4001, "not a seat owner");
        return;
      }
      ws.serializeAttachment({ authed: true, seatIndex: seat.seat_index, accountId: auth.accountId });
      ws.send(JSON.stringify({ type: "auth_ok", seat: seat.seat_index }));
      return;
    }
    ws.send(JSON.stringify({ type: "ack", seat: att.seatIndex, echo: frame?.type ?? null }));
  }
  async webSocketClose(_ws, _code, _reason, _wasClean) {
  }
  async webSocketError(_ws, _error) {
  }
  async handleInit(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return json2({ error: "bad_json" }, 400);
    }
    const playerCount = body.playerCount;
    if (typeof playerCount !== "number" || playerCount < 2 || playerCount > 4) {
      return json2({ error: "invalid_player_count" }, 400);
    }
    const seatOwners = Array.isArray(body.seatOwners) ? body.seatOwners : [];
    if (seatOwners.length !== playerCount) {
      return json2({ error: "seat_owner_count_mismatch" }, 400);
    }
    const { meta } = initGameForOnline(this.repo, playerCount, seatOwners, {
      engineVersion: body.engineVersion,
      gameUuid: body.gameUuid
    });
    const code = typeof body.code === "string" ? body.code : null;
    this.ctx.waitUntil(this.archiveGameCreate(Date.now(), code));
    return json2({ gameUuid: meta.game_uuid, moveIndex: meta.move_index, playerCount }, 201);
  }
  /**
   * POST /create-room — the multiplayer waiting-room create. The Worker forwards
   * here with the host's Authorization; `requireAuth` resolves the host account
   * from the token (never a body field). The room is written status='waiting'
   * (seat 0 = host, the rest 'open') and NO deal happens. The D1 registry row is
   * written SYNCHRONOUSLY (awaited) before returning so a friend's immediate
   * GET /resolve?code= finds it.
   */
  async handleCreateRoom(request) {
    const auth = await requireAuth(request, this.env);
    if (auth instanceof Response) return auth;
    let body;
    try {
      body = await request.json();
    } catch {
      return json2({ error: "bad_json" }, 400);
    }
    const playerCount = body.playerCount;
    if (typeof playerCount !== "number" || playerCount < 2 || playerCount > 4) {
      return json2({ error: "invalid_player_count" }, 400);
    }
    const hostDisplayName = sanitizeDisplayName(body.displayName);
    const { meta } = createWaitingRoom(this.repo, {
      playerCount,
      hostAccountId: auth.accountId,
      hostDisplayName: hostDisplayName.length > 0 ? hostDisplayName : null,
      gameUuid: body.gameUuid,
      engineVersion: body.engineVersion,
      code: typeof body.code === "string" ? body.code : null
    });
    await this.archiveGameCreate(Date.now(), meta.code);
    return json2(
      { gameId: meta.game_uuid, code: meta.code, playerCount: meta.player_count, room: buildWaitingRoomView(this.repo) },
      201
    );
  }
  /**
   * POST /join — claim a seat in a `'waiting'` room. requireAuth; the seat is
   * bound to the token account. Idempotent: an account already holding a seat
   * gets it back. Claims the LOWEST 'open' seat (or an explicit open `seatIndex`)
   * and flips it to a human seat. 409 if the room is full or not waiting.
   */
  async handleJoin(request) {
    const auth = await requireAuth(request, this.env);
    if (auth instanceof Response) return auth;
    let body;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const meta = this.repo.getMeta();
    if (!meta) return json2({ error: "game_not_found" }, 404);
    if (meta.status !== "waiting") return json2({ error: "not_waiting" }, 409);
    const seats = this.repo.getSeats();
    const already = seats.find((s) => s.owner_account_id === auth.accountId);
    if (already) return json2({ seatIndex: already.seat_index, room: buildWaitingRoomView(this.repo) });
    let target;
    if (typeof body.seatIndex === "number" && Number.isInteger(body.seatIndex)) {
      const s = seats[body.seatIndex];
      if (!s || s.owner_type !== "open") return json2({ error: "seat_unavailable" }, 409);
      target = s;
    } else {
      target = seats.find((s) => s.owner_type === "open");
    }
    if (!target) return json2({ error: "room_full" }, 409);
    const displayName = sanitizeDisplayName(body.displayName);
    this.ctx.storage.transactionSync(() => {
      this.repo.putSeat({
        ...target,
        owner_type: "human",
        owner_account_id: auth.accountId,
        display_name: displayName.length > 0 ? displayName : null,
        controlled_by_ai: false
      });
    });
    this.ctx.waitUntil(this.archiveSeats(Date.now()));
    return json2({ seatIndex: target.seat_index, room: buildWaitingRoomView(this.repo) });
  }
  /**
   * POST /start — deal a waiting room and go live. requireAuth; ONLY the host
   * seat (`meta.host_seat`) may start (else 403 `not_host`). Requires >=2 HUMAN
   * seats. Remaining 'open' seats are filled with medium AI (the host's choice),
   * then `dealInto` runs the engine deal WITHOUT clobbering the claimed seat
   * owners. Flips the D1 registry to 'active', kicks the drive loop (in case the
   * opening seat is AI), and broadcasts `{type:'started'}` so waiting joiners
   * auto-navigate.
   */
  async handleStart(request) {
    const auth = await requireAuth(request, this.env);
    if (auth instanceof Response) return auth;
    const meta = this.repo.getMeta();
    if (!meta) return json2({ error: "game_not_found" }, 404);
    if (meta.status !== "waiting") return json2({ error: "not_waiting" }, 409);
    const ownSeat = this.repo.seatOwnedBy(auth.accountId);
    if (!ownSeat) return json2({ error: "not_your_seat" }, 403);
    if (ownSeat.seat_index !== (meta.host_seat ?? 0)) return json2({ error: "not_host" }, 403);
    const humanCount = this.repo.getSeats().filter((s) => s.owner_type === "human").length;
    if (humanCount < 2) return json2({ error: "need_two_humans" }, 409);
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    this.onWake(sql, now);
    this.ctx.storage.transactionSync(() => {
      for (const s of this.repo.getSeats()) {
        if (s.owner_type === "open") {
          this.repo.putSeat({
            ...s,
            owner_type: "ai",
            controlled_by_ai: true,
            ai_difficulty: "medium",
            display_name: s.display_name ?? `AI ${s.seat_index + 1}`
          });
        }
      }
      dealInto(this.repo, meta.player_count);
      this.repo.setPresence(ownSeat.seat_index, now);
    });
    this.ensureHeal(sql, now);
    driveIfAI(this.driveDeps(), this.repo, sql, now);
    await rearmAlarm(this.ctx, sql);
    this.ctx.waitUntil(this.archiveGameStart(now));
    this.ctx.waitUntil(this.archiveTick(now));
    this.broadcast({ type: "started", moveIndex: 0 });
    const snapshot = this.repo.getSnapshot();
    if (!snapshot) return json2({ error: "no_snapshot" }, 500);
    return json2({ moveIndex: this.repo.getMeta().move_index, snapshot: buildClientView(snapshot, ownSeat.seat_index) });
  }
  /**
   * POST /leave — intentional leave. requireAuth; the caller's OWN seat is
   * AI-covered IMMEDIATELY (skips the grace window a silent socket drop waits
   * for) and an `ai_cover` toast is broadcast. The seat stays owned so the player
   * can reclaim it if they return.
   */
  async handleLeave(request) {
    const auth = await requireAuth(request, this.env);
    if (auth instanceof Response) return auth;
    const meta = this.repo.getMeta();
    if (!meta) return json2({ error: "game_not_found" }, 404);
    const seat = this.repo.seatOwnedBy(auth.accountId);
    if (!seat) return json2({ error: "not_your_seat" }, 403);
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    this.onWake(sql, now);
    let newHost = null;
    this.ctx.storage.transactionSync(() => {
      autoCover(this.coverDeps(), this.repo, sql, seat.seat_index, now);
      if (meta.status === "waiting") newHost = promoteHost(this.repo, seat.seat_index, now);
    });
    if (newHost != null) this.broadcast({ type: "host_changed", hostSeat: newHost });
    this.ensureHeal(sql, now);
    driveIfAI(this.driveDeps(), this.repo, sql, now);
    await rearmAlarm(this.ctx, sql);
    this.ctx.waitUntil(this.archiveTick(now));
    return json2({ ok: true, seat: seat.seat_index });
  }
  /**
   * POST /move — the authoritative move endpoint.
   *
   * The ONLY await is `request.json()`, done BEFORE the synchronous txn span so
   * the input gate stays closed across read->validate->write and a move can
   * never interleave with an alarm onto the same move_index. After the txn
   * commits we `nudge` (commit-then-broadcast — never before commit).
   */
  async handleMove(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return json2({ error: "bad_json" }, 400);
    }
    const auth = await requireAuth(request, this.env);
    if (auth instanceof Response) return auth;
    const meta = this.repo.getMeta();
    if (!meta) return json2({ error: "game_not_found" }, 404);
    const seatIndex = body.seatIndex;
    if (typeof seatIndex !== "number" || !Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= meta.player_count) {
      return json2({ error: "invalid_seat" }, 400);
    }
    const clientMoveId = body.clientMoveId ?? null;
    if (clientMoveId !== null && !(typeof clientMoveId === "string" && isUuid(clientMoveId))) {
      return json2({ error: "invalid_client_move_id" }, 400);
    }
    const shape = validateMovePayloadShape(body.move);
    if (!shape.ok) return json2({ error: shape.error }, 400);
    const params = { seatIndex, move: shape.move, clientMoveId, accountId: auth.accountId };
    const sql = this.ctx.storage.sql;
    this.onWake(sql, Date.now());
    const result = this.ctx.storage.transactionSync(() => applyAndPersist(sql, this.repo, params));
    if ("error" in result) {
      return json2(result, statusForError(result.error));
    }
    if ("duplicate" in result) {
      return json2(result, 200);
    }
    this.nudge(result.moveIndex);
    const now = Date.now();
    clearTimer(sql, "soft", seatIndex);
    this.ensureHeal(sql, now);
    driveIfAI(this.driveDeps(), this.repo, sql, now);
    await rearmAlarm(this.ctx, sql);
    this.ctx.waitUntil(this.archiveTick(now));
    return json2(result, 200);
  }
  /**
   * POST /heartbeat {seatIndex} — presence is the SOLE authority for the
   * drive/freeze decision (must-fix #5). Refresh `last_seen_at`, clear any
   * disconnect mark, cancel this seat's absence deadlines (a returning human),
   * and re-run the drive loop (unfreezes a game / hands a covered-but-returned
   * table back on the next iteration). Full silent reclaim is Phase 4.
   */
  async handleHeartbeat(request) {
    const auth = await requireAuth(request, this.env);
    if (auth instanceof Response) return auth;
    const meta = this.repo.getMeta();
    if (!meta) return json2({ error: "game_not_found" }, 404);
    const seat = this.repo.seatOwnedBy(auth.accountId);
    if (!seat) return json2({ error: "not_your_seat" }, 403);
    const seatIndex = seat.seat_index;
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    this.repo.setPresence(seatIndex, now);
    this.onWake(sql, now);
    clearTimer(sql, "grace", seatIndex);
    clearTimer(sql, "turn", seatIndex);
    this.ensureHeal(sql, now);
    driveIfAI(this.driveDeps(), this.repo, sql, now);
    await rearmAlarm(this.ctx, sql);
    this.ctx.waitUntil(this.archiveTick(now));
    return json2({ ok: true, seat: seatIndex });
  }
  /**
   * POST /reclaim — atomic SILENT reclaim (must-fix "reclaim atomic ordered
   * checklist"). The authed account's own seat is taken back from AI cover in
   * ONE synchronous critical section, in order:
   *   1. cancel this seat's grace/turn/ai_step/soft timers;
   *   2. clear controlled_by_ai;
   *   3. clear disconnected_at + set last_seen_at = now (a fresh heartbeat);
   * then re-arm the platform alarm to the new min(fire_at).
   *
   * A committed AI move is NEVER rolled back here — the human resumes from the
   * CURRENT snapshot (that is the veto's job, not reclaim's). If the reclaimed
   * seat is the current turn, control is now the human's: no auto-cover re-fires
   * (controlled_by_ai is cleared) and driveIfAI is a no-op for it. The redacted
   * snapshot is returned LAST.
   */
  async handleReclaim(request) {
    const auth = await requireAuth(request, this.env);
    if (auth instanceof Response) return auth;
    const meta = this.repo.getMeta();
    if (!meta) return json2({ error: "game_not_found" }, 404);
    const seat = this.repo.seatOwnedBy(auth.accountId);
    if (!seat) return json2({ error: "not_your_seat" }, 403);
    const seatIndex = seat.seat_index;
    const snapshot = this.repo.getSnapshot();
    if (!snapshot) return json2({ error: "no_snapshot" }, 404);
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    this.onWake(sql, now);
    this.ctx.storage.transactionSync(() => {
      clearTimer(sql, "grace", seatIndex);
      clearTimer(sql, "turn", seatIndex);
      clearTimer(sql, "ai_step", seatIndex);
      clearTimer(sql, "soft", seatIndex);
      this.repo.setControlledByAi(seatIndex, false);
      this.repo.setPresence(seatIndex, now);
    });
    this.ensureHeal(sql, now);
    await rearmAlarm(this.ctx, sql);
    return json2({ moveIndex: meta.move_index, snapshot: buildClientView(snapshot, seatIndex) });
  }
  /**
   * POST /veto — the bounded reversible veto (spec §4). Owner-first authz (you
   * veto only the seat you own -> 403). In ONE transactionSync span, `performVeto`
   * reverts the maximal trailing AI run on that seat (only if it forms the global
   * trailing run, else nothing is reverted), rebuilds the snapshot by replay,
   * returns control to the seat, and reclaims it. `meta.move_index` stays at the
   * max — the human's next POST /move lands at max+1. If there is no reversible
   * tail (someone/something committed on top), returns 409 {vetoable:false}.
   */
  async handleVeto(request) {
    const auth = await requireAuth(request, this.env);
    if (auth instanceof Response) return auth;
    const meta = this.repo.getMeta();
    if (!meta) return json2({ error: "game_not_found" }, 404);
    const seat = this.repo.seatOwnedBy(auth.accountId);
    if (!seat) return json2({ error: "not_your_seat" }, 403);
    const seatIndex = seat.seat_index;
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    this.onWake(sql, now);
    const result = this.ctx.storage.transactionSync(() => performVeto(this.repo, sql, seatIndex, now));
    if (!result.ok) return json2({ vetoable: false }, 409);
    for (const idx of result.revertedIndices) this.repo.enqueueOutbox(idx);
    this.ensureHeal(sql, now);
    await rearmAlarm(this.ctx, sql);
    this.ctx.waitUntil(this.archiveTick(now));
    this.broadcast({ type: "veto", seat: seatIndex, moveIndex: result.moveIndex });
    return json2({
      ok: true,
      moveIndex: result.moveIndex,
      // unchanged max — the human's next /move is +1
      reverted: result.revertedIndices,
      snapshot: buildClientView(result.rebuilt, seatIndex)
    });
  }
  /**
   * POST /tick — the cron sweep's self-heal poke (task 5, unauthenticated: only
   * reachable via the DO stub, never the public Worker router). On wake it
   * credits any eviction gap, runs the heal path (safety re-drive while humans
   * are present, or abandon after a long absence), re-arms the wheel, and — since
   * a cron tick is not latency-sensitive — AWAITS the archive drain so any
   * archive_outbox rows a prior D1 hiccup left behind are retried synchronously.
   */
  async handleTick() {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    this.onWake(sql, now);
    const meta = this.repo.getMeta();
    if (meta && meta.status === "active") this.healTick(sql, now);
    await rearmAlarm(this.ctx, sql);
    await this.archiveTick(now);
    return json2({ ok: true });
  }
  async handleSync(request, url) {
    const auth = await requireAuth(request, this.env);
    if (auth instanceof Response) return auth;
    const meta = this.repo.getMeta();
    if (!meta) return json2({ error: "game_not_found" }, 404);
    const ownSeat = this.repo.seatOwnedBy(auth.accountId);
    if (!ownSeat) return json2({ error: "not_your_seat" }, 403);
    const seat = ownSeat.seat_index;
    if (meta.status === "waiting") {
      return json2(buildWaitingRoomView(this.repo));
    }
    const sinceRaw = url.searchParams.get("since");
    const since = sinceRaw == null ? 0 : Number(sinceRaw);
    if (!Number.isInteger(since) || since < 0) {
      return json2({ error: "invalid_since" }, 400);
    }
    const snapshot = this.repo.getSnapshot();
    if (!snapshot) return json2({ error: "no_snapshot" }, 404);
    const moves = this.repo.getMovesSince(since).filter((m) => !m.reverted).map(toClientMove);
    return json2({
      moveIndex: meta.move_index,
      snapshot: buildClientView(snapshot, seat),
      moves
    });
  }
};

// src/d1/claim.ts
function json3(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
__name(json3, "json");
async function handleClaim(request, env) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;
  let body;
  try {
    body = await request.json();
  } catch {
    return json3({ error: "bad_json" }, 400);
  }
  const ghostId = body.ghostId;
  if (typeof ghostId !== "string" || ghostId.length === 0 || ghostId.length > 128) {
    return json3({ error: "invalid_ghost_id" }, 400);
  }
  if (!isValidDeviceCredential(body.deviceCredential)) {
    return json3({ error: "invalid_credential" }, 400);
  }
  const h = await hashCredential(body.deviceCredential);
  if (h !== ghostId) return json3({ error: "forbidden" }, 403);
  const res = await env.DB.prepare(`UPDATE game_players SET account_id = ? WHERE ghost_id = ? AND account_id IS NULL`).bind(auth.accountId, ghostId).run();
  return json3({ ok: true, claimed: res.meta?.changes ?? 0 });
}
__name(handleClaim, "handleClaim");

// src/cors.ts
var ALLOW_METHODS = "GET,POST,OPTIONS";
var ALLOW_HEADERS = "Authorization,Content-Type";
var MAX_AGE = "86400";
function corsHeaders(request, env) {
  const headers = {
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Max-Age": MAX_AGE,
    Vary: "Origin"
  };
  const configured = env.CLIENT_ORIGIN;
  const origin = request.headers.get("Origin");
  if (!configured) {
    headers["Access-Control-Allow-Origin"] = "*";
  } else if (origin !== null && origin === configured) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}
__name(corsHeaders, "corsHeaders");
function handlePreflight(request, env) {
  if (request.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}
__name(handlePreflight, "handlePreflight");
function withCors(response, request, env) {
  const merged = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(request, env))) merged.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged
  });
}
__name(withCors, "withCors");

// src/index.ts
function json4(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}
__name(json4, "json");
function stubFor(env, gameId) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(gameId));
}
__name(stubFor, "stubFor");
function authHeadersFrom(request) {
  const h = { "content-type": "application/json" };
  const auth = request.headers.get("Authorization");
  if (auth) h.Authorization = auth;
  return h;
}
__name(authHeadersFrom, "authHeadersFrom");
function generateRoomCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}
__name(generateRoomCode, "generateRoomCode");
async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "POST" && path === "/auth/quick") {
    return handleAuthQuick(request, env);
  }
  if (request.method === "POST" && path === "/claim") {
    return handleClaim(request, env);
  }
  if (request.method === "GET" && path === "/games/resolve") {
    const code = (url.searchParams.get("code") ?? "").trim().toUpperCase();
    if (!code) return json4({ error: "missing_code" }, 400);
    const gameId = await resolveActiveGameByCode(env.DB, code);
    if (!gameId) return json4({ error: "not_found" }, 404);
    return json4({ gameId });
  }
  if (request.method === "POST" && path === "/games") {
    const gameId = crypto.randomUUID();
    let body;
    try {
      body = await request.json();
    } catch {
      return json4({ error: "bad_json" }, 400);
    }
    const code = generateRoomCode();
    const mode = body?.mode;
    if (mode === "multiplayer") {
      const res2 = await stubFor(env, gameId).fetch(
        new Request("https://do/create-room", {
          method: "POST",
          headers: authHeadersFrom(request),
          body: JSON.stringify({ playerCount: body.playerCount, displayName: body.displayName, gameUuid: gameId, code })
        })
      );
      if (!res2.ok) return res2;
      return json4({ gameId, code }, 201);
    }
    if (mode === "solo") {
      const auth = await requireAuth(request, env);
      if (auth instanceof Response) return auth;
      const playerCount = body.playerCount;
      if (typeof playerCount !== "number" || playerCount < 2 || playerCount > 4) {
        return json4({ error: "invalid_player_count" }, 400);
      }
      const displayName = typeof body.displayName === "string" ? body.displayName : "";
      const seatOwners = [
        { ownerType: "human", accountId: auth.accountId, displayName },
        ...Array.from({ length: playerCount - 1 }, (_, i) => ({
          ownerType: "ai",
          aiDifficulty: "medium",
          controlledByAi: true,
          displayName: `AI ${i + 2}`
        }))
      ];
      const res2 = await stubFor(env, gameId).fetch(
        new Request("https://do/init", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ playerCount, seatOwners, gameUuid: gameId, code })
        })
      );
      if (!res2.ok) return res2;
      return json4({ gameId, code }, 201);
    }
    const initBody = JSON.stringify({ ...body, gameUuid: gameId, code });
    const res = await stubFor(env, gameId).fetch(
      new Request("https://do/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: initBody
      })
    );
    if (!res.ok) return res;
    return json4({ gameId, code }, 201);
  }
  const join = path.match(/^\/games\/([^/]+)\/join$/);
  if (request.method === "POST" && join) {
    const gameId = decodeURIComponent(join[1]);
    return stubFor(env, gameId).fetch(new Request("https://do/join", request));
  }
  const start = path.match(/^\/games\/([^/]+)\/start$/);
  if (request.method === "POST" && start) {
    const gameId = decodeURIComponent(start[1]);
    return stubFor(env, gameId).fetch(new Request("https://do/start", request));
  }
  const leave = path.match(/^\/games\/([^/]+)\/leave$/);
  if (request.method === "POST" && leave) {
    const gameId = decodeURIComponent(leave[1]);
    return stubFor(env, gameId).fetch(new Request("https://do/leave", request));
  }
  const move = path.match(/^\/games\/([^/]+)\/move$/);
  if (request.method === "POST" && move) {
    const gameId = decodeURIComponent(move[1]);
    return stubFor(env, gameId).fetch(new Request("https://do/move", request));
  }
  const heartbeat = path.match(/^\/games\/([^/]+)\/heartbeat$/);
  if (request.method === "POST" && heartbeat) {
    const gameId = decodeURIComponent(heartbeat[1]);
    return stubFor(env, gameId).fetch(new Request("https://do/heartbeat", request));
  }
  const reclaim = path.match(/^\/games\/([^/]+)\/reclaim$/);
  if (request.method === "POST" && reclaim) {
    const gameId = decodeURIComponent(reclaim[1]);
    return stubFor(env, gameId).fetch(new Request("https://do/reclaim", request));
  }
  const veto = path.match(/^\/games\/([^/]+)\/veto$/);
  if (request.method === "POST" && veto) {
    const gameId = decodeURIComponent(veto[1]);
    return stubFor(env, gameId).fetch(new Request("https://do/veto", request));
  }
  const sync = path.match(/^\/games\/([^/]+)\/sync$/);
  if (request.method === "GET" && sync) {
    const gameId = decodeURIComponent(sync[1]);
    return stubFor(env, gameId).fetch(
      new Request(`https://do/sync${url.search}`, { method: "GET", headers: request.headers })
    );
  }
  const socket = path.match(/^\/games\/([^/]+)\/socket$/);
  if (socket) {
    const gameId = decodeURIComponent(socket[1]);
    return stubFor(env, gameId).fetch(request);
  }
  return json4({ error: "not_found" }, 404);
}
__name(route, "route");
var index_default = {
  async fetch(request, env) {
    const preflight = handlePreflight(request, env);
    if (preflight) return preflight;
    const guard = assertSecret(env);
    if (guard) return withCors(guard, request, env);
    const response = await route(request, env);
    if (response.webSocket) return response;
    return withCors(response, request, env);
  },
  /**
   * Cron sweep (1-min trigger). Finds stale active games via the lobby-registry
   * index — `status='active' AND last_activity_at < now - ABANDON_MS` — and pokes
   * each DO's `/tick`, which re-drives/abandons it and drains any unflushed
   * archive rows. Lightweight: one indexed D1 query + a fire-and-forget poke per
   * stale game (the DO does the real work).
   */
  async scheduled(_event, env, ctx) {
    if (assertSecret(env)) return;
    const cutoff = Date.now() - ABANDON_MS;
    const { results } = await env.DB.prepare(
      `SELECT game_uuid FROM games WHERE status = 'active' AND last_activity_at < ?`
    ).bind(cutoff).all();
    for (const { game_uuid } of results) {
      ctx.waitUntil(stubFor(env, game_uuid).fetch("https://do/tick", { method: "POST" }));
    }
  }
};
export {
  GameDO,
  index_default as default
};
//# sourceMappingURL=index.js.map
