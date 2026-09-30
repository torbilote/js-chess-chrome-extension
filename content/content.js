// Reads the played-move list from the chess.com "play" page and asks the
// background/offscreen engine for the best next move. The DOM structure
// below is confirmed against a real chess.com "play vs computer" game:
//
// <wc-simple-move-list ...>
//   <div class="node white-move main-line-ply" data-node="0-0">
//     <span class="node-highlight-content ..."><span class="icon-font-chess knight-white" data-figurine="N"></span> f3 </span>
//   </div>
//   ...
// </wc-simple-move-list>
//
// Each move node's visible text (destination square, capture "x", optional
// disambiguation/promotion) is combined with the piece letter from the
// figurine icon's data-figurine attribute (absent for pawn moves) to
// reconstruct a standard SAN token, e.g. "N" + "f3" -> "Nf3". The resulting
// SAN list is sent off for validation/replay (see offscreen/offscreen.js,
// which uses chess.js) rather than being parsed into a FEN here.

const CONFIG = {
  moveListSelector: 'wc-simple-move-list',
  moveNodeSelector: '.node[data-node]',
  figurineSelector: '[data-figurine]',
  overlayId: 'chess-supporter-overlay',
  debounceMs: 250,
  movetimeMs: 4000,
};

let enabled = true;
let playerColor = 'w'; // 'w' or 'b' — which side the user is playing, set via the popup
let observer = null;
let debounceTimer = null;
let lastSanKey = null;
let lastMovesForDebug = [];
let latestRequestId = 0;
let requestCounter = 0;
let overlayEl = null;
let contextInvalidated = false;

function log(...args) {
  console.debug('[ChessSupporter]', ...args);
}

// After the extension is reloaded/updated in chrome://extensions, content
// scripts already injected into open tabs keep running but lose their
// connection to the extension — any chrome.runtime call then throws
// "Extension context invalidated". Detect that once, stop trying, and tell
// the user to refresh instead of spamming the console forever.
function isExtensionContextValid() {
  return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
}

function handleContextInvalidated() {
  if (contextInvalidated) return;
  contextInvalidated = true;
  stopObserving();
  setOverlayText('Chess Supporter: rozszerzenie zaktualizowane — odśwież stronę (F5)');
  console.warn('[ChessSupporter] Extension context invalidated — odśwież kartę, aby podpowiedzi znowu działały.');
}

function extractSanMoves() {
  const nodes = document.querySelectorAll(`${CONFIG.moveListSelector} ${CONFIG.moveNodeSelector}`);
  const moves = [];
  nodes.forEach((node) => {
    const figurineEl = node.querySelector(CONFIG.figurineSelector);
    const prefix = figurineEl ? figurineEl.dataset.figurine || '' : '';
    const text = (node.textContent || '').replace(/\s+/g, '');
    if (!text) return;
    moves.push(prefix + text);
  });
  return moves;
}

function ensureOverlay() {
  if (overlayEl && document.documentElement.contains(overlayEl)) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.id = CONFIG.overlayId;
  overlayEl.textContent = 'Chess Supporter: czekam na listę ruchów...';
  document.documentElement.appendChild(overlayEl);
  return overlayEl;
}

function setOverlayText(text) {
  ensureOverlay().textContent = text;
}

function formatMove(uci) {
  if (!uci || uci === '(none)') return 'brak sugestii (koniec gry / brak ruchów?)';
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promo = uci.slice(4);
  return promo ? `${from} → ${to} (promocja: ${promo})` : `${from} → ${to}`;
}

function analyzeIfChanged() {
  if (!enabled || contextInvalidated) return;
  if (!isExtensionContextValid()) {
    handleContextInvalidated();
    return;
  }
  const moveListEl = document.querySelector(CONFIG.moveListSelector);
  if (!moveListEl) {
    setOverlayText('Chess Supporter: nie znaleziono listy ruchów na stronie');
    return;
  }

  const moves = extractSanMoves();
  const key = moves.join(' ');
  if (key === lastSanKey) return;
  lastSanKey = key;
  lastMovesForDebug = moves;
  log('ruchy (SAN):', moves);

  requestCounter += 1;
  latestRequestId = requestCounter; // bump unconditionally so a stale in-flight reply below gets ignored

  // Ply parity unambiguously tells us whose turn it is: after an even number
  // of played moves it's White's turn, after an odd number it's Black's.
  const sideToMove = moves.length % 2 === 0 ? 'w' : 'b';
  if (sideToMove !== playerColor) {
    setOverlayText('Chess Supporter: czekam na ruch przeciwnika...');
    return;
  }

  setOverlayText('Chess Supporter: liczę najlepszy ruch...');
  try {
    chrome.runtime.sendMessage({
      type: 'ANALYZE_MOVES',
      moves,
      movetimeMs: CONFIG.movetimeMs,
      requestId: latestRequestId,
    });
  } catch (err) {
    handleContextInvalidated();
  }
}

// Throttle rather than debounce: we observe the whole body, where clocks
// mutate continuously, so a resetting debounce would never fire.
function scheduleAnalyze() {
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    analyzeIfChanged();
  }, CONFIG.debounceMs);
}

function startObserving() {
  // Observe the body, not the move list itself: chess.com is an SPA and
  // replaces the move list element on navigation (e.g. /play -> /game/...),
  // which would leave an observer on the old element silently dead.
  if (observer) observer.disconnect();
  observer = new MutationObserver(scheduleAnalyze);
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleAnalyze();
}

function stopObserving() {
  if (observer) observer.disconnect();
  observer = null;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'BEST_MOVE') {
    if (msg.requestId !== latestRequestId) return; // stale result, ignore
    if (msg.error) {
      setOverlayText(`Chess Supporter — błąd: ${msg.error}`);
      return;
    }
    setOverlayText(`Chess Supporter — najlepszy ruch: ${formatMove(msg.move)}`);
  } else if (msg?.type === 'GET_STATUS') {
    sendResponse({ lastMoves: lastMovesForDebug, enabled });
  }
});

chrome.storage.local.get({ enabled: true, playerColor: 'w' }, (res) => {
  enabled = res.enabled;
  playerColor = res.playerColor;
  if (enabled) {
    startObserving();
  } else {
    setOverlayText('Chess Supporter: wyłączone (włącz w popupie rozszerzenia)');
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.playerColor) {
    playerColor = changes.playerColor.newValue;
    lastSanKey = null; // force re-evaluation of the current position against the new color
    scheduleAnalyze();
  }
  if (!changes.enabled) return;
  enabled = changes.enabled.newValue;
  if (enabled) {
    startObserving();
  } else {
    stopObserving();
    setOverlayText('Chess Supporter: wyłączone (włącz w popupie rozszerzenia)');
  }
});
