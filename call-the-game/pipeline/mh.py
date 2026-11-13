"""MakeHuman (CC0) body builder: base mesh + macro targets → athletic body; skeleton from the default rig's joint vertex groups;
skin weights from default_weights.mhw (facial / toe / breast bones folded into their kept ancestors)."""
import json, os, numpy as np

MH = os.environ.get("MH_DATA", "/home/user/makehumancommunity/makehuman/makehuman/data")
KEEP_EXCLUDE = ("levator", "oris", "oculi", "orbicularis", "risorius", "temporalis", "tongue", "special", "breast", "jaw", "toe", "eye")


def load_obj(path=f"{MH}/3dobjs/base.obj"):
    V, VT, faces = [], [], []
    group = None
    for line in open(path):
        if line.startswith("v "): V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("vt "): VT.append([float(x) for x in line.split()[1:3]])
        elif line.startswith("g "): group = line.split()[1]
        elif line.startswith("f "):
            idx = [p.split("/") for p in line.split()[1:]]
            faces.append((group, [int(a[0]) - 1 for a in idx], [int(a[1]) - 1 if len(a) > 1 and a[1] else -1 for a in idx]))
    return np.array(V), np.array(VT), faces


def load_target(name):
    d = {}
    path = f"{MH}/targets/macrodetails/{name}.target"
    idx, off = [], []
    for line in open(path):
        if line.startswith("#") or not line.strip(): continue
        p = line.split(); idx.append(int(p[0])); off.append([float(x) for x in p[1:4]])
    return np.array(idx, dtype=int), np.array(off, dtype=float).reshape(-1, 3)


def _lin(v):  # 0..1 macro value → weights for (min, average, max)
    if v < 0.5: return {"min": (0.5 - v) * 2, "average": 1 - (0.5 - v) * 2, "max": 0.0}
    return {"min": 0.0, "average": 1 - (v - 0.5) * 2, "max": (v - 0.5) * 2}


def shape(V, muscle=0.75, weight=0.55, height=0.6, proportions=1.0, race=None):
    """apply male / young macro targets (the same blending MakeHuman's macro modifiers use)"""
    race = race or {"caucasian": 1 / 3, "african": 1 / 3, "asian": 1 / 3}
    out = V.copy()
    mw, ww = _lin(muscle), _lin(weight)
    for mk, mv in mw.items():
        for wk, wv in ww.items():
            w = mv * wv
            if w < 1e-6: continue
            tag = f"male-young-{mk}muscle-{wk}weight"
            i, o = load_target(f"universal-{tag}"); out[i] += w * o
            hw = (height - 0.5) * 2
            if abs(hw) > 1e-6:
                i, o = load_target(f"height/{tag}-{'max' if hw > 0 else 'min'}height"); out[i] += w * abs(hw) * o
            if proportions > 0:
                i, o = load_target(f"proportions/{tag}-idealproportions"); out[i] += w * proportions * o
    for r, w in race.items():
        if w > 0: i, o = load_target(f"{r}-male-young"); out[i] += w * o
    return out


def skeleton(V):
    d = json.load(open(f"{MH}/rigs/default.mhskel"))
    jp = {k: V[v].mean(axis=0) for k, v in d["joints"].items()}
    bones = {}
    for n, b in d["bones"].items():
        bones[n] = {"parent": b["parent"], "head": jp[b["head"]], "tail": jp[b["tail"]]}
    return bones


def kept(name):
    return not any(name.startswith(x) for x in KEEP_EXCLUDE)


def weights(bones):
    """per-vertex (bone, weight) lists with removed bones folded into their nearest kept ancestor"""
    w = json.load(open(f"{MH}/rigs/default_weights.mhw"))["weights"]
    def target(n):
        while not kept(n): n = bones[n]["parent"]
        return n
    per = {}
    for b, lst in w.items():
        t = target(b)
        for vi, wt in lst: per.setdefault(vi, {}); per[vi][t] = per[vi].get(t, 0) + wt
    return per
