import face_recognition
import numpy as np
import cv2
import base64
import hashlib
import os
import time
from typing import Optional, List, Tuple
import json

# ── Simple TTL cache for face encodings ────────────────────────────────────
_ENC_CACHE: dict = {}   # (sha256_hex, is_id) → (timestamp, encoding_or_None)
_ENC_CACHE_TTL = 600    # seconds (10 minutes)
_ENC_CACHE_MAX = 200    # max entries


def _enc_cache_key(image_bytes: bytes, is_id: bool) -> str:
    return hashlib.sha256(image_bytes).hexdigest() + ('_id' if is_id else '_live')


def _enc_cache_get(image_bytes: bytes, is_id: bool):
    key = _enc_cache_key(image_bytes, is_id)
    entry = _ENC_CACHE.get(key)
    if entry and (time.time() - entry[0]) < _ENC_CACHE_TTL:
        print('=== Face encoding cache HIT ===')
        return entry[1], True   # (encoding, hit)
    return None, False


def _enc_cache_put(image_bytes: bytes, is_id: bool, encoding) -> None:
    key = _enc_cache_key(image_bytes, is_id)
    if len(_ENC_CACHE) >= _ENC_CACHE_MAX:
        oldest = min(_ENC_CACHE, key=lambda k: _ENC_CACHE[k][0])
        del _ENC_CACHE[oldest]
    _ENC_CACHE[key] = (time.time(), encoding)

# ── AVIF / HEIF support (pillow-heif) ────────────────────────────────────────
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    _HEIF_AVAILABLE = True
except Exception:
    _HEIF_AVAILABLE = False

from PIL import Image as _PILImage

# ── Model paths ───────────────────────────────────────────────────────────────
_MODEL_DIR    = os.path.join(os.path.dirname(__file__), 'models')
_DNN_PROTOTXT = os.path.join(_MODEL_DIR, 'deploy.prototxt')
_DNN_MODEL    = os.path.join(_MODEL_DIR, 'res10_300x300_ssd_iter_140000.caffemodel')

# ── Cached detectors ──────────────────────────────────────────────────────────
_DNN_NET       = None
_HAAR_CASCADES = {}   # filename → CascadeClassifier


def _get_dnn_net():
    """Load OpenCV Res10-SSD DNN face detector (cached)."""
    global _DNN_NET
    if _DNN_NET is None:
        if os.path.exists(_DNN_PROTOTXT) and os.path.exists(_DNN_MODEL):
            _DNN_NET = cv2.dnn.readNetFromCaffe(_DNN_PROTOTXT, _DNN_MODEL)
            print("=== DNN face detector loaded ===")
        else:
            print("=== DNN model files not found, DNN detector disabled ===")
    return _DNN_NET


def _get_haar(name: str = 'haarcascade_frontalface_default.xml'):
    global _HAAR_CASCADES
    if name not in _HAAR_CASCADES:
        _HAAR_CASCADES[name] = cv2.CascadeClassifier(
            os.path.join(cv2.data.haarcascades, name))
    return _HAAR_CASCADES[name]


# ── DNN face detection ────────────────────────────────────────────────────────

def _dnn_detect(bgr: np.ndarray, res: int = 1200, conf_threshold: float = 0.3) -> list:
    """
    Run the SSD Res10 DNN detector on a BGR image at the given resolution.
    Higher res = better detection of small faces in ID cards.
    Returns (conf, top, right, bottom, left) tuples.
    """
    net = _get_dnn_net()
    if net is None:
        return []
    h, w = bgr.shape[:2]
    blob = cv2.dnn.blobFromImage(
        cv2.resize(bgr, (res, res)), 1.0, (res, res),
        (104.0, 177.0, 123.0), swapRB=False, crop=False)
    net.setInput(blob)
    detections = net.forward()
    boxes = []
    for i in range(detections.shape[2]):
        conf = float(detections[0, 0, i, 2])
        if conf < conf_threshold:
            continue
        x1 = max(0, int(detections[0, 0, i, 3] * w))
        y1 = max(0, int(detections[0, 0, i, 4] * h))
        x2 = min(w - 1, int(detections[0, 0, i, 5] * w))
        y2 = min(h - 1, int(detections[0, 0, i, 6] * h))
        if x2 > x1 and y2 > y1:
            boxes.append((conf, y1, x2, y2, x1))  # conf, top, right, bottom, left
    return sorted(boxes, key=lambda b: -b[0])


def _dnn_face_crops(bgr: np.ndarray, rgb: np.ndarray,
                    res: int = 1200, conf_threshold: float = 0.05,
                    pad_fraction: float = 0.4,
                    min_crop_size: int = 300) -> list:
    """
    Use CNN to find face locations, then return (label, upscaled_crop_rgb) for
    each detected face region (padded and upscaled to ≥min_crop_size).
    This lets face_recognition encode small printed faces by working on an
    enlarged, tightly-focused crop.
    """
    net = _get_dnn_net()
    if net is None:
        return []
    h, w = bgr.shape[:2]
    results = []
    for resolution in (1200, 900, 600, 300):
        blob = cv2.dnn.blobFromImage(
            cv2.resize(bgr, (resolution, resolution)), 1.0,
            (resolution, resolution), (104.0, 177.0, 123.0), False, False)
        net.setInput(blob)
        dets = net.forward()
        for i in range(dets.shape[2]):
            conf = float(dets[0, 0, i, 2])
            if conf < conf_threshold:
                continue
            x1 = max(0, int(dets[0, 0, i, 3] * w))
            y1 = max(0, int(dets[0, 0, i, 4] * h))
            x2 = min(w - 1, int(dets[0, 0, i, 5] * w))
            y2 = min(h - 1, int(dets[0, 0, i, 6] * h))
            if x2 <= x1 or y2 <= y1:
                continue
            fw, fh = x2 - x1, y2 - y1
            # Add padding
            px = int(fw * pad_fraction)
            py = int(fh * pad_fraction)
            cx1 = max(0, x1 - px);  cy1 = max(0, y1 - py)
            cx2 = min(w, x2 + px);  cy2 = min(h, y2 + py)
            crop = rgb[cy1:cy2, cx1:cx2]
            if crop.size == 0:
                continue
            crop_up = _upscale(crop, target=max(min_crop_size, max(crop.shape[:2]) * 4))
            results.append((f"dnn-conf{conf:.2f}@{resolution}", crop_up))
        if results:
            print(f"  DNN found {len(results)} face crop(s) at res={resolution} conf>={conf_threshold}")
            return results
    return results


def _dnn_boxes_permissive(bgr: np.ndarray, is_id: bool = False) -> list:
    """
    Try DNN at multiple resolutions and confidence thresholds.
    Returns (top, right, bottom, left) tuples — same as face_recognition API.
    Uses a prioritised list of (resolution, threshold) pairs so the most
    likely combination is tried first and we return as early as possible.
    """
    if is_id:
        # For ID cards: high resolution matters more for small printed faces
        combos = [
            (1200, 0.30), (1200, 0.15),
            (900,  0.30), (900,  0.15),
            (600,  0.30), (600,  0.15),
            (1200, 0.07), (900, 0.07), (600, 0.07),
            (300,  0.30), (300, 0.15), (300, 0.07), (300, 0.03),
        ]
    else:
        # For live/selfie photos: low resolution is fast and sufficient
        combos = [
            (300, 0.50), (600, 0.30), (300, 0.30), (600, 0.15), (300, 0.15),
        ]
    for (res, thresh) in combos:
        boxes = [b[1:] for b in _dnn_detect(bgr, res=res, conf_threshold=thresh)]
        if boxes:
            print(f"  DNN detected face(s) at res={res} conf>={thresh}")
            return boxes
    return []


# ── Robust multi-format image loader ─────────────────────────────────────────

def _load_bgr_from_bytes(image_data: bytes) -> Optional[np.ndarray]:
    """
    Load image bytes → BGR numpy array (uint8, C-contiguous).
    Handles JPEG, PNG, WebP, AVIF, HEIC and any format Pillow can open.
    When PIL is used as a fallback (AVIF/HEIC), the image is normalized
    through an in-memory JPEG encode/decode to ensure 100% cv2-compatible output.
    Returns None if all methods fail.
    """
    # 1. Try OpenCV directly (fastest — handles JPEG/PNG/WebP/BMP/TIFF)
    nparr = np.frombuffer(image_data, np.uint8)
    bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if bgr is not None:
        return bgr

    # 2. Fallback via Pillow → normalize through JPEG in-memory round-trip
    # This guarantees a cv2-compatible uint8 C-contiguous BGR array
    # regardless of the source format (AVIF, HEIC, WEBP, etc.)
    try:
        import io as _io
        pil = _PILImage.open(_io.BytesIO(image_data)).convert('RGB')
        buf = _io.BytesIO()
        pil.save(buf, format='JPEG', quality=95)
        buf.seek(0)
        bgr = cv2.imdecode(np.frombuffer(buf.getvalue(), np.uint8), cv2.IMREAD_COLOR)
        if bgr is not None:
            print(f"  Image loaded via Pillow+JPEG normalization (shape={bgr.shape})")
            return bgr
    except Exception as e:
        print(f"  Pillow fallback failed: {e}")

    return None



_HAAR_NAMES = [
    'haarcascade_frontalface_default.xml',
    'haarcascade_frontalface_alt.xml',
    'haarcascade_frontalface_alt2.xml',
    'haarcascade_frontalface_alt_tree.xml',
    'haarcascade_profileface.xml',
]

def _haar_boxes_multi(gray: np.ndarray) -> list:
    """Try all 5 Haar cascades with progressively lenient settings."""
    for name in _HAAR_NAMES:
        cc = _get_haar(name)
        for (sf, mn, ms) in [(1.05, 3, 30), (1.03, 2, 20), (1.02, 1, 15)]:
            faces = cc.detectMultiScale(
                gray, scaleFactor=sf, minNeighbors=mn,
                minSize=(ms, ms), flags=cv2.CASCADE_SCALE_IMAGE)
            if isinstance(faces, np.ndarray) and len(faces) > 0:
                boxes = [(y, x + w, y + h, x) for (x, y, w, h) in faces]
                print(f"  Haar detected via {name}")
                return boxes
    return []


# ── Image enhancement helpers ─────────────────────────────────────────────────

def _enhance(rgb: np.ndarray) -> np.ndarray:
    """CLAHE contrast enhancement — helps with printed/faded ID card photos."""
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    l, a, b = cv2.split(lab)
    l = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(l)
    return cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2RGB)


def _enhance_aggressive(rgb: np.ndarray) -> np.ndarray:
    """Aggressive histogram equalisation on gray channel + sharpen."""
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    eq = cv2.equalizeHist(gray)
    kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]], dtype=np.float32)
    sharpened = cv2.filter2D(eq, -1, kernel)
    return cv2.cvtColor(sharpened, cv2.COLOR_GRAY2RGB)


def _enhance_gamma(rgb: np.ndarray, gamma: float = 1.5) -> np.ndarray:
    """Gamma correction to brighten dark printed photos."""
    inv = 1.0 / gamma
    table = np.array([((i / 255.0) ** inv) * 255 for i in range(256)], dtype=np.uint8)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    return cv2.cvtColor(cv2.LUT(bgr, table), cv2.COLOR_BGR2RGB)


def _enhance_denoise(rgb: np.ndarray) -> np.ndarray:
    """Non-local means denoising — good for printed / scanned IDs."""
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    denoised = cv2.fastNlMeansDenoisingColored(bgr, None, 10, 10, 7, 21)
    return cv2.cvtColor(denoised, cv2.COLOR_BGR2RGB)


def _enhance_sharpen(rgb: np.ndarray) -> np.ndarray:
    """Unsharp-mask sharpening to recover printed-photo details."""
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    blurred = cv2.GaussianBlur(bgr, (0, 0), 3)
    sharp = cv2.addWeighted(bgr, 1.5, blurred, -0.5, 0)
    return cv2.cvtColor(sharp, cv2.COLOR_BGR2RGB)


def _upscale(img: np.ndarray, target: int = 1800) -> np.ndarray:
    h, w = img.shape[:2]
    if max(h, w) >= target:
        return img
    scale = target / max(h, w)
    return cv2.resize(img, (int(w * scale), int(h * scale)),
                      interpolation=cv2.INTER_CUBIC)


class FaceRecognitionService:
    def __init__(self):
        self.tolerance = 0.6

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _locs_dnn(self, bgr: np.ndarray, is_id: bool = False) -> list:
        """SSD ResNet10 DNN detector — most reliable for printed/small photos."""
        return _dnn_boxes_permissive(bgr, is_id=is_id)

    def _locs_hog_fast(self, rgb: np.ndarray) -> list:
        """Quick single-pass HOG detector at upsample=1 — ideal for live/selfie photos."""
        try:
            rgb3 = np.array(rgb[:, :, :3] if rgb.shape[2] == 4 else rgb,
                            dtype=np.uint8, order='C')
            return face_recognition.face_locations(rgb3,
                        number_of_times_to_upsample=1, model='hog')
        except Exception:
            return []

    def _locs_hog(self, rgb: np.ndarray, max_upsample: int = 2) -> list:
        """HOG detector. Caps upsample to avoid memory issues on large images."""
        rgb = np.array(rgb[:, :, :3] if rgb.ndim == 3 and rgb.shape[2] == 4 else rgb,
                       dtype=np.uint8, order='C')
        h, w = rgb.shape[:2]
        # Each HOG upsample doubles image size (4x = 16× memory!) — cap for large images
        max_dim = max(h, w)
        if max_dim > 1200:
            safe_max = 1
        elif max_dim > 600:
            safe_max = 2
        else:
            safe_max = max_upsample
        for ups in range(1, safe_max + 1):
            try:
                locs = face_recognition.face_locations(rgb,
                            number_of_times_to_upsample=ups, model='hog')
                if locs:
                    return locs
            except Exception as e:
                print(f"  HOG ups={ups} failed: {e}")
                break
        return []

    def _locs_cnn(self, rgb: np.ndarray) -> list:
        """dlib CNN/HOG detector — accurate for small/printed photos."""
        try:
            if rgb.dtype != np.uint8:
                rgb = np.clip(rgb, 0, 255).astype(np.uint8)
            if not rgb.flags['C_CONTIGUOUS']:
                rgb = np.ascontiguousarray(rgb)
            return face_recognition.face_locations(rgb, model='cnn')
        except Exception as e:
            print(f"  CNN detector error: {e}")
            return []

    def _locs_haar(self, rgb: np.ndarray) -> list:
        """All 5 Haar cascades with progressive leniency."""
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        locs = _haar_boxes_multi(gray)
        if locs:
            return locs
        eq = cv2.equalizeHist(gray)
        return _haar_boxes_multi(eq)

    def _first_encoding(self, rgb: np.ndarray, locs: list) -> Optional[np.ndarray]:
        """Generate 128-d face encoding from image + known locations. Returns None on any failure."""
        try:
            # face_recognition / dlib requires 8-bit contiguous 3-channel RGB
            if rgb.ndim == 3 and rgb.shape[2] == 4:
                rgb = rgb[:, :, :3]
            rgb = np.array(rgb, dtype=np.uint8, order='C')
            encs = face_recognition.face_encodings(rgb, locs)
            return encs[0] if encs else None
        except Exception as e:
            print(f"  face_encodings failed (likely face too small): {e}")
            return None

    def _detect_and_encode(self, rgb: np.ndarray, bgr: np.ndarray = None,
                            use_cnn: bool = False, is_id: bool = False) -> Optional[np.ndarray]:
        """
        Run all detectors in order: DNN → HOG → Haar → CNN.
        is_id=True uses higher-resolution DNN and more HOG upsample passes.
        Returns numpy encoding or None.
        """
        if bgr is None:
            bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

        # ── Normalise: ensure 8-bit, 3-channel, C-contiguous, RGB ────────────
        if rgb.ndim == 3 and rgb.shape[2] == 4:
            rgb = rgb[:, :, :3]
        rgb = np.array(rgb, dtype=np.uint8, order='C')
        bgr = np.array(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), dtype=np.uint8, order='C')

        # For live/selfie photos: try fast HOG first (much faster for clear frontal faces)
        if not is_id:
            locs = self._locs_hog_fast(rgb)
            if locs:
                enc = self._first_encoding(rgb, locs)
                if enc is not None:
                    print("  Detected via HOG (fast)")
                    return enc

        # 1. DNN SSD (best for printed photos) — use high res for ID documents
        locs = self._locs_dnn(bgr, is_id=is_id)
        if locs:
            enc = self._first_encoding(rgb, locs)
            if enc is not None:
                print("  Detected via DNN SSD")
                return enc

        # 2. HOG — use more upsample passes for ID card crops (small faces)
        hog_ups = 3 if is_id else 2
        locs = self._locs_hog(rgb, max_upsample=hog_ups)
        if locs:
            enc = self._first_encoding(rgb, locs)
            if enc is not None:
                print("  Detected via HOG")
                return enc

        # 3. Haar cascade (all variants, very permissive) — skip for live/selfie photos
        if is_id:
            locs = self._locs_haar(rgb)
            if locs:
                enc = self._first_encoding(rgb, locs)
                if enc is not None:
                    print("  Detected via Haar")
                    return enc

        # 4. dlib CNN (accurate but slower — ID docs or last resort)
        if use_cnn:
            locs = self._locs_cnn(rgb)
            if locs:
                enc = self._first_encoding(rgb, locs)
                if enc is not None:
                    print("  Detected via dlib CNN")
                    return enc

        return None

    # ── ID-card region crops ──────────────────────────────────────────────────

    def _id_card_crops(self, rgb: np.ndarray) -> list:
        """
        Return (label, cropped_rgb) for all common Indian EPIC card layouts.

        Layout A — e-EPIC digital card:
            Face photo in TOP-RIGHT corner (~25% card width)
        Layout B — physical/old-style EPIC card:
            Large photo in CENTRE-LEFT (~45% card width, full height)
        """
        h, w = rgb.shape[:2]
        regions = [
            # label,            row0%  row1%  col0%  col1%
            # ── Layout A: top-right ──────────────────────────────────────────
            ('A-tight',         0.03,  0.60,  0.68,  1.00),
            ('A-wide',          0.00,  0.68,  0.60,  1.00),
            ('A-wider',         0.00,  0.80,  0.52,  1.00),
            # ── Layout B: centre-left ────────────────────────────────────────
            ('B-centre-left',   0.08,  0.92,  0.00,  0.48),
            ('B-left-inset',    0.12,  0.88,  0.02,  0.52),
            ('B-left-wide',     0.03,  0.97,  0.00,  0.58),
            # ── Half-image fallbacks ─────────────────────────────────────────
            ('left-half',       0.00,  1.00,  0.00,  0.55),
            ('right-half',      0.00,  1.00,  0.45,  1.00),
            ('top-strip',       0.00,  0.60,  0.00,  1.00),
            ('full',            0.00,  1.00,  0.00,  1.00),
        ]
        crops = []
        for (label, rs, re, cs, ce) in regions:
            r0, r1 = int(h * rs), int(h * re)
            c0, c1 = int(w * cs), int(w * ce)
            crop = rgb[r0:r1, c0:c1]
            if crop.size == 0:
                continue
            crop = _upscale(crop, target=1200)
            crops.append((label, crop))
        return crops

    # ── Build preprocessing variants ─────────────────────────────────────────

    def _id_variant_fns(self, rgb: np.ndarray) -> list:
        """
        Return a list of callables that each produce one preprocessing variant.
        Variants are computed LAZILY — only called when actually needed.
        Slow operations (denoise) are placed last so they are skipped when
        an earlier variant already succeeds.
        """
        # Use default-argument capture so each lambda is independent of loop vars
        return [
            lambda _r=rgb: _r,
            lambda _r=rgb: _enhance(_r),
            lambda _r=rgb: _enhance_sharpen(_r),
            lambda _r=rgb: _enhance_gamma(_r, 1.8),
            lambda _r=rgb: _enhance_gamma(_r, 0.7),
            lambda _r=rgb: _enhance_aggressive(_r),
            lambda _r=rgb: _enhance(_enhance_sharpen(_r)),
            lambda _r=rgb: _enhance_denoise(_r),   # slow — absolute last resort
        ]

    # ── Public: extract encoding ──────────────────────────────────────────────

    def extract_face_encoding(self, image_data: bytes,
                               is_id_document: bool = False) -> Optional[List[float]]:
        """
        Extract a 128-d face encoding from image bytes.
        Results are cached by image hash for 10 minutes so repeated calls
        (e.g. /verify-details then /register with the same file) return instantly.
        """
        cached_enc, hit = _enc_cache_get(image_data, is_id_document)
        if hit:
            return cached_enc  # may be None (face-not-found also cached)

        result = self._extract_face_encoding_inner(image_data, is_id_document)
        _enc_cache_put(image_data, is_id_document, result)
        return result

    def _extract_face_encoding_inner(self, image_data: bytes,
                                     is_id_document: bool = False) -> Optional[List[float]]:
        """
        Extract a 128-d face encoding from image bytes.
        Supports JPEG, PNG, WebP, AVIF, HEIC via robust multi-format loader.
        is_id_document=True activates:
          - High-res DNN (1200px) to locate small printed faces
          - DNN crop-and-upscale: enlarges detected region 4× before encoding
          - 4× HOG upsample on tight crops
          - Region-based crops covering all Indian EPIC card layouts
          - 6 preprocessing variants (CLAHE, sharpen, denoise, gamma, eq)
        """

        try:
            bgr = _load_bgr_from_bytes(image_data)
            if bgr is None:
                print("  Could not decode image (unsupported format or corrupt)")
                return None

            bgr = _upscale(bgr, target=1600 if is_id_document else 900)
            # Always convert to a clean, contiguous, 8-bit 3-channel BGR/RGB pair
            bgr = np.array(bgr, dtype=np.uint8, order='C')
            rgb = np.array(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), dtype=np.uint8, order='C')

            # ── Strategy 1: full-image, lazy preprocessing variants ───────────
            # Variants are generated on-demand so slow ops (denoise) are skipped
            # whenever an earlier variant succeeds.
            if is_id_document:
                variant_fns = self._id_variant_fns(rgb)
            else:
                variant_fns = [lambda _r=rgb: _r, lambda _r=rgb: _enhance(_r)]

            for vfn in variant_fns:
                try:
                    variant = vfn()
                except Exception:
                    continue
                if variant.ndim == 3 and variant.shape[2] == 4:
                    variant = variant[:, :, :3]
                v_bgr = cv2.cvtColor(variant, cv2.COLOR_RGB2BGR)
                enc = self._detect_and_encode(variant, v_bgr,
                                               use_cnn=is_id_document,
                                               is_id=is_id_document)
                if enc is not None:
                    return enc.tolist()

            if not is_id_document:
                return None

            # ── Strategy 2: DNN crop-and-upscale (key for small printed faces) ─
            # DNN locates where the face IS, even if small.  We then crop + upscale
            # that region so face_recognition can generate a proper encoding.
            print("  Trying DNN crop-and-upscale strategy...")
            for variant in [rgb, _enhance(rgb), _enhance_sharpen(rgb), _enhance_gamma(rgb, 1.8)]:
                if variant.ndim == 3 and variant.shape[2] == 4:
                    variant = variant[:, :, :3]
                v_bgr = cv2.cvtColor(variant, cv2.COLOR_RGB2BGR)
                dnn_crops = _dnn_face_crops(v_bgr, variant, min_crop_size=600)
                for (label, face_crop) in dnn_crops:
                    if face_crop.ndim == 3 and face_crop.shape[2] == 4:
                        face_crop = face_crop[:, :, :3]
                    crop_bgr = cv2.cvtColor(face_crop, cv2.COLOR_RGB2BGR)
                    # Run all detectors on the enlarged face-only crop
                    for crop_var in [face_crop, _enhance(face_crop), _enhance_sharpen(face_crop)]:
                        if crop_var.ndim == 3 and crop_var.shape[2] == 4:
                            crop_var = crop_var[:, :, :3]
                        cv_bgr = cv2.cvtColor(crop_var, cv2.COLOR_RGB2BGR)
                        enc = self._detect_and_encode(crop_var, cv_bgr, use_cnn=True, is_id=True)
                        if enc is not None:
                            print(f"  ID face encoded from DNN crop: {label}")
                            return enc.tolist()

            # ── Strategy 3: region crops x every preprocessing variant ─────────
            print("  Trying region crops...")
            for (label, crop) in self._id_card_crops(rgb):
                for variant in [crop, _enhance(crop), _enhance_sharpen(crop),
                                _enhance_gamma(crop, 1.8), _enhance_aggressive(crop),
                                _enhance_denoise(crop)]:
                    if variant.ndim == 3 and variant.shape[2] == 4:
                        variant = variant[:, :, :3]
                    v_bgr = cv2.cvtColor(variant, cv2.COLOR_RGB2BGR)
                    enc = self._detect_and_encode(variant, v_bgr, use_cnn=True, is_id=True)
                    if enc is not None:
                        print(f"  ID face found in region: {label}")
                        return enc.tolist()

            return None

        except Exception as e:
            print(f"Error extracting face encoding: {e}")
            import traceback; traceback.print_exc()
            return None
    
    def verify_face(self, live_encoding: List[float], stored_encoding_str: str, tolerance: float = None) -> bool:
        """Verify if two face encodings match"""
        try:
            stored_encoding = json.loads(stored_encoding_str)
            
            # Convert to numpy arrays
            live_enc = np.array(live_encoding)
            stored_enc = np.array(stored_encoding)
            
            # Compare faces
            distance = face_recognition.face_distance([stored_enc], live_enc)[0]
            tol = tolerance if tolerance is not None else self.tolerance
            print(f"  Face distance: {distance:.4f} (tolerance={tol})")
            return distance <= tol
        
        except Exception as e:
            print(f"Error verifying face: {e}")
            return False

    def is_duplicate_face(self, live_encoding: List[float], stored_encoding_str: str) -> bool:
        """Strict duplicate check for registration — uses tighter tolerance to avoid false positives."""
        # 0.45 is strict enough to flag the same person while avoiding false matches
        # between genuinely different people (default 0.6 is for login leniency)
        return self.verify_face(live_encoding, stored_encoding_str, tolerance=0.45)
    
    def base64_to_image(self, base64_string: str) -> bytes:
        """Convert base64 string to image bytes"""
        try:
            # Remove data:image/jpeg;base64, prefix if present
            if ',' in base64_string:
                base64_string = base64_string.split(',')[1]
            
            image_bytes = base64.b64decode(base64_string)
            return image_bytes
        
        except Exception as e:
            print(f"Error converting base64 to image: {e}")
            return None
    
    def detect_face_in_image(self, image_data: bytes) -> bool:
        """Check if a face is present in the image."""
        try:
            bgr = _load_bgr_from_bytes(image_data)
            if bgr is None:
                return False
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            return self._detect_and_encode(rgb, bgr, use_cnn=False) is not None
        except Exception as e:
            print(f"Error detecting face: {e}")
            return False

    def compare_id_face_with_live(self, id_image_data: bytes, live_image_data: bytes) -> dict:
        """
        Extract the face photo printed on a voter ID card and compare it
        with a live face capture.

        Returns a dict with:
          match            – bool
          id_face_found    – bool (False = ID card face could not be detected)
          confidence       – 0-100 float
          distance         – raw face-distance
          message          – human-readable result string
        """
        try:
            id_encoding = self.extract_face_encoding(id_image_data, is_id_document=True)
            if id_encoding is None:
                return {
                    "match": False,
                    "id_face_found": False,
                    "confidence": 0,
                    "distance": 1.0,
                    "message": "Could not detect a face in the voter ID document photo.",
                }

            live_encoding = self.extract_face_encoding(live_image_data)
            if live_encoding is None:
                return {
                    "match": False,
                    "id_face_found": True,
                    "confidence": 0,
                    "distance": 1.0,
                    "message": "No face detected in the live photo. "
                               "Please retake your photo in good lighting.",
                }

            id_arr = np.array(id_encoding)
            live_arr = np.array(live_encoding)
            distance = float(face_recognition.face_distance([id_arr], live_arr)[0])
            match = distance <= self.tolerance
            confidence = round(max(0.0, (1.0 - distance)) * 100, 1)

            return {
                "match": match,
                "id_face_found": True,
                "confidence": confidence,
                "distance": round(distance, 4),
                "message": (
                    "Face matches the voter ID document." if match
                    else "Your live photo does not match the face on the voter ID document."
                ),
            }

        except Exception as e:
            print(f"Error comparing ID face with live face: {e}")
            return {
                "match": False,
                "confidence": 0,
                "distance": 1.0,
                "message": f"Face comparison error: {str(e)}",
            }

face_service = FaceRecognitionService()
