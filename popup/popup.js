const checkbox = document.getElementById('enabled');
const colorRadios = document.querySelectorAll('input[name="playerColor"]');
const status = document.getElementById('status');

chrome.storage.local.get({ enabled: true, playerColor: 'w' }, ({ enabled, playerColor }) => {
  checkbox.checked = enabled;
  colorRadios.forEach((r) => {
    r.checked = r.value === playerColor;
  });
});

checkbox.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: checkbox.checked });
});

colorRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    if (radio.checked) chrome.storage.local.set({ playerColor: radio.value });
  });
});

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const supported = ['https://www.chess.com/play/', 'https://www.chess.com/game/'];
  if (!tab?.url || !supported.some((prefix) => tab.url.startsWith(prefix))) {
    status.textContent = 'Ta karta nie jest partią na chess.com/play/... ani chess.com/game/...';
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' }, (resp) => {
    if (chrome.runtime.lastError) {
      status.textContent = 'Brak odpowiedzi ze strony (odśwież kartę).';
      return;
    }
    status.textContent = resp?.lastMoves?.length
      ? `Ostatnie wykryte ruchy:\n${resp.lastMoves.join(' ')}`
      : 'Czekam na wykrycie ruchów...';
  });
});
