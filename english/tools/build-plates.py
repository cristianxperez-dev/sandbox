"""Build the illustrated plates for the English app: studio renders (PNG + projected anchors) → apps/english/figs/*.webp and
apps/english/plates.js (panels, numbered callouts, overlays, bilingual text). Text is [English, Spanish].
Usage: python3 english/tools/build-plates.py <render-dir>"""
import json, os, sys
from PIL import Image

SRC = sys.argv[1]
ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "english")
OUT = os.path.join(ROOT, "figs")
CROP = {"grip-4s": (0, 0, 800, 700), "grip-2s": (0, 0, 800, 700), "grip-spread-before": (0, 0, 800, 700), "grip-spread-after": (0, 0, 800, 700)}

P = {  # plate id (as used by lesson content) → panels; callout keys match lesson "highlight" values where they exist
    "glove-position": {"note": ["Usually. Around the belt it is a judgement call — many fielders turn the glove to the side.", "Por lo general. A la altura de la cintura es cuestión de criterio: muchos giran el guante de lado."],
        "panels": [
            {"src": "glove-low", "cap": ["Ball below the belt", "Pelota abajo de la cintura"], "callouts": [["fingers", ["Fingers down", "dedos hacia abajo"]], ["pocket", ["Pocket open to the ball", "bolsillo abierto a la pelota"]]], "overlays": [["hline", "belt", ["belt", "cintura"]]]},
            {"src": "glove-high", "cap": ["Ball above the belt", "Pelota arriba de la cintura"], "callouts": [["fingers", ["Fingers up", "dedos hacia arriba"]], ["pocket", ["Pocket to the ball", "bolsillo hacia la pelota"]]], "overlays": [["hline", "belt", ["belt", "cintura"]]]},
        ]},
    "throwing-setup": {"panels": [
            {"src": "throw-set", "cap": ["Feet set, hands apart, ready to throw", "Pies plantados, manos separadas, listo para tirar"], "callouts": [["shoulder", ["Glove shoulder to the target", "hombro del guante hacia el objetivo"]], ["frontFoot", ["Front foot steps to the target", "el pie de adelante va hacia el objetivo"]], ["backFoot", ["Back foot set", "pie de atrás plantado"]]]},
            {"src": "throw-feet", "cap": ["From above: feet in line with the target", "Desde arriba: pies en línea con el objetivo"], "callouts": [["frontToe", ["Toward the target", "hacia el objetivo"]], ["backToe", ["Square to the line", "perpendicular a la línea"]]],
             "overlays": [["arrow", "lineStart", "target", "lane", ["Target", "objetivo"]], ["arrow", "backHeel", "backToe", "foot"], ["arrow", "frontHeel", "frontToe", "foot"]]},
        ]},
    "ready-position": {"panels": [{"src": "ready-position", "callouts": [["feet", ["Feet wider than the shoulders", "pies más abiertos que los hombros"]], ["knees", ["Knees bent", "rodillas flexionadas"]], ["glove", ["Glove out front, open", "guante al frente, abierto"]]]}]},
    "ground-ball": {"panels": [{"src": "ground-ball", "callouts": [["glove", ["Glove out front", "guante al frente"]], ["eyes", ["Eyes on the ball", "la vista en la pelota"]], ["hips", ["Hips down, back flat", "caderas abajo, espalda plana"]]]}]},
    "footwork-angle": {"panels": [{"src": "footwork-angle", "cap": ["From above: ready, first step, then the angle", "Desde arriba: listo, primer paso y el ángulo"],
        "callouts": [["ready", ["Ready", "listo"]], ["step1", ["First step", "primer paso"]], ["step2", ["Crossover", "cruce"]]],
        "overlays": [["path", ["ready", "step1", "step2", "routeEnd"], "route"], ["dot", "ball", ["Ball", "pelota"]]]}]},
    "hand-fingers": {"panels": [{"src": "hand-fingers", "callouts": [["thumb", ["thumb", "el pulgar"]], ["index", ["index finger", "el índice"]], ["middle", ["middle finger", "el dedo medio"]], ["ring", ["ring finger", "el anular"]], ["pinky", ["little finger", "el meñique"]], ["palm", ["palm", "la palma"]]]}]},
    "ball-seams": {"panels": [{"src": "ball-seams", "callouts": [["horseshoe", ["the horseshoe", "la herradura"]], ["stitches", ["the seams", "las costuras"]]]}]},
    "grip-4s": {"panels": [
            {"src": "grip-4s", "cap": ["Fingers across the seams", "Dedos atravesando las costuras"], "callouts": [["index", ["index finger", "el índice"]], ["middle", ["middle finger", "el dedo medio"]], ["seam", ["seam", "la costura"]]]},
            {"src": "grip-thumb-after", "cap": ["Thumb underneath", "El pulgar debajo"], "callouts": [["thumb", ["thumb under the ball", "el pulgar debajo de la pelota"]]]},
        ]},
    "grip-2s": {"panels": [{"src": "grip-2s", "cap": ["Fingers along the seams", "Dedos a lo largo de las costuras"], "callouts": [["index", ["index finger", "el índice"]], ["middle", ["middle finger", "el dedo medio"]], ["seam", ["seam", "la costura"]]]}]},
    "grip-change": {"panels": [{"src": "grip-change", "cap": ["The ball sits deeper in the hand", "La pelota va más adentro de la mano"], "callouts": [["thumb", ["The circle: thumb and index", "el círculo: pulgar e índice"], "circle"], ["middle", ["middle and ring fingers on top", "medio y anular arriba"]]]}]},
    "grip-adjust": {"panels": [
            {"src": "grip-thumb-before", "cap": ["Thumb on the side", "Pulgar de lado"], "callouts": [["thumb", ["thumb", "el pulgar"]]], "tag": "before"},
            {"src": "grip-thumb-after", "cap": ["Thumb moved under", "Pulgar movido debajo"], "callouts": [["thumb", ["thumb", "el pulgar"]]], "tag": "after"},
            {"src": "grip-spread-before", "cap": ["Fingers together", "Dedos juntos"], "callouts": [], "tag": "before"},
            {"src": "grip-spread-after", "cap": ["Fingers spread a little", "Dedos un poco separados"], "callouts": [], "tag": "after"},
        ]},
    "grip-adjust-thumb": {"panels": [
            {"src": "grip-thumb-before", "cap": ["Before: thumb on the side", "Antes: pulgar de lado"], "callouts": [["thumb", ["thumb", "el pulgar"]]], "tag": "before"},
            {"src": "grip-thumb-after", "cap": ["After: thumb under the ball", "Después: pulgar debajo"], "callouts": [["thumb", ["thumb", "el pulgar"]]], "tag": "after"},
        ]},
    "grip-adjust-spread": {"panels": [
            {"src": "grip-spread-before", "cap": ["Before: fingers together", "Antes: dedos juntos"], "callouts": [], "tag": "before"},
            {"src": "grip-spread-after", "cap": ["After: spread a little", "Después: un poco separados"], "callouts": [["index", ["index finger", "el índice"]], ["middle", ["middle finger", "el dedo medio"]]], "tag": "after"},
        ]},
    "delivery-side": {"panels": [{"src": "delivery-side", "cap": ["Foot strike, from the third-base side", "Al caer el pie, desde tercera base"], "callouts": [["head", ["head and balance", "la cabeza y el equilibrio"], "balance"], ["shoulder", ["front shoulder", "el hombro de adelante"]], ["hips", ["hips", "las caderas"]], ["frontFoot", ["stride foot", "el pie de la zancada"], "stride"], ["glove", ["glove", "el guante"]]]}]},
    "delivery-a": {"panels": [{"src": "delivery-a", "cap": ["Rep A, foot strike: the front side is already open", "Repetición A, al caer el pie: el lado de adelante ya se abrió"], "callouts": [["shoulder", ["front shoulder", "el hombro de adelante"]], ["hips", ["hips", "las caderas"]]]}]},
    "delivery-b": {"panels": [{"src": "delivery-b", "cap": ["Rep B, the same moment: the front side stays closed", "Repetición B, el mismo momento: el lado de adelante sigue cerrado"], "callouts": [["shoulder", ["front shoulder", "el hombro de adelante"]], ["hips", ["hips", "las caderas"]]]}]},
}


def main():
    os.makedirs(OUT, exist_ok=True)
    plates, used = {}, set()
    for pid, spec in P.items():
        panels = []
        for p in spec["panels"]:
            src = p["src"]
            if src not in used:
                im = Image.open(os.path.join(SRC, f"{src}.editorial.png")).convert("RGBA")
                if src in CROP: im = im.crop(CROP[src])
                bbox = im.getbbox()   # trim empty margins, keep 4 % air
                pad = int(0.04 * max(im.size))
                if src == "throw-feet": bbox = None   # framed by its own camera
                elif src == "footwork-angle":   # overhead diagram: keep every overlay anchor in frame too, with more air
                    a0 = json.load(open(os.path.join(SRC, f"{src}.editorial.json")))["anchors"]
                    xs = [v[0] * im.width for v in a0.values()] + [bbox[0], bbox[2]]; ys = [v[1] * im.height for v in a0.values()] + [bbox[1], bbox[3]]
                    bbox = (int(min(xs)), int(min(ys)), int(max(xs)) + 1, int(max(ys)) + 1); pad = int(0.07 * max(bbox[2] - bbox[0], bbox[3] - bbox[1]))
                if bbox:
                    x0, y0, x1, y1 = bbox
                    bbox = (max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad))
                im.info["crop"] = bbox
                cropped = im.crop(bbox) if bbox else im
                cropped.save(os.path.join(OUT, f"{src}.webp"), "WEBP", quality=88, method=6)
                used.add(src)
                P_META[src] = {"crop": bbox or (0, 0, im.width, im.height), "full": im.size, "w": cropped.width, "h": cropped.height}
            m = P_META[src]; a = json.load(open(os.path.join(SRC, f"{src}.editorial.json")))["anchors"]
            # remap anchors (normalized in the full render) into the cropped image
            cx0, cy0, cx1, cy1 = m["crop"]; fw, fh = m["full"]
            if src in CROP: fw, fh = 900, 700  # crop box is in full-render pixels
            A = {k: [round((v[0] * fw - cx0) / (cx1 - cx0), 4), round((v[1] * fh - cy0) / (cy1 - cy0), 4)] for k, v in a.items()}
            panels.append({"src": f"figs/{src}.webp", "w": m["w"], "h": m["h"], "cap": p.get("cap"), "tag": p.get("tag"),
                           "callouts": [{"at": A[c[0]], "text": c[1], "key": c[2] if len(c) > 2 else c[0]} for c in p["callouts"]],
                           "overlays": [ov_json(o, A) for o in p.get("overlays", [])]})
        plates[pid] = {"panels": panels, "note": spec.get("note")}
    js = "/* generated by english/tools/build-plates.py from studio renders — do not edit */\nwindow.CPEPlates = " + json.dumps(plates, ensure_ascii=False, separators=(",", ":")) + ";\n"
    open(os.path.join(ROOT, "plates.js"), "w").write(js)
    print(len(plates), "plates,", len(used), "images", sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)) // 1024, "KB")


def ov_json(o, A):
    kind = o[0]
    if kind == "hline": return {"kind": "hline", "y": A[o[1]][1], "text": o[2]}
    if kind == "arrow": return {"kind": "arrow", "from": A[o[1]], "to": A[o[2]], "style": o[3], "text": o[4] if len(o) > 4 else None}
    if kind == "path": return {"kind": "path", "pts": [A[k] for k in o[1]], "style": o[2]}
    if kind == "dot": return {"kind": "dot", "at": A[o[1]], "text": o[2]}


P_META = {}
if __name__ == "__main__": main()
