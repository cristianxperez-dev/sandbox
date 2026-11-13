"""Uniform as a UV-space region mask (crisp cut lines that ignore mesh topology) + smoothed cloth thickness.

Region ids (the runtime shader colours them from a per-team palette):
  0 skin · 1 jersey · 2 pants · 3 belt · 4 undershirt sleeve · 5 socks · 6 shoes · 7 hands (batting gloves / bare) · 8 trim (number) · 9 hair"""
import numpy as np
from PIL import Image, ImageDraw, ImageFont

PART = {"head": 0, "torso": 1, "arm": 2, "hand": 3, "leg": 4, "foot": 5}
THICK = {9: 0.004, 1: 0.026, 2: 0.034, 3: 0.03, 4: 0.006, 5: 0.009, 6: 0.016, 7: 0.007, 0: 0.0, 8: 0.026}


def part_of(b):
    if b in ("head", "neck01", "neck02", "neck03"): return PART["head"]
    if b.startswith(("wrist", "finger", "metacarpal")): return PART["hand"]
    if b.startswith(("lowerarm", "upperarm")): return PART["arm"]
    if b.startswith(("foot", "toe")): return PART["foot"]
    if b.startswith(("lowerleg", "upperleg")): return PART["leg"]
    return PART["torso"]


def features(P, Nrm, dom, B):
    n = len(P); part = np.array([part_of(dom.get(i, "head")) for i in range(n)])
    def along(a, b):
        h, t = B[a]["head"], B[b]["head"]; d = t - h
        return ((P - h) @ d) / (d @ d)
    side = np.where(P[:, 0] >= 0, 1, -1)   # +x = the body's left
    t_arm = np.where(side > 0, along("upperarm01.L", "wrist.L"), along("upperarm01.R", "wrist.R"))
    t_leg = np.where(side > 0, along("upperleg01.L", "foot.L"), along("upperleg01.R", "foot.R"))
    return {"part": part, "y": P[:, 1], "x": P[:, 0], "nz": Nrm[:, 2], "t_arm": t_arm, "t_leg": t_leg}


class Rules:
    def __init__(self, B, number="27"):
        self.belt = B["root"]["head"][1] + 0.105; self.collar = B["neck01"]["head"][1] + 0.012
        self.sh = B["clavicle.L"]["tail"][1]; self.hy = B["head"]["head"][1]
        img = Image.new("L", (200, 160), 0); d = ImageDraw.Draw(img)
        try: font = ImageFont.truetype("DejaVuSans-Bold.ttf", 150)
        except Exception: font = ImageFont.load_default()
        d.text((100, 80), number, fill=255, font=font, anchor="mm"); self.glyph = np.array(img) > 128

    def classify(self, part, y, x, nz, ta, tl):
        r = np.zeros(part.shape, np.uint8)
        head, torso, arm, hand, leg, foot = (part == k for k in range(6))
        hr = np.where((y > self.hy + 0.065) & ~((nz > 0.35) & (y < self.hy + 0.165)), 9, 0)
        hr = np.where((y > self.hy - 0.01) & (nz < -0.55), 9, hr)          # nape
        r[head] = np.where(y[head] < self.collar, 1, hr[head])
        tj = np.where(y > self.belt + 0.02, 1, np.where(y > self.belt - 0.02, 3, 2))
        r[torso] = tj[torso]
        ra = np.where(ta < 0.34, 1, np.where(ta < 0.985, 4, 7)); r[arm] = ra[arm]
        r[hand] = 7
        rl = np.where(tl < 0.6, 2, 5); rl = np.where(y < 0.095, 6, rl); r[leg] = rl[leg]
        r[foot] = np.where(y[foot] < 0.13, 6, 5)
        # number on the back of the jersey
        back = torso & (nz < -0.35) & (r == 1)
        gx = ((0.13 - x) / 0.26 * 200).astype(int); gy = ((self.sh - 0.1 - y) / 0.21 * 160).astype(int)
        ok = back & (gx >= 0) & (gx < 200) & (gy >= 0) & (gy < 160)
        hit = np.zeros_like(ok); hit[ok] = self.glyph[gy[ok], gx[ok]]
        r[hit] = 8
        return r


def mask_texture(tris, VT, feats, rules, N=1024):
    """rasterise every triangle into UV space, classifying each texel from interpolated features"""
    img = np.full((N, N), 255, np.uint8)
    keys = ("y", "x", "nz", "t_arm", "t_leg")
    for (va, ta), (vb, tb), (vc, tc) in tris:
        if min(ta, tb, tc) < 0: continue
        uv = VT[[ta, tb, tc]] * [N, -N] + [0, N]
        x0, y0 = np.floor(uv.min(0)).astype(int) - 1; x1, y1 = np.ceil(uv.max(0)).astype(int) + 1
        x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, N - 1), min(y1, N - 1)
        if x1 < x0 or y1 < y0: continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = uv
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-9: continue
        w0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den; w1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den; w2 = 1 - w0 - w1
        inside = (w0 >= -0.02) & (w1 >= -0.02) & (w2 >= -0.02)
        if not inside.any(): continue
        vs = (va, vb, vc); W = (w0[inside], w1[inside], w2[inside])
        f = {k: sum(W[i] * feats[k][vs[i]] for i in range(3)) for k in keys}
        parts = np.array([feats["part"][v] for v in vs]); part = parts[np.argmax(np.stack(W), axis=0)]
        reg = rules.classify(part, f["y"], f["x"], f["nz"], f["t_arm"], f["t_leg"])
        yy, xx = (ys[inside] - 0.5).astype(int), (xs[inside] - 0.5).astype(int)
        img[yy, xx] = reg
    # dilate across UV seams so sampling at island edges never reads an empty texel
    for _ in range(6):
        empty = img == 255
        if not empty.any(): break
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sh = np.roll(np.roll(img, dy, 0), dx, 1); take = empty & (sh != 255); img[take] = sh[take]; empty = img == 255
    img[img == 255] = 0
    return img


SMOOTH = {9: 0.0, 1: 0.85, 2: 1.0, 3: 0.9, 4: 0.25, 5: 0.35, 6: 0.9, 7: 0.3, 0: 0.0, 8: 0.85}


def cloth_proxy(P, feats, rules, tris, iters=24):
    """garments hide anatomy: Laplacian-smooth the surface under cloth (weighted per fabric) before adding thickness"""
    reg = rules.classify(feats["part"], feats["y"], feats["x"], feats["nz"], feats["t_arm"], feats["t_leg"])
    k = np.array([SMOOTH[int(r)] for r in reg])
    a = np.concatenate([[t[0][0], t[1][0], t[2][0]] for t in tris]); b = np.concatenate([[t[1][0], t[2][0], t[0][0]] for t in tris])
    for _ in range(4):  # blend the weights so garment edges taper
        acc = np.zeros(len(k)); cnt = np.zeros(len(k)); np.add.at(acc, a, k[b]); np.add.at(cnt, a, 1); np.add.at(acc, b, k[a]); np.add.at(cnt, b, 1)
        k = np.where(cnt > 0, 0.5 * k + 0.5 * acc / np.maximum(cnt, 1), k)
    Q = P.copy()
    for _ in range(iters):
        acc = np.zeros_like(Q); cnt = np.zeros(len(Q))
        np.add.at(acc, a, Q[b]); np.add.at(cnt, a, 1); np.add.at(acc, b, Q[a]); np.add.at(cnt, b, 1)
        avg = np.where(cnt[:, None] > 0, acc / np.maximum(cnt, 1)[:, None], Q)
        Q = Q + (avg - Q) * (0.5 * k)[:, None]
    # cleats: a stiff shell over the foot — many more passes so the toes disappear into one shoe shape
    shoe = (reg == 6).astype(float)
    for _ in range(3):
        acc = np.zeros(len(shoe)); cnt = np.zeros(len(shoe)); np.add.at(acc, a, shoe[b]); np.add.at(cnt, a, 1); np.add.at(acc, b, shoe[a]); np.add.at(cnt, b, 1)
        shoe = np.maximum(shoe, acc / np.maximum(cnt, 1))
    for _ in range(60):
        acc = np.zeros_like(Q); cnt = np.zeros(len(Q))
        np.add.at(acc, a, Q[b]); np.add.at(cnt, a, 1); np.add.at(acc, b, Q[a]); np.add.at(cnt, b, 1)
        avg = np.where(cnt[:, None] > 0, acc / np.maximum(cnt, 1)[:, None], Q)
        Q = Q + (avg - Q) * (0.5 * shoe)[:, None]
    return Q


def thickness(feats, rules, tris, n, iters=10):
    part = feats["part"]
    reg = rules.classify(part, feats["y"], feats["x"], feats["nz"], feats["t_arm"], feats["t_leg"])
    th = np.array([THICK[int(r)] for r in reg], float)
    # baggier through the thigh, tapering to the knee; looser at the jersey's lower torso
    th = np.where(reg == 2, th * (1.25 - 0.6 * np.clip(feats["t_leg"], 0, 1)), th)
    # Laplacian smoothing over the mesh so cloth edges blend instead of stepping
    a = np.concatenate([[t[0][0], t[1][0], t[2][0]] for t in tris]); b = np.concatenate([[t[1][0], t[2][0], t[0][0]] for t in tris])
    for _ in range(iters):
        acc = np.zeros(n); cnt = np.zeros(n)
        np.add.at(acc, a, th[b]); np.add.at(cnt, a, 1); np.add.at(acc, b, th[a]); np.add.at(cnt, b, 1)
        th = np.where(cnt > 0, 0.5 * th + 0.5 * acc / np.maximum(cnt, 1), th)
    return th, reg
