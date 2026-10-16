# genki-kani 蟹

A WaniKani-style SRS for **Genki II vocabulary (chapters 14–23)**, grouped by chapter.
Every word has two questions — type the **English** for the Japanese, and type the **Japanese** (romaji auto-converts to kana) for the English — plus two example sentences with furigana and audio.

## Layout

```
data/vocab.json          744 words, chapters 14–23 (from the official Genki 3rd ed. vocabulary index)
data/kanji.json          498 kanji used in those words (KANJIDIC2)
data/sentences/L*.json   2 example sentences per word, `漢字[かんじ]` furigana, `{target}` highlighted
frontend/                TypeScript + Vite, no framework
backend/                 Rust (axum) — serves the site and stores progress in one JSON file
scripts/extract_vocab.py regenerates data/vocab.json from the spreadsheet
```

## Run it (with the backend — progress syncs across devices)

```sh
cd frontend && npm install && npm run build && cd ..
cd backend && cargo run --release
# → http://localhost:3002
```

> On this Mac, Homebrew's Rust (1.81) shadows rustup's and is too old for the dependencies.
> Use `~/.cargo/bin/cargo run --release`, or `brew uninstall rust`, or put `~/.cargo/bin` first in `PATH`.

Server env vars:

| var | default | |
|---|---|---|
| `PORT` | `3002` | |
| `DATA_FILE` | `./genki-kani-progress.json` | your progress |
| `STATIC_DIR` | `../frontend/dist` | built frontend |
| `GENKI_KANI_TOKEN` | *(unset)* | if set, the API requires `Authorization: Bearer <token>`; enter it under Settings → Sync |

API: `GET /api/state`, `POST /api/state` (merges items by `updatedAt`), `DELETE /api/state`, `GET /api/health`.

### Docker

```sh
docker build -t genki-kani .
docker run -p 3002:3002 -v genki-kani-data:/data genki-kani
```

## Run it as a purely static site

`frontend/dist` works on any static host (GitHub Pages, Netlify, S3, `python3 -m http.server`).
Without a backend, progress lives in the browser's localStorage — use **Settings → Export** to back it up.
To host the static site separately from the server, set **Settings → Sync → Server API URL** to e.g. `https://my-server.example.com/api` (CORS is open).

## Dev

```sh
cd backend && cargo run          # API on :3002
cd frontend && npm run dev       # Vite on :5173, proxies /api to :3002
```

## Kanji

Kanji are **opt-in** (Settings → Study kanji); by default the app is vocabulary only. When turned on, every kanji used in the chapter 14–23 words (498) is its own SRS item, unlocked with the chapter where it first appears, and a chapter's kanji come before its words in lessons, as on WaniKani. Turning it off again pauses kanji lessons and reviews but keeps their progress. Each kanji is quizzed on:

- **meaning** (any KANJIDIC meaning, with the same typo/synonym rules as words), and
- **on'yomi** and **kun'yomi**, asked separately. A type is asked only if your Genki words actually use it. Any listed reading is accepted (kun'yomi with or without okurigana: た or たべる). Typing the other type gets a nudge ("That's a kun'yomi. We want the on'yomi.") instead of a wrong mark.

Kanji pages show all readings (with the ones Genki uses highlighted), stroke count, grade, frequency, and every Genki word containing the kanji. Word pages link to their kanji. Chapter pages have separate **Practice words** and **Practice kanji** buttons (kanji practice works even with kanji study turned off).

`data/kanji.json` is built from [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) (© EDRDG, CC BY-SA 4.0):

```sh
curl -LO http://www.edrdg.org/kanjidic/kanjidic2.xml.gz
python3 scripts/extract_kanji.py kanjidic2.xml.gz
```

The script decides which readings Genki "uses" by aligning each kanji against the furigana of our words and example sentences, allowing for sound changes (rendaku, っ, verb stems like 割引 → わり).

## Audio (Kokoro TTS)

Every word and sentence has a pre-generated clip from [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) in `frontend/public/audio/` (`<id>.mp3`, `<id>-0.mp3`, `<id>-1.mp3`). The site plays those and falls back to the browser's voice for anything missing. The Rust server serves them with a one-week cache header.

```sh
uv run scripts/generate_audio.py                  # only regenerates clips whose text changed
uv run scripts/generate_audio.py --voice jm_kumo  # voices: jf_alpha (default), jf_gongitsune, jf_nezumi, jf_tebukuro, jm_kumo
uv run scripts/generate_audio.py --force          # regenerate everything (~15 min on an M-series Mac)
```

The first run downloads the model and the UniDic dictionary (~500 MB). It also needs `ffmpeg`. `data/audio-cache.json` records which text and voice each clip was made from, so edits to sentences only regenerate what changed. Kokoro's kanji readings come from UniDic, so each sentence is checked against our furigana, and spans it would misread (誕生日→たんじょう*ひ*, 三本→さん*ぽん*, 金→*かね*) are given to Kokoro in kana. Rebuild the frontend afterwards (`npm run build`) so the clips land in `dist/`.

## How it works

- **Lessons** — batches of 5 (configurable). Study each word (meaning, reading, part of speech, sentences), then pass a quiz to start it at Apprentice I.
- **Reviews** — WaniKani intervals: 4h, 8h, 1d, 2d, 1w, 2w, 1mo, 4mo, then Burned. A wrong answer drops the item `ceil(wrong/2)` stages (×2 at Guru and above).
- **Answer checking** — meant to accept anything a speaker would call correct:
  - English: each `;` part of the gloss, with or without `to …`, parentheticals, `[…]` and `. . .`; slash alternatives (`Mr./Ms.` → mr, ms); small typos; plus hand-audited extra answers per word in `data/meanings/*.json` (～君 → mr, kun).
  - Japanese: kana or kanji, optional parts either way (あんぜん（な）), な-adjectives with or without な (安全な), any kanji/kana mix per word (友だち, けいたい電話, 一人ぐらし), plus hand-audited spellings in `data/alternates/L*.json` (すてき → 素敵). Word-level mixes are generated by `uv run scripts/generate_alternates.py` into `data/alternates/split.json`.
  - If you type a *different* Genki word with an overlapping meaning, the box shakes instead of marking you wrong.
- **"I was right" (R)** — overrides a wrong answer; for English answers, what you typed is saved as a synonym.
- **Keys** — `Enter` submit/next, `F` item info, `R` I was right, `←/→` in lessons.
- **Chapters** — lessons only unlock up to your current chapter (default 14). Move ahead from the Chapters page or Settings. Each chapter has a **Practice** mode that doesn't affect the SRS.
- Reading & Writing (読み書き編) words and end-of-chapter extras are included by default and can be turned off in Settings.

Words already taught in a main lesson of chapters 1–13 are left out even if Genki lists them again later.
