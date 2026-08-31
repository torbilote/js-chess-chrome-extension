// Hosts the Stockfish WASM engine in a Web Worker and relays UCI messages
// between the background service worker and the engine. SAN moves coming
// from the content script are first replayed with chess.js to obtain the
// UCI (long algebraic) form Stockfish expects, since SAN itself is not a
// valid UCI "position ... moves ..." argument.

import { Chess } from '../lib/chessjs/chess.js';

const ENGINE_URL = chrome.runtime.getURL('lib/stockfish/stockfish-18-lite-single.js');
const worker = new Worker(ENGINE_URL);

let ready = false;
let currentRequestId = null;
let currentTabId = null;
const queue = [];

// Converts a list of SAN move strings (reconstructed from chess.com's move
// list DOM) into UCI long-algebraic moves by replaying them from the start
// position. Stops at the first move chess.js can't parse (e.g. if the SAN
// reconstruction in content.js missed an edge case) and uses only the moves
// successfully replayed up to that point.
function sanMovesToUci(sanMoves) {
  const chess = Chess();
  const uciMoves = [];
  for (const san of sanMoves) {
    const result = chess.move(san, { sloppy: true });
    if (!result) {
      console.warn('[ChessSupporter] nie udało się rozpoznać ruchu SAN:', san, '- ignoruję dalsze ruchy');
      break;
    }
    uciMoves.push(result.from + result.to + (result.promotion || ''));
  }
  return uciMoves;
}

function flushQueue() {
  if (!ready || currentRequestId != null || queue.length === 0) return;
  const job = queue.shift();
  currentRequestId = job.requestId;
  currentTabId = job.tabId;
  const posCmd = job.uciMoves.length > 0 ? 'position startpos moves ' + job.uciMoves.join(' ') : 'position startpos';
  worker.postMessage(posCmd);
  worker.postMessage('go movetime ' + job.movetimeMs);
}

worker.onmessage = (e) => {
  const line = e.data;
  if (typeof line !== 'string') return;
  console.debug('[ChessSupporter][engine]', line);

  if (line === 'uciok') {
    worker.postMessage('isready');
    return;
  }
  if (line === 'readyok') {
    ready = true;
    flushQueue();
    return;
  }
  if (line.startsWith('bestmove')) {
    const move = line.split(' ')[1];
    if (currentRequestId != null && currentTabId != null) {
      chrome.runtime.sendMessage({
        type: 'ENGINE_RESULT',
        move,
        requestId: currentRequestId,
        tabId: currentTabId,
      });
    }
    currentRequestId = null;
    currentTabId = null;
    flushQueue();
  }
};

worker.onerror = (err) => {
  console.error('[ChessSupporter] engine worker error:', err.message, err);
};

worker.postMessage('uci');

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'ENGINE_ANALYZE') return;

  const uciMoves = sanMovesToUci(msg.moves || []);

  // Only the most recent position matters; drop any stale queued job.
  queue.length = 0;
  queue.push({ uciMoves, movetimeMs: msg.movetimeMs, requestId: msg.requestId, tabId: msg.tabId });
  if (currentRequestId != null) {
    // Abort the in-flight search; its bestmove reply will trigger flushQueue().
    worker.postMessage('stop');
  } else {
    flushQueue();
  }
});
