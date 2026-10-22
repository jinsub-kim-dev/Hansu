Stockfish.js 18 (lite, single-threaded WebAssembly build)
https://github.com/nmrugg/stockfish.js — npm package stockfish@18.0.8, files bin/stockfish-18-lite-single.{js,wasm}

Stockfish (c) the Stockfish developers, Stockfish.js (c) Chess.com, LLC.
Licensed under the GNU General Public License v3 (see COPYING.txt).
Source code: https://github.com/nmrugg/stockfish.js and https://github.com/official-stockfish/Stockfish

The browser loads stockfish-18-lite-single.js as a Web Worker; the script fetches the .wasm file
next to it (same name). When upgrading, keep the version in the file name so caches never serve
a stale engine, and update ENGINE_URL in src/lib/stockfish.ts.
