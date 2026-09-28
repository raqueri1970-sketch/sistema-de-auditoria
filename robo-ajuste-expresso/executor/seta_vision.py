# VISAO DO SETA - captura de tela + OCR pt-BR (Windows.Media.Ocr). Somente leitura.
import asyncio, io, re, unicodedata
from PIL import ImageGrab, Image
from winrt.windows.media.ocr import OcrEngine
from winrt.windows.graphics.imaging import BitmapDecoder
from winrt.windows.storage.streams import InMemoryRandomAccessStream, DataWriter
from winrt.windows.globalization import Language

_ENGINE = OcrEngine.try_create_from_language(Language("pt-BR"))
SCALE = 2

def grab(bbox=None):
    return ImageGrab.grab(bbox=bbox, all_screens=False)

def norm(s):
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s.strip().lower())

async def _ocr(img):
    buf = io.BytesIO(); img.save(buf, "PNG")
    stream = InMemoryRandomAccessStream()
    w = DataWriter(stream); w.write_bytes(buf.getvalue()); await w.store_async(); await w.flush_async()
    stream.seek(0)
    dec = await BitmapDecoder.create_async(stream)
    bmp = await dec.get_software_bitmap_async()
    return await _ENGINE.recognize_async(bmp)

def ocr_lines(img, origin=(0, 0)):
    """Retorna lista de linhas: {text, x0, y0, x1, y1, words:[{text,x0,y0,x1,y1}]} em coords de tela."""
    big = img.resize((img.width * SCALE, img.height * SCALE), Image.LANCZOS)
    res = asyncio.run(_ocr(big))
    out = []
    for ln in res.lines:
        words = []
        for wd in ln.words:
            r = wd.bounding_rect
            words.append({"text": wd.text, "x0": origin[0] + r.x / SCALE, "y0": origin[1] + r.y / SCALE,
                          "x1": origin[0] + (r.x + r.width) / SCALE, "y1": origin[1] + (r.y + r.height) / SCALE})
        if not words: continue
        out.append({"text": ln.text, "x0": min(w["x0"] for w in words), "y0": min(w["y0"] for w in words),
                    "x1": max(w["x1"] for w in words), "y1": max(w["y1"] for w in words), "words": words})
    return out

def screen_lines(bbox=None):
    img = grab(bbox)
    return ocr_lines(img, (bbox[0], bbox[1]) if bbox else (0, 0)), img

def find_label(lines, label):
    """Acha a primeira linha/palavra-inicial que comeca com o rotulo (normalizado)."""
    lab = norm(label)
    for ln in lines:
        t = norm(ln["text"])
        if t.startswith(lab): return ln
    return None

def value_right_of(lines, label, min_dx=10):
    """Texto na mesma faixa vertical do rotulo, a direita dele (valor do campo)."""
    lab = find_label(lines, label)
    if not lab: return None
    cy = (lab["y0"] + lab["y1"]) / 2
    n = len(norm(label).split())
    lw = lab["words"][:n]
    x_after = lw[-1]["x1"] if lw else lab["x1"]
    rest = [w for w in lab["words"][n:] if w["x0"] >= x_after]
    others = [w for ln in lines if ln is not lab for w in ln["words"]
              if w["y0"] - 4 <= cy <= w["y1"] + 4 and w["x0"] >= x_after + min_dx]
    ws = sorted(rest + others, key=lambda w: w["x0"])
    return " ".join(w["text"] for w in ws) if ws else ""

def parse_num(s):
    if s is None: return None
    m = re.search(r"-?\d[\d\.]*,\d+|-?\d+", str(s).replace(" ", ""))
    if not m: return None
    t = m.group(0)
    if "," in t: t = t.replace(".", "").replace(",", ".")
    try: return float(t)
    except ValueError: return None

if __name__ == "__main__":
    lines, img = screen_lines((0, 0, 1920, 1080))
    for l in lines: print(f"{l['x0']:.0f},{l['y0']:.0f}  {l['text']}")
    for lab in ("Codigo", "Descricao", "Estoque Atual", "Movimento", "Quantidade", "Novo Estoque", "Motivo", "Observacao"):
        print(lab, "=>", repr(value_right_of(lines, lab)))
