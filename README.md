# Chess Supporter

Lokalne rozszerzenie do Google Chrome (Manifest V3), które na stronie
`chess.com/play/...` odczytuje listę rozegranych do tej pory ruchów,
przekazuje je do silnika Stockfish (WASM, `stockfish-18-lite-single`)
działającego lokalnie w Twojej przeglądarce, i wyświetla sugerowany
najlepszy następny ruch jako tekst w prawym dolnym rogu strony.

## Architektura

```
content script (chess.com)  --ruchy SAN-->  background service worker
                                                     |
                                                     v
                                     offscreen document (moduł ES)
                                     chess.js: SAN -> UCI (replay ruchów)
                                                     |
                                                     v
                                     Worker: stockfish-18-lite-single.js/.wasm
                                     "position startpos moves ..." -> "bestmove ..."
```

- **content/content.js** — czyta listę ruchów z `wc-simple-move-list`
  (potwierdzone na realnym HTML-u z gry "play vs computer"): każdy ruch to
  `<div class="node ... main-line-ply" data-node="...">` z opcjonalną ikoną
  figury (`[data-figurine]`, np. `N`/`B`/`R`/`Q`/`K` — brak dla pionów) i
  tekstem docelowego pola/wzięcia (np. `f3`, `xd8`). Łączy je w standardowy
  zapis SAN (`Nf3`, `Bxd8`) i wysyła całą listę ruchów do analizy, gdy się
  zmieni.
- **background/background.js** — service worker MV3; tworzy/utrzymuje
  offscreen document i przekazuje wiadomości między kartą a silnikiem.
- **offscreen/offscreen.js** (moduł ES) — odtwarza listę ruchów SAN za
  pomocą **chess.js** (żeby poprawnie rozstrzygnąć roszady, wzięcia w
  przelocie, promocje i ujednoznacznienie ruchów bez pisania własnego
  parsera reguł szachowych), zamienia je na notację UCI (`e2e4`), uruchamia
  `stockfish-18-lite-single.js` jako Web Workera i prowadzi z nim protokół
  UCI (`position startpos moves ...`, `go movetime 4000`, odbiera
  `bestmove ...`).
- **lib/stockfish/** — pobrane, niemodyfikowane pliki wydania v18.0.0 z
  https://github.com/nmrugg/stockfish.js (licencja GPLv3).
- **lib/chessjs/chess.js** — pobrana, niemodyfikowana biblioteka
  `chess.js` 0.13.4 z https://github.com/jhlywa/chess.js (licencja
  BSD-2-Clause), używana tylko do walidacji/odtworzenia ruchów SAN → UCI.

## Znane ograniczenia

- **Rekonstrukcja SAN z DOM-u** — jeśli chess.com doda dla jakiegoś ruchu
  dodatkowy tekst, którego parser nie oczekuje (np. nietypowa promocja albo
  ujednoznacznienie w innym formacie), `chess.js` zwróci `null` dla tego
  ruchu; `offscreen.js` wtedy **przerywa** odtwarzanie na tym miejscu i
  liczy najlepszy ruch dla pozycji tuż przed nim (loguje ostrzeżenie w
  konsoli offscreen — patrz „Debugowanie" poniżej), więc podpowiedź może
  dotyczyć nieaktualnej pozycji. W praktyce dla zwykłych partii (bez
  bardzo nietypowych zapisów) nie powinno się to zdarzać.
- Rozszerzenie działa tylko na `https://www.chess.com/play/*` (partie
  na żywo / z botem) — nie obsługuje strony analizy.

## Instalacja jako rozszerzenie w Chrome

1. Otwórz `chrome://extensions`.
2. Włącz **Tryb dewelopera** (przełącznik w prawym górnym rogu).
3. Kliknij **Wczytaj rozpakowane** (Load unpacked).
4. Wskaż główny folder tego repozytorium (ten, w którym jest `manifest.json`).
5. Rozszerzenie powinno się pojawić na liście. Otwórz partię na
   `https://www.chess.com/play/...`.
6. Kliknij ikonę rozszerzenia w toolbarze, żeby sprawdzić status, włączyć
   lub wyłączyć podpowiedzi (domyślnie włączone) oraz **ustawić, jakim
   kolorem grasz** (domyślnie Białe). To ustawienie decyduje, kiedy
   rozszerzenie w ogóle liczy ruch — parytet liczby zagranych ruchów
   jednoznacznie mówi, czyja jest tura, więc silnik nie jest odpytywany
   podczas tury przeciwnika (bez sensu liczyć ruch za przeciwnika).
   Jeśli podpowiedzi pojawiają się w złych momentach, sprawdź, czy kolor w
   popupie zgadza się z kolorem, którym faktycznie grasz w tej partii.
7. W prawym dolnym rogu strony powinien się pojawić tekst
   `Chess Supporter — najlepszy ruch: e2 → e4` po ok. 4 sekundach od zmiany
   listy ruchów (czas analizy `movetime` ustawiony na 4000 ms w
   `content/content.js`, `CONFIG.movetimeMs`).

## Debugowanie

- **DevTools konsoli strony chess.com** (F12 → Console): log
  `[ChessSupporter] ruchy (SAN): [...]` przy każdej wykrytej zmianie listy
  ruchów — sprawdź, czy rekonstrukcja SAN wygląda poprawnie.
- **DevTools offscreen document**: `chrome://extensions` → karta
  rozszerzenia → "Inspect views: offscreen.html" — logi
  `[ChessSupporter][engine] ...` pokazują surowe linie UCI z silnika, a
  ostrzeżenie `nie udało się rozpoznać ruchu SAN: ...` pokaże, na którym
  ruchu chess.js odmówił parsowania (jeśli w ogóle).
- Jeśli nic się nie pojawia: sprawdź w konsoli, czy
  `document.querySelector('wc-simple-move-list')` faktycznie coś zwraca na
  otwartej stronie.

## Aktualizacja silnika Stockfish

Pliki w `lib/stockfish/` to niezmodyfikowane wydanie z GitHub Releases
projektu nmrugg/stockfish.js. Aby zaktualizować do nowszej wersji, pobierz
`stockfish-<wersja>-lite-single.js` i `.wasm` z
https://github.com/nmrugg/stockfish.js/releases i zastąp pliki w tym
folderze (zachowując te same nazwy albo aktualizując `ENGINE_URL` w
`offscreen/offscreen.js`).
