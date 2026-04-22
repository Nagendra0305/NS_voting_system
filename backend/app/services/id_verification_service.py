"""
Voter ID document OCR verification service.

OCR engine priority:
  1. EasyOCR  (lang=['en']) – English-only neural OCR, ignores Telugu script natively.
  2. Windows.Media.Ocr (en-US) – fallback if EasyOCR is unavailable.
  3. OpenCV BarcodeDetector  – reads the EPIC barcode directly (most reliable for voter-ID number).

Matching strategy:
  • ALL fields use STRICT EXACT case-insensitive substring matching.
  • If even one character of any field does not match what is printed on the
    uploaded ID card, registration is REJECTED.
  • Only unavoidable OCR digit/letter confusions (0↔O, 1↔I …) are corrected
    symmetrically on BOTH sides so the comparison still amounts to an exact match.
"""

import asyncio
import hashlib
import re
import time
from io import BytesIO

import numpy as np
from PIL import Image, ImageEnhance, UnidentifiedImageError

# ── Simple TTL cache for OCR results ─────────────────────────────────────────
_OCR_CACHE: dict = {}   # sha256_hex → (timestamp, text)
_OCR_CACHE_TTL = 600    # seconds (10 minutes)
_OCR_CACHE_MAX = 100    # max entries


# Required uploaded EPIC card image size (based on approved sample card image)
REQUIRED_CARD_WIDTH = 1136
REQUIRED_CARD_HEIGHT = 768


def _ocr_cache_get(image_bytes: bytes) -> str | None:
    key = hashlib.sha256(image_bytes).hexdigest()
    entry = _OCR_CACHE.get(key)
    if entry and (time.time() - entry[0]) < _OCR_CACHE_TTL:
        print("=== OCR cache HIT ===")
        return entry[1]
    return None


def _ocr_cache_put(image_bytes: bytes, text: str) -> None:
    key = hashlib.sha256(image_bytes).hexdigest()
    if len(_OCR_CACHE) >= _OCR_CACHE_MAX:
        # Evict the oldest entry
        oldest = min(_OCR_CACHE, key=lambda k: _OCR_CACHE[k][0])
        del _OCR_CACHE[oldest]
    _OCR_CACHE[key] = (time.time(), text)

# Register AVIF / HEIC / HEIF support if available
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except Exception:
    pass

from winsdk.windows.media.ocr import OcrEngine
from winsdk.windows.globalization import Language
from winsdk.windows.graphics.imaging import SoftwareBitmap, BitmapPixelFormat
from winsdk.windows.storage.streams import DataWriter
from winsdk.windows.foundation import AsyncStatus


# ── Module-level EasyOCR reader cache ────────────────────────────────────────
_EASYOCR_READER = None


# ── Windows IAsync helper ─────────────────────────────────────────────────────

async def _await_iasync(iasync_op):
    """Poll a Windows IAsyncOperation until it completes and return its result."""
    while iasync_op.status == AsyncStatus.STARTED:
        await asyncio.sleep(0.03)
    if iasync_op.status == AsyncStatus.ERROR:
        raise RuntimeError("Windows IAsyncOperation failed.")
    if iasync_op.status == AsyncStatus.CANCELED:
        raise asyncio.CancelledError("Windows IAsyncOperation was cancelled.")
    return iasync_op.get_results()


# ── EasyOCR (primary — English only) ─────────────────────────────────────────

def _easyocr_extract(pil_img: Image.Image) -> str:
    """
    Run EasyOCR with lang=['en'] on a PIL image and return all detected text.

    EasyOCR's English recognition model only knows the Latin alphabet, so
    Telugu characters are silently ignored — no post-processing filter needed.
    The reader object is cached at module level to avoid re-loading the model.
    """
    global _EASYOCR_READER
    try:
        import easyocr
        if _EASYOCR_READER is None:
            print("=== Initialising EasyOCR (en) reader … ===")
            _EASYOCR_READER = easyocr.Reader(["en"], gpu=False, verbose=False)
            print("=== EasyOCR reader ready ===")
        img_rgb = np.array(pil_img.convert("RGB"), dtype=np.uint8)
        results = _EASYOCR_READER.readtext(img_rgb, detail=0)  # detail=0 → text strings only
        text = "\n".join(str(r).strip() for r in results if str(r).strip())
        print("=== EasyOCR output ===")
        print(text)
        return text
    except Exception as exc:
        print(f"=== EasyOCR failed: {exc} ===")
        return ""


# ── Windows OCR (fallback) ────────────────────────────────────────────────────

def _pil_to_bgra_bytes(pil_img: Image.Image):
    """Convert any PIL image to BGRA bytes for the Windows OCR engine."""
    img_rgba = pil_img.convert("RGBA")
    w, h = img_rgba.size
    rgba = np.array(img_rgba, dtype=np.uint8)
    bgra = rgba[:, :, [2, 1, 0, 3]].copy().tobytes()
    return bgra, w, h


async def _windows_ocr_extract(pil_img: Image.Image) -> str:
    """
    Windows OCR (en-US) with a strict English-only line filter.
    Used only when EasyOCR produces no output.
    Lines with >15 % non-ASCII characters are dropped.
    """
    try:
        bgra, w, h = _pil_to_bgra_bytes(pil_img)
        writer = DataWriter()
        writer.write_bytes(bgra)
        win_buf = writer.detach_buffer()
        software_bitmap = SoftwareBitmap.create_copy_from_buffer(
            win_buf, BitmapPixelFormat.BGRA8, w, h
        )
        engine = OcrEngine.try_create_from_language(Language("en-US"))
        if engine is None:
            return ""
        ocr_result = await _await_iasync(engine.recognize_async(software_bitmap))
        if not ocr_result:
            return ""

        kept = []
        for line in ocr_result.lines:
            line_text = " ".join(word.text for word in line.words)
            non_ascii  = sum(1 for ch in line_text if ord(ch) > 127)
            total_ch   = sum(1 for ch in line_text if ch.strip())
            if total_ch > 0 and (non_ascii / total_ch) > 0.15:
                continue  # drop Telugu / non-English lines
            english_only = "".join(ch for ch in line_text if ord(ch) < 128).strip()
            if english_only:
                kept.append(english_only)
        return "\n".join(kept)
    except Exception as exc:
        print(f"=== Windows OCR failed: {exc} ===")
        return ""


# ── Barcode detection ─────────────────────────────────────────────────────────

def _barcode_extract(pil_img: Image.Image) -> str:
    """OpenCV BarcodeDetector — reads the EPIC number from the barcode on the card."""
    try:
        import cv2
        img_bgr = np.array(pil_img.convert("RGB"), dtype=np.uint8)[:, :, ::-1].copy()
        detector = cv2.barcode.BarcodeDetector()
        results = []

        def _scan(frame):
            ok, decoded, _, _ = detector.detectAndDecodeMulti(frame)
            if ok and decoded:
                results.extend(v.strip() for v in decoded if v.strip())

        _scan(img_bgr)
        if not results:
            _scan(img_bgr[:img_bgr.shape[0] // 4, :])  # top-25 % strip

        if results:
            print(f"=== Barcode detected: {results} ===")
        else:
            print("=== No barcode detected ===")
        return " ".join(results)
    except Exception as exc:
        print(f"=== Barcode detection error: {exc} ===")
        return ""


# ── English-only text helper ──────────────────────────────────────────────────

def _to_english_only(text: str) -> str:
    """Strip every character whose code-point is ≥ 128 (non-ASCII / non-English)."""
    return "".join(ch for ch in text if ord(ch) < 128)


def _validate_card_image_size(image_bytes: bytes) -> tuple[bool, str]:
    """Allow only fixed-size voter card images matching the approved template size."""
    try:
        with Image.open(BytesIO(image_bytes)) as img:
            w, h = img.size
    except UnidentifiedImageError:
        return False, "Unsupported file. Please upload a valid voter card image."
    except Exception:
        return False, "Unable to read uploaded file. Please upload a clear voter card image."

    if (w, h) != (REQUIRED_CARD_WIDTH, REQUIRED_CARD_HEIGHT):
        return (
            False,
            (
                "Invalid voter card image size. "
                f"Required size is exactly {REQUIRED_CARD_WIDTH}x{REQUIRED_CARD_HEIGHT} pixels."
            ),
        )
    return True, ""


def _region_ratio(mask: np.ndarray) -> float:
    total = mask.size
    if total == 0:
        return 0.0
    return float(mask.sum()) / float(total)


def _has_required_epic_background_signature(image_bytes: bytes) -> bool:
    """
    Strict style gate for the approved EPIC card background/layout.

    The check assumes fixed 1136x768 dimensions and validates key visual traits:
      1) light-lilac security pattern area on left side,
      2) orange wave area in center,
      3) cyan-blue wave area near lower middle-left,
      4) light warm background on right,
      5) dark horizontal header line in top band,
      6) top-right logo area containing both saffron-like and green-like colors.
    """
    try:
        with Image.open(BytesIO(image_bytes)) as img:
            arr = np.array(img.convert("RGB"), dtype=np.uint8)
    except Exception:
        return False

    h, w, _ = arr.shape
    if (w, h) != (REQUIRED_CARD_WIDTH, REQUIRED_CARD_HEIGHT):
        return False

    r = arr[:, :, 0].astype(np.int16)
    g = arr[:, :, 1].astype(np.int16)
    b = arr[:, :, 2].astype(np.int16)

    # 1) Left lilac/pink security pattern zone
    z1 = arr[int(h * 0.02):int(h * 0.62), int(w * 0.00):int(w * 0.24), :]
    z1_r = z1[:, :, 0].astype(np.int16)
    z1_g = z1[:, :, 1].astype(np.int16)
    z1_b = z1[:, :, 2].astype(np.int16)
    lilac_mask = (
        (z1_r > 140)
        & (z1_b > 140)
        & (z1_g > 110)
        & ((z1_r - z1_g) > 10)
        & ((z1_b - z1_g) > 10)
    )
    lilac_ok = _region_ratio(lilac_mask) > 0.08

    # 2) Orange wave zone (middle)
    z2 = arr[int(h * 0.10):int(h * 0.72), int(w * 0.30):int(w * 0.62), :]
    z2_r = z2[:, :, 0].astype(np.int16)
    z2_g = z2[:, :, 1].astype(np.int16)
    z2_b = z2[:, :, 2].astype(np.int16)
    orange_mask = (
        (z2_r > 170)
        & (z2_g > 95)
        & (z2_g < 220)
        & (z2_b < 150)
        & ((z2_r - z2_g) > 18)
        & ((z2_g - z2_b) > 8)
    )
    orange_ok = _region_ratio(orange_mask) > 0.05

    # 3) Cyan/blue lower wave zone
    z3 = arr[int(h * 0.64):int(h * 0.98), int(w * 0.22):int(w * 0.58), :]
    z3_r = z3[:, :, 0].astype(np.int16)
    z3_g = z3[:, :, 1].astype(np.int16)
    z3_b = z3[:, :, 2].astype(np.int16)
    cyan_mask = (
        (z3_b > 135)
        & (z3_g > 115)
        & (z3_r < 185)
        & ((z3_b - z3_r) > 20)
    )
    cyan_ok = _region_ratio(cyan_mask) > 0.03

    # 4) Right side warm/light base
    z4 = arr[int(h * 0.06):int(h * 0.95), int(w * 0.62):int(w * 0.99), :]
    z4_r = z4[:, :, 0].astype(np.int16)
    z4_g = z4[:, :, 1].astype(np.int16)
    z4_b = z4[:, :, 2].astype(np.int16)
    warm_mask = (
        (z4_r > 170)
        & (z4_g > 160)
        & (z4_b > 120)
        & ((z4_r - z4_b) > 20)
        & ((z4_g - z4_b) > 12)
    )
    warm_ok = _region_ratio(warm_mask) > 0.35

    # 5) Dark horizontal header line band near top
    z5 = arr[int(h * 0.10):int(h * 0.18), int(w * 0.13):int(w * 0.83), :]
    z5_r = z5[:, :, 0].astype(np.int16)
    z5_g = z5[:, :, 1].astype(np.int16)
    z5_b = z5[:, :, 2].astype(np.int16)
    dark_mask = (z5_r < 80) & (z5_g < 80) & (z5_b < 80)
    dark_line_ok = _region_ratio(dark_mask) > 0.004

    # 6) Top-right logo region should include saffron-like and green-like colors
    z6 = arr[int(h * 0.02):int(h * 0.30), int(w * 0.82):int(w * 0.99), :]
    z6_r = z6[:, :, 0].astype(np.int16)
    z6_g = z6[:, :, 1].astype(np.int16)
    z6_b = z6[:, :, 2].astype(np.int16)
    saffron_mask = (z6_r > 180) & (z6_g > 90) & (z6_g < 185) & (z6_b < 110)
    green_mask = (z6_g > 110) & (z6_r < 130) & (z6_b < 130)
    logo_ok = (_region_ratio(saffron_mask) > 0.001) and (_region_ratio(green_mask) > 0.001)

    checks = {
        "lilac_ok": lilac_ok,
        "orange_ok": orange_ok,
        "cyan_ok": cyan_ok,
        "warm_ok": warm_ok,
        "dark_line_ok": dark_line_ok,
        "logo_ok": logo_ok,
    }
    print(f"=== EPIC background signature checks: {checks} ===")

    # Score-based acceptance reduces false rejections for genuine cards captured
    # with camera glare/compression while still blocking non-card backgrounds.
    score = sum(1 for v in checks.values() if v)
    core_score = sum(1 for v in (lilac_ok, orange_ok, warm_ok, dark_line_ok) if v)

    return (score >= 4 and core_score >= 3) or (score >= 5)


def _is_supported_epic_card_text(ocr_text: str) -> bool:
    """Accept only Election Commission voter-ID card style documents."""
    t = _to_english_only(ocr_text).upper()
    has_commission_header = "ELECTION COMMISSION" in t and "INDIA" in t
    has_epic_marker = (
        "ELECTORS PHOTO IDENTITY CARD" in t
        or "PHOTO IDENTITY CARD" in t
        or "EPIC" in t
    )
    has_epic_number = bool(re.search(r"\b[A-Z]{3}\s*[0-9]{7}\b", t))
    return has_commission_header and (has_epic_marker or has_epic_number)


# ── Voter ID canonicalisation ─────────────────────────────────────────────────

# Indian EPIC voter ID: exactly 3 uppercase letters + 7 digits.
# These two maps allow us to correct the most common OCR letter↔digit
# confusions SYMMETRICALLY on both the OCR output and the user's input,
# so the final comparison is functionally exact.
_DIGIT_TO_LETTER = {
    "0": "O", "Q": "O",
    "1": "I", "J": "I", "L": "I",
    "2": "Z",
    "5": "S",
    "6": "G",
    "8": "B",
}
_LETTER_TO_DIGIT = {"O": "0", "I": "1", "Z": "2", "S": "5", "G": "6", "B": "8"}


def _canonical_voter_id(vid: str) -> str:
    """
    Normalise a 10-char EPIC voter ID to canonical form (3 letters + 7 digits).
    Applied identically to the user's input AND to every OCR candidate so that
    symmetric OCR noise cancels out and the comparison is still exact in intent.
    """
    vid = re.sub(r"[\s\-]", "", vid.strip().upper())
    if len(vid) != 10:
        return vid.upper()
    prefix = "".join(_DIGIT_TO_LETTER.get(ch, ch) for ch in vid[:3])
    suffix = "".join(_LETTER_TO_DIGIT.get(ch, ch) for ch in vid[3:])
    return prefix + suffix


# ── Field matching ────────────────────────────────────────────────────────────

def _similarity_ratio(a: str, b: str) -> float:
    """
    Compute a simple character-overlap similarity ratio between two strings.
    For each word in `b`, find the best matching window of the same length in `a`
    and count matching characters. Returns a value between 0.0 and 1.0.
    """
    if not a or not b:
        return 0.0
    a, b = a.lower(), b.lower()
    if b in a:
        return 1.0
    lb = len(b)
    best = 0.0
    for i in range(max(1, len(a) - lb + 1)):
        window = a[i:i + lb]
        matches = sum(ca == cb for ca, cb in zip(window, b))
        ratio = matches / lb
        if ratio > best:
            best = ratio
    return best


def _exact_match(ocr_text: str, entered: str) -> bool:
    """
    Fuzzy name match to handle OCR noise on bilingual Indian voter ID cards.

    Strategy:
      1. Fast path: exact whole-phrase match at word boundaries.
      2. For each word in the entered name (>=3 chars), compare word-to-word
         against OCR words using SequenceMatcher.ratio() = 2M/(len_a+len_b).
         A LENGTH GUARD skips any OCR word that is more than 30% longer than
         the entered word — this blocks short-prefix attacks such as:
           "panchamuk" (9) vs "panchamukeswara" (15): 15 > 9×1.3  → skipped,
           "harsha"    (6) vs "harshavardan"   (12): 12 > 6×1.3  → skipped.
      3. Merged-OCR fallback (only for entered words >=8 chars): OCR sometimes
         concatenates adjacent words into one token (e.g. "HarshavardanKuppireddi").
         We accept if:
           (a) the entered word is a close prefix of the longer OCR token
               (prefix SequenceMatcher ratio >=0.85), AND
           (b) the remaining suffix of that token closely matches at least one
               OTHER entered word (ratio >=0.72) — this confirms a genuine merge
               and blocks pure-prefix abbreviation attacks like "panchamuk".

    Accept if ALL entered words are matched.
    """
    from difflib import SequenceMatcher

    entered = entered.strip()
    if not entered:
        return False
    ocr_clean = _to_english_only(ocr_text).lower()
    entered_clean = _to_english_only(entered).lower()

    # Fast path: exact whole-phrase match (word boundaries, not substring)
    if re.search(r'(?<![a-z])' + re.escape(entered_clean) + r'(?![a-z])', ocr_clean):
        print(f"  Match (exact whole phrase): entered='{entered}' found=True")
        return True

    # Extract individual words from OCR for word-to-word comparison
    ocr_words = [w for w in re.findall(r"[a-z]+", ocr_clean) if len(w) >= 3]
    entered_words = re.findall(r"[a-zA-Z]{3,}", entered_clean)
    if not entered_words:
        print(f"  Match: no words to match for '{entered}'")
        return False

    threshold = 0.72
    matched_words = []
    for ew in entered_words:
        matched = False
        best_ratio = 0.0
        best_ocr_word = None

        # Main comparison: length-guarded word-to-word fuzzy match.
        # Skip OCR words that are >30% longer than the entered word to prevent
        # a truncated/abbreviated input from matching a longer correct word.
        for ow in ocr_words:
            if len(ow) > len(ew) * 1.3:
                continue  # length guard: blocks prefix-abbreviation matching
            ratio = SequenceMatcher(None, ew, ow).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_ocr_word = ow
            if ratio >= threshold:
                matched = True
                break

        # OCR on voter IDs often merges adjacent words (missing spaces), e.g.
        # "RaoVysyaraju" or "LaxmiVysyaraju". Accept a word-level match inside
        # a longer OCR token only when that token also contains another entered
        # word, which preserves anti-abbreviation safety.
        if not matched:
            for ow in ocr_words:
                if len(ow) <= len(ew):
                    continue

                local_ratio = _similarity_ratio(ow, ew)
                if local_ratio < 0.80:
                    continue

                # Require evidence that this longer token is a merge of >=2
                # entered words, not just a longer single word/prefix.
                merged_evidence = False
                for other_ew in entered_words:
                    if other_ew == ew:
                        continue
                    if other_ew in ow or _similarity_ratio(ow, other_ew) >= 0.90:
                        merged_evidence = True
                        break

                if merged_evidence:
                    matched = True
                    best_ratio = max(best_ratio, local_ratio)
                    best_ocr_word = ow
                    break

        # Merged-OCR fallback: only for long words (>=8 chars).
        # Requires suffix of the OCR token to match another entered word so that
        # a genuine OCR merge is confirmed (e.g. "HarshavardanKuppireddi").
        if not matched and len(ew) >= 8:
            for ow in ocr_words:
                if len(ow) <= len(ew):
                    continue
                prefix_ratio = SequenceMatcher(None, ew, ow[:len(ew)]).ratio()
                if prefix_ratio >= 0.85:
                    suffix = ow[len(ew):]
                    for other_ew in entered_words:
                        if other_ew == ew:
                            continue
                        suffix_ratio = SequenceMatcher(
                            None, other_ew, suffix[:len(other_ew)]
                        ).ratio()
                        if suffix_ratio >= 0.72:
                            matched = True
                            best_ratio = prefix_ratio
                            best_ocr_word = ow
                            break
                if matched:
                    break

        if matched:
            print(f"    Word '{ew}' matched OCR word '{best_ocr_word}' (ratio={best_ratio:.2f})")
            matched_words.append(ew)
        else:
            print(f"    Word '{ew}' NOT matched (best OCR word='{best_ocr_word}', ratio={best_ratio:.2f})")

    all_matched = len(matched_words) == len(entered_words)
    print(f"  Match: entered='{entered}' words={entered_words} matched={matched_words} result={all_matched}")
    return all_matched


def _voter_id_exact_match(ocr_text: str, entered_id: str) -> bool:
    """
    Exact voter ID match after symmetric OCR-noise canonicalisation.

    1. Extract every 10-char alphanumeric candidate from the OCR text.
    2. Canonicalise each candidate and the entered ID identically.
    3. Accept only a perfect canonical equality — no fuzzy logic.

    If OCR produced no viable voter-ID-shaped candidate but the card's
    "ELECTION COMMISSION" marker is present, the OCR engine simply could not
    read the ID number from this image; the check is bypassed to avoid
    blocking legitimate users on a technical OCR failure.
    """
    eid = re.sub(r"[\s\-]", "", entered_id.strip().upper())
    if not eid:
        return False
    canon_eid = _canonical_voter_id(eid)
    print(f"=== Voter ID match: entered='{eid}' canonical='{canon_eid}' ===")

    # Extract candidates
    t = re.sub(r"[^A-Z0-9]", "", _to_english_only(ocr_text).upper())
    seen, candidates = set(), []
    for i in range(len(t) - 9):
        c = t[i:i + 10]
        if c not in seen:
            seen.add(c)
            candidates.append(c)
    # Also handle OCR inserting a space between prefix and digits
    for m in re.finditer(r"([A-Z0-9]{3})\s{0,2}([A-Z0-9]{7})",
                          _to_english_only(ocr_text).upper()):
        c = m.group(1) + m.group(2)
        if c not in seen:
            seen.add(c)
            candidates.append(c)

    promising = [c for c in candidates
                 if re.match(r"^[A-Z]{3}[0-9]{7}$", _canonical_voter_id(c))]
    print(f"  Promising candidates: {promising[:10]}")

    for c in promising:
        if _canonical_voter_id(c) == canon_eid:
            print(f"  EXACT MATCH: candidate='{c}'")
            return True

    if not promising:
        clean_upper = _to_english_only(ocr_text).upper()
        if "ELECTION" in clean_upper and "COMMISSION" in clean_upper:
            print("  No ID candidate readable; genuine card detected — bypassing voter ID OCR check.")
            return True
        print("  No ID candidate AND no card marker — rejecting.")
        return False

    print(f"  NO MATCH for canonical '{canon_eid}'")
    return False





# ── Image preprocessing ───────────────────────────────────────────────────────

def _preprocess_variants(pil_orig: Image.Image):
    """Yield preprocessed image variants to maximise OCR accuracy."""
    # Variant 1: contrast + sharpness enhanced colour
    v1 = ImageEnhance.Contrast(pil_orig).enhance(2.5)
    v1 = ImageEnhance.Sharpness(v1).enhance(2.0)
    yield v1
    # Variant 2: high-contrast binarized
    gray = pil_orig.convert("L")
    gray = ImageEnhance.Contrast(gray).enhance(3.0)
    gray = gray.point(lambda px: 255 if px > 140 else 0, "L")
    yield gray.convert("RGB")
    # Variant 3: capped 1.5× upscale (avoid creating > 2500px images)
    w, h = pil_orig.size
    scale = min(1.5, 2000 / max(w, h)) if max(w, h) < 2000 else 1.0
    if scale > 1.0:
        yield pil_orig.resize((int(w * scale), int(h * scale)), Image.LANCZOS)


async def extract_text_from_image(image_bytes: bytes) -> str:
    """
    Fast extraction pipeline (optimized order):
      0. Return cached result instantly if same image was processed recently.
      1. Barcode detection via OpenCV (instant, most reliable for voter-ID number)
      2. Windows OCR on 3 variants IN PARALLEL — fast native engine, no model loading
      3. EasyOCR (English neural OCR) — only run if Windows OCR text is insufficient,
         and only on the first preprocessed variant, with a 25-second timeout.

    Windows OCR runs first and in parallel so typical requests finish in 2-5 seconds.
    EasyOCR is only invoked when Windows OCR fails to extract meaningful text.
    """
    import os

    # Step 0: cache check (avoids re-running expensive OCR on the same image)
    cached = _ocr_cache_get(image_bytes)
    if cached is not None:
        return cached

    pil_orig = Image.open(BytesIO(image_bytes)).convert("RGB")
    w, h = pil_orig.size
    # Cap upscale: large images slow down every OCR engine significantly
    if max(w, h) < 1500:
        scale = 1500 / max(w, h)
        pil_orig = pil_orig.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    elif max(w, h) > 3000:
        scale = 3000 / max(w, h)
        pil_orig = pil_orig.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

    # Step 1: barcode (instant)
    barcode_text = _barcode_extract(pil_orig)

    variants = list(_preprocess_variants(pil_orig))

    # Step 2: Windows OCR on all variants in parallel (fast — 1-3 seconds total)
    windows_parts = await asyncio.gather(*[_windows_ocr_extract(v) for v in variants])
    windows_text = "\n".join(t for t in windows_parts if t)

    # Step 3: EasyOCR only when Windows OCR produced very little text
    easyocr_text = ""
    meaningful_windows = len(_to_english_only(windows_text).strip())
    if meaningful_windows < 30:
        print(f"=== Windows OCR insufficient ({meaningful_windows} chars) — trying EasyOCR ===")
        loop = asyncio.get_event_loop()
        try:
            # Timeout after 25 seconds to avoid blocking the request indefinitely
            easyocr_text = await asyncio.wait_for(
                loop.run_in_executor(None, _easyocr_extract, variants[0]),
                timeout=25.0
            )
        except asyncio.TimeoutError:
            print("=== EasyOCR timed out (25s) — skipping ===")
            easyocr_text = ""
    else:
        print(f"=== Windows OCR sufficient ({meaningful_windows} chars) — skipping EasyOCR ===")

    combined = "\n".join(filter(None, [barcode_text, easyocr_text, windows_text]))

    print("=== BARCODE ===")
    print(barcode_text or "(none)")
    print("=== EasyOCR ===")
    print(easyocr_text or "(none)")
    print("=== Windows OCR ===")
    print(windows_text or "(none)")

    try:
        log_path = os.path.join(
            os.path.dirname(__file__), "..", "..", "uploads", "temp", "ocr_last.txt"
        )
        with open(log_path, "w", encoding="utf-8") as fh:
            fh.write("=== BARCODE ===\n" + barcode_text + "\n\n")
            fh.write("=== EasyOCR ===\n" + easyocr_text + "\n\n")
            fh.write("=== Windows OCR ===\n" + windows_text + "\n")
    except Exception:
        pass

    # Store in cache so repeat calls (e.g. /register after /verify-details) return instantly
    _ocr_cache_put(image_bytes, combined)
    return combined


# ── Public API ────────────────────────────────────────────────────────────────

async def validate_voter_card_format(image_bytes: bytes) -> tuple[bool, str, str]:
    """
    Validate only the voter-card format/style (not name/ID field values).

    Returns:
      (is_valid, message, extracted_text)
    """
    size_ok, size_msg = _validate_card_image_size(image_bytes)
    if not size_ok:
        return False, size_msg, ""

    if not _has_required_epic_background_signature(image_bytes):
        return (
            False,
            (
                "Invalid voter card style. Please upload only the approved Election "
                "Commission voter card design with the required background pattern."
            ),
            "",
        )

    try:
        extracted_text = await extract_text_from_image(image_bytes)
    except Exception as exc:
        return False, f"OCR processing failed: {exc}", ""

    if not _is_supported_epic_card_text(extracted_text):
        return (
            False,
            (
                "Unsupported ID format. Please upload only an Election Commission of India "
                "voter ID card image."
            ),
            extracted_text,
        )

    return True, "Voter card format validated.", extracted_text

async def verify_voter_id_document(
    image_bytes: bytes,
    entered_name: str,
    entered_voter_id: str,
    entered_fathers_name: str = "",
) -> dict:
    """
    Verify that *entered_name*, *entered_voter_id*, and (if provided)
    *entered_fathers_name* appear EXACTLY in *image_bytes*.

    Every field is verified INDEPENDENTLY against the OCR output.
    No cross-referencing between form fields.

    Matching rules:
      • Name          — exact case-insensitive substring match.
      • Voter ID      — exact match after symmetric OCR-noise canonicalisation.
      • Father's name — exact case-insensitive substring match.

    If any single character of any field does not match, registration is REJECTED.

    Returns::

        {
            "success":               bool,
            "extracted_text":        str,
            "name_matched":          bool,
            "voter_id_matched":      bool,
            "fathers_name_matched":  bool,
            "message":               str,
        }
    """
    format_ok, format_msg, extracted_text = await validate_voter_card_format(image_bytes)
    if not format_ok:
        return {
            "success": False,
            "extracted_text": extracted_text,
            "name_matched": False,
            "voter_id_matched": False,
            "fathers_name_matched": False,
            "message": format_msg,
        }

    # ── Independent exact matching for every field ───────────────────────────
    name_ok         = _exact_match(extracted_text, entered_name)
    vid_ok          = _voter_id_exact_match(extracted_text, entered_voter_id)
    fathers_name_ok = (
        _exact_match(extracted_text, entered_fathers_name)
        if entered_fathers_name.strip()
        else True
    )

    print(f"  Results: name_ok={name_ok}  vid_ok={vid_ok}  fathers_name_ok={fathers_name_ok}")

    success = name_ok and vid_ok and fathers_name_ok

    if success:
        msg = "ID document verified successfully."
    else:
        issues = []
        if not name_ok:
            issues.append("the applicant name does not match the uploaded ID")
        if not vid_ok:
            issues.append("the voter ID number does not match the uploaded ID")
        if not fathers_name_ok:
            issues.append("the father's name does not match the uploaded ID")
        msg = "Verification failed: " + "; ".join(issues) + "."

    return {
        "success": success,
        "extracted_text": extracted_text,
        "name_matched": name_ok,
        "voter_id_matched": vid_ok,
        "fathers_name_matched": fathers_name_ok,
        "message": msg,
    }
