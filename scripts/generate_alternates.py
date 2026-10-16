# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["fugashi", "unidic"]
# ///
"""Generate word-level kanji/kana mixes for compound kanji blocks.

    uv run scripts/generate_alternates.py

The quiz already accepts kanji *or* kana for each contiguous kanji block (友達 / 友だち).
A block like 携帯電話 or 一人暮 is really several words, though, and learners often write
one of them in kana (けいたい電話, 一人ぐらし). UniDic splits each written form into words;
when the words' readings add up exactly to Genki's reading, every word-by-word mix is
written to data/alternates/split.json (merged with the hand-checked L*.json by the app).
"""
import itertools
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KANJI = "㐀-鿿々〆ヶ"


def kata2hira(s: str) -> str:
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def clean(s: str, keep_optional: bool) -> str:
    """Drop Genki notation (～, …, X); optional parentheticals are dropped or kept inline."""
    s = s.split("／")[0]
    s = re.sub(r"[（(]([^）)]*)[）)]", r"\1" if keep_optional else "", s)
    return re.sub(r"[～〜…X！!\s]", "", s)


VOICED = dict(zip("かきくけこさしすせそたちつてとはひふへほ", "がぎぐげござじずぜぞだぢづでどばびぶべぼ"))
VOICED.update(dict(zip("はひふへほ", "ぱぴぷぺぽ")))  # h-row also turns into p after っ/ん


def reading_options(r: str) -> list[str]:
    """A word's reading plus its sound-change forms: rendaku (くらし → ぐらし), はく ↔ ぱく, いち → いっ."""
    opts = {r}
    if r and r[0] in "ぱぴぷぺぽ":
        opts.add("はひふへほ"["ぱぴぷぺぽ".index(r[0])] + r[1:])
    if len(r) > 1 and r[-1] in "ちつくき":
        opts |= {o[:-1] + "っ" for o in list(opts)}
    if r and r[0] in "かきくけこさしすせそたちつてと":
        opts.add(VOICED[r[0]] + r[1:])
    if r and r[0] in "はひふへほ":
        opts.add("がぎぐげござじずぜぞだぢづでどばびぶべぼ"["かきくけこさしすせそたちつてとはひふへほ".index(r[0])] + r[1:])
        opts.add("ぱぴぷぺぽ"["はひふへほ".index(r[0])] + r[1:])
    return sorted(opts)


def split_mixes(tagger, form: str, reading: str) -> set[str]:
    """Word-by-word kanji/kana mixes of `form`, or nothing if UniDic's split doesn't fit `reading`."""
    words = [(w.surface, kata2hira(w.feature.kana or w.surface)) for w in tagger(form)]
    if len(words) < 2:
        # One dictionary entry (一人暮らし): try each two-way split of it instead.
        for i in range(1, len(form)):
            halves = [(h, "".join(kata2hira(w.feature.kana or w.surface) for w in tagger(h))) for h in (form[:i], form[i:])]
            for combo in itertools.product(*[reading_options(r) for _, r in halves]):
                if "".join(combo) == reading:
                    choices = [[h, r] if re.search(rf"[{KANJI}]", h) else [h] for (h, _), r in zip(halves, combo)]
                    return {"".join(c) for c in itertools.product(*choices)}
        return set()
    for combo in itertools.islice(itertools.product(*[reading_options(r) for _, r in words]), 256):
        if "".join(combo) == reading:
            choices = [[s, r] if re.search(rf"[{KANJI}]", s) else [s] for (s, _), r in zip(words, combo)]
            return {"".join(c) for c in itertools.product(*choices)}
    return set()


def block_mixes(tagger, form: str, reading: str) -> set[str]:
    """Like split_mixes, but splitting each contiguous kanji block on its own (平和記念資料館)."""
    parts = [p for p in re.split(rf"([{KANJI}]+)", form) if p]
    pattern = "".join("(.+?)" if re.fullmatch(rf"[{KANJI}]+", p) else re.escape(kata2hira(p)) for p in parts)
    m = re.fullmatch(pattern, reading)
    if not m:
        return set()
    choices, g = [], 1
    for p in parts:
        if not re.fullmatch(rf"[{KANJI}]+", p):
            choices.append([p])
            continue
        block_reading = m.group(g)
        g += 1
        choices.append(sorted({p, block_reading} | split_mixes(tagger, p, block_reading)))
    return {"".join(c) for c in itertools.product(*choices)}


def main() -> None:
    import unidic

    if not Path(unidic.DICDIR, "mecabrc").exists():
        subprocess.run([sys.executable, "-m", "unidic", "download"], check=True)
    from fugashi import Tagger

    tagger = Tagger()
    vocab = json.loads((ROOT / "data" / "vocab.json").read_text())
    out: dict[str, list[str]] = {}
    for v, keep in itertools.product(vocab, (False, True)):
        if not v.get("kanji"):
            continue
        form, reading = clean(v["kanji"], keep), kata2hira(clean(v["kana"], keep))
        mixes = (split_mixes(tagger, form, reading) | block_mixes(tagger, form, reading)) - {form, reading}
        if len(mixes) > 64:
            continue
        extra = sorted(x for x in mixes if x)
        if extra:
            out[v["id"]] = sorted(set(out.get(v["id"], [])) | set(extra))
    dest = ROOT / "data" / "alternates" / "split.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=1, sort_keys=True))
    print(f"wrote {sum(map(len, out.values()))} mixed spellings for {len(out)} words to {dest.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
