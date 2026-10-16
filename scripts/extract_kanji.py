"""Build data/kanji.json: every kanji used in the chapter 14+ Genki words.

    curl -LO http://www.edrdg.org/kanjidic/kanjidic2.xml.gz
    python3 scripts/extract_kanji.py kanjidic2.xml.gz

Meanings, readings, stroke counts etc. come from KANJIDIC2 (© EDRDG, CC BY-SA 4.0).
KANJIDIC lists every reading a kanji has ever had, so to decide which on'yomi/kun'yomi
to *ask*, each kanji is aligned against the furigana of our words and example sentences;
readings that actually occur there are marked as "used" (any listed reading is still
accepted as an answer).
"""
import gzip
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KANJI_RE = re.compile(r"[一-鿿]")
RUN = r"[㐀-鿿々〆ヶ]"

DAKU = dict(zip("かきくけこさしすせそたちつてとはひふへほ", "がぎぐげござじずぜぞだぢづでどばびぶべぼ"))
HANDAKU = dict(zip("はひふへほ", "ぱぴぷぺぽ"))
MASU = dict(zip("うくぐすつぬぶむる", "いきぎしちにびみり"))


def k2h(s: str) -> str:
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def variants(r: str) -> set[str]:
    """Sound changes a reading can undergo inside a word: rendaku, p-sounds, small っ."""
    out = {r}
    if r and r[0] in DAKU:
        out.add(DAKU[r[0]] + r[1:])
    if r and r[0] in HANDAKU:
        out.add(HANDAKU[r[0]] + r[1:])
    for v in list(out):
        if len(v) > 1 and v[-1] in "つちくき":
            out.add(v[:-1] + "っ")
    return out


def load_kanjidic(path: str) -> dict[str, dict]:
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rb") as f:
        root = ET.parse(f).getroot()
    out = {}
    for ch in root.iter("character"):
        lit = ch.findtext("literal")
        misc = ch.find("misc")
        rm = ch.find("reading_meaning")
        on, kun, meanings = [], [], []
        if rm is not None:
            for group in rm.iter("rmgroup"):
                for r in group.iter("reading"):
                    if r.get("r_type") == "ja_on":
                        on.append(r.text)
                    elif r.get("r_type") == "ja_kun":
                        kun.append(r.text)
                for m in group.iter("meaning"):
                    if m.get("m_lang") in (None, "en"):
                        meanings.append(m.text)
        out[lit] = {
            "on": on,
            "kun": kun,
            "meanings": meanings,
            "strokes": int(misc.findtext("stroke_count") or 0),
            "grade": int(misc.findtext("grade") or 0) or None,
            "jlpt": int(misc.findtext("jlpt") or 0) or None,
            "freq": int(misc.findtext("freq") or 0) or None,
        }
    return out


def candidates(info: dict) -> list[tuple[str, str, str]]:
    """(surface reading in hiragana, canonical reading as listed, 'on'|'kun') for one kanji."""
    out = []
    for r in info["on"]:
        for v in variants(k2h(r)):
            out.append((v, r, "on"))
    for r in info["kun"]:
        stem = r.split(".")[0].strip("-")
        full = r.replace(".", "").strip("-")
        forms = {stem, full}
        # Verbs appear in compounds in their stem (masu) form: ひく → ひき (割引), たべる → たべ.
        if "." in r and full[-1] in MASU:
            forms.add(full[:-1] + MASU[full[-1]])
            if full.endswith("る"):
                forms.add(full[:-1])
        for form in forms:
            for v in variants(form):
                out.append((v, r, "kun"))
    return out


def align(run: str, reading: str, dic: dict) -> list[tuple[str, str, str]] | None:
    """Split `reading` across the kanji of `run`; returns [(kanji, listed reading, type)] or None."""
    chars = list(run)

    def go(i: int, pos: int, prev: str | None):
        if i == len(chars):
            return [] if pos == len(reading) else None
        c = chars[i]
        if c == "々" and prev:
            c = prev
        info = dic.get(c)
        if not info:
            return None
        for surf, canon, typ in sorted(candidates(info), key=lambda x: -len(x[0])):
            if reading.startswith(surf, pos):
                rest = go(i + 1, pos + len(surf), c)
                if rest is not None:
                    return [(c, canon, typ)] + rest
        return None

    return go(0, 0, None)


def runs_from_word(v: dict) -> list[tuple[str, str]]:
    """(kanji run, its reading) pairs for a vocab entry, via kana anchors between runs."""
    if not v.get("kanji"):
        return []
    clean = lambda s: re.sub(r"[（(][^）)]*[）)]|[～〜…X！!\s]", "", s.split("／")[0])
    form, reading = clean(v["kanji"]), k2h(clean(v["kana"]))
    parts = [p for p in re.split(f"({RUN}+)", form) if p]
    pat = "".join(f"(.+?)" if re.fullmatch(f"{RUN}+", p) else re.escape(k2h(p)) for p in parts)
    m = re.fullmatch(pat, reading)
    if not m:
        return []
    runs = [p for p in parts if re.fullmatch(f"{RUN}+", p)]
    return list(zip(runs, m.groups()))


def runs_from_sentence(ja: str) -> list[tuple[str, str]]:
    return [(m.group(1), k2h(m.group(2))) for m in re.finditer(f"({RUN}+)\\[([^\\]]+)\\]", ja.replace("{", "").replace("}", ""))]


def main(kanjidic_path: str) -> None:
    dic = load_kanjidic(kanjidic_path)
    vocab = json.loads((ROOT / "data" / "vocab.json").read_text())
    sentences: dict[str, list[dict]] = {}
    for f in sorted((ROOT / "data" / "sentences").glob("L*.json")):
        sentences.update(json.loads(f.read_text()))

    kanji: dict[str, dict] = {}
    for v in vocab:
        for c in (v.get("kanji") or ""):
            if KANJI_RE.match(c) and c in dic:
                k = kanji.setdefault(c, {"chapter": v["chapter"], "words": []})
                k["chapter"] = min(k["chapter"], v["chapter"])
                if v["id"] not in k["words"]:
                    k["words"].append(v["id"])

    used: dict[str, dict[str, set[str]]] = {c: {"on": set(), "kun": set()} for c in kanji}
    aligned = failed = 0
    pairs = [p for v in vocab for p in runs_from_word(v)]
    pairs += [p for ss in sentences.values() for s in ss for p in runs_from_sentence(s["ja"])]
    for run, reading in pairs:
        res = align(run, reading, dic)
        if res is None:
            failed += 1
            continue
        aligned += 1
        for c, canon, typ in res:
            if c in used:
                used[c][typ].add(canon)

    out = []
    for c, k in kanji.items():
        info = dic[c]
        u_on = [r for r in info["on"] if r in used[c]["on"]]
        u_kun = [r for r in info["kun"] if r in used[c]["kun"]]
        ask = []
        if u_on:
            ask.append("onyomi")
        if u_kun:
            ask.append("kunyomi")
        if not ask:  # never seen in our furigana: fall back to whichever exists
            ask.append("onyomi" if info["on"] else "kunyomi")
        out.append({
            "id": f"k{c}",
            "char": c,
            "meanings": info["meanings"],
            "on": info["on"],
            "kun": info["kun"],
            "usedOn": u_on,
            "usedKun": u_kun,
            "ask": ask,
            "chapter": k["chapter"],
            "words": k["words"],
            "strokes": info["strokes"],
            "grade": info["grade"],
            "jlpt": info["jlpt"],
            "freq": info["freq"],
        })
    out.sort(key=lambda k: (k["chapter"], k["freq"] or 9999))
    (ROOT / "data" / "kanji.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"{len(out)} kanji; aligned {aligned} reading spans, {failed} couldn't be aligned (irregular readings like 今日)")
    print("asked:", {t: sum(t in k["ask"] for k in out) for t in ("onyomi", "kunyomi")},
          "no used reading:", sum(not k["usedOn"] and not k["usedKun"] for k in out))


if __name__ == "__main__":
    main(sys.argv[1])
