const OFFSCREEN_URL = 'offscreen/offscreen.html';

let creatingOffscreen = null;

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length > 0) return;

  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ['WORKERS'],
        justification: 'Runs the Stockfish chess engine inside a Web Worker to analyze board positions locally.',
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'ANALYZE_MOVES' && sender.tab?.id != null) {
    const tabId = sender.tab.id;
    ensureOffscreenDocument().then(() => {
      chrome.runtime.sendMessage({
        type: 'ENGINE_ANALYZE',
        moves: message.moves,
        movetimeMs: message.movetimeMs,
        requestId: message.requestId,
        tabId,
      });
    });
    return;
  }

  if (message?.type === 'ENGINE_RESULT' && message.tabId != null) {
    chrome.tabs
      .sendMessage(message.tabId, {
        type: 'BEST_MOVE',
        move: message.move,
        requestId: message.requestId,
      })
      .catch(() => {
        /* tab may have navigated away or closed; nothing to do */
      });
  }
});
