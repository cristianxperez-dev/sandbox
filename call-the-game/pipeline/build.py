"""Build apps/call-the-game/assets/player.glb: a MakeHuman (CC0) athlete, skinned to the MakeHuman default rig (CC0), with
uniform regions as separate materials and four motion-capture clips retargeted from CMU subject 124 (free for commercial use):
  batR  — 124_07 baseball swing (right-handed hitter): stance → load → stride → swing → follow-through
  batL  — the same capture mirrored across the actor's sagittal plane (left/right joints swapped): left-handed hitter
  pitchR / pitchL — 124_01 baseball pitch, right- and left-handed.
Usage: python3 build.py   (needs the CMU BVH and MakeHuman data clones; see call-the-game/ASSETS.md)"""
import json, os, struct, numpy as np
from scipy.spatial.transform import Rotation as Rot
import mh, retarget as rt, garment
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "call-the-game", "assets")
CMU = os.environ.get("CMU_BVH", "/home/user/sfd158/cmu-mocap/data/124")
FPS = 60
CLIPS = {  # name: (file, first frame, last frame, mirror)
    "batR": ("124_07", 150, 440, False), "batL": ("124_07", 150, 440, True),
    "pitchR": ("124_01", 230, 600, False), "pitchL": ("124_01", 230, 600, True),
}


def build_body():
    V, VT, F = mh.load_obj()
    S = mh.shape(V, muscle=0.8, weight=0.6, height=0.62, proportions=1.0, race={"caucasian": 0.4, "african": 0.35, "asian": 0.25}) * 0.1
    B = mh.skeleton(S)
    body_f = [f for f in F if f[0] == "body"]
    eye_f = [f for f in F if f[0] in ("helper-l-eye", "helper-r-eye")]
    used = np.unique(np.concatenate([f[1] for f in body_f + eye_f]))
    ymin = S[np.unique(np.concatenate([f[1] for f in body_f])), 1].min()
    S = S - np.array([0, ymin, 0]); [b.update(head=b["head"] - [0, ymin, 0], tail=b["tail"] - [0, ymin, 0]) for b in B.values()]
    return V, VT, F, S, B, body_f, eye_f, used


def tri(fs):
    out = []
    for g, v, t in fs:
        for k in range(1, len(v) - 1): out.append(((v[0], t[0]), (v[k], t[k]), (v[k + 1], t[k + 1])))
    return out


def region_of(vi, pos, dom, B):
    b = dom.get(vi)
    if b is None: return "skin"
    p = pos[vi]
    def tpar(bone, ref=None):
        h, t = B[bone]["head"], B[ref or bone]["tail"]; d = t - h; return float(np.dot(p - h, d) / np.dot(d, d))
    belt = B["root"]["head"][1] + 0.105
    if b in ("head", "neck01", "neck02", "neck03"): return "skin"
    if b.startswith(("wrist", "finger", "metacarpal")): return "hands"
    if b.startswith("lowerarm"): return "undershirt"
    if b.startswith("upperarm"):
        s = b[-1]; return "jersey" if tpar(f"upperarm01.{s}", f"upperarm02.{s}") < 0.42 else "undershirt"
    if b.startswith(("foot", "toe")): return "shoes"
    if b.startswith("lowerleg"):
        s = b[-1]; t = tpar(f"lowerleg01.{s}", f"lowerleg02.{s}")
        return "pants" if t < 0.3 else "socks"
    if b.startswith(("upperleg", "pelvis")): return "pants"
    if b.startswith(("spine", "root", "clavicle", "shoulder")):
        y = p[1]
        if abs(y - belt) < 0.022: return "belt"
        return "jersey" if y > belt else "pants"
    return "skin"


INFLATE = {"jersey": 0.011, "pants": 0.016, "belt": 0.018, "undershirt": 0.004, "socks": 0.004, "shoes": 0.012, "hands": 0.004, "skin": 0.0}


def normals(P, tris):
    N = np.zeros_like(P)
    a, b, c = (np.array([t[k][0] for t in tris]) for k in range(3))
    fn = np.cross(P[b] - P[a], P[c] - P[a]); np.add.at(N, a, fn); np.add.at(N, b, fn); np.add.at(N, c, fn)
    return N / np.maximum(1e-9, np.linalg.norm(N, axis=1, keepdims=True))


def grip_pose(B, order, curl, thumb):
    """local rotations for the finger bones (rest frames are world-aligned): flex every finger joint by `curl` radians"""
    out = {}
    for s in ("L", "R"):
        w, i1, p1 = B[f"wrist.{s}"]["head"], B[f"finger2-1.{s}"]["head"], B[f"finger5-1.{s}"]["head"]
        palm = np.cross(i1 - w, p1 - w); palm /= np.linalg.norm(palm)
        if s == "L": palm = -palm   # palmar side: where the thumb and the resting finger curl point
        for n in order:
            if not n.endswith("." + s) or not n.startswith("finger"): continue
            d = B[n]["tail"] - B[n]["head"]; d /= np.linalg.norm(d)
            axis = np.cross(d, palm); axis /= np.linalg.norm(axis)
            ang = thumb if n.startswith("finger1") else curl * (0.8 if n.endswith(f"-1.{s}") else 1.0)
            out[n] = Rot.from_rotvec(axis * ang).as_quat()
    return out


def main():
    V, VT, F, S, B, body_f, eye_f, used = build_body()
    order = [n for n in B if mh.kept(n)]
    depth = lambda n: 0 if B[n]["parent"] is None else 1 + depth(B[n]["parent"])
    order.sort(key=depth)
    bi = {n: k for k, n in enumerate(order)}
    W = mh.weights(B)
    dom = {v: max(ws.items(), key=lambda kv: kv[1])[0] for v, ws in W.items()}

    # ---- geometry: unique (vertex, uv) pairs; one primitive per uniform region
    tris_body, tris_eye = tri(body_f), tri(eye_f)
    Pn = normals(S, tris_body + tris_eye)
    key = {}; verts = []
    def vid(v, t):
        k = (v, t)
        if k not in key: key[k] = len(verts); verts.append(k)
        return key[k]
    prims = {"body": [], "eyes": []}
    for t3 in tris_body: prims["body"].extend(vid(v, t) for v, t in t3)
    for t3 in tris_eye: prims["eyes"].extend(vid(v, t) for v, t in t3)
    vv = np.array([k[0] for k in verts]); tt = np.array([k[1] for k in verts])
    feats = garment.features(S, Pn, dom, B); rules = garment.Rules(B)
    th, _ = garment.thickness(feats, rules, tris_body, len(S))
    Sc = garment.cloth_proxy(S, feats, rules, tris_body)
    Nc = normals(Sc, tris_body + tris_eye); Nc[np.linalg.norm(Nc, axis=1) < 0.5] = Pn[np.linalg.norm(Nc, axis=1) < 0.5]
    pos = Sc[vv] + Nc[vv] * th[vv][:, None]; Pn = Nc
    mask = garment.mask_texture(tris_body, VT, feats, rules)
    Image.fromarray(mask).save(os.path.join(OUT, "uniform-mask.png"), optimize=True)
    nor = Pn[vv].astype(np.float32); uv = np.where(tt[:, None] >= 0, VT[np.maximum(tt, 0)], 0) * [1, -1] + [0, 1]
    J = np.zeros((len(vv), 4), np.uint8); Wt = np.zeros((len(vv), 4), np.float32)
    for i, v in enumerate(vv):
        ws = sorted(W.get(v, {"head": 1.0}).items(), key=lambda kv: -kv[1])[:4]; tot = sum(w for _, w in ws)
        for k, (b, w) in enumerate(ws): J[i, k] = bi[b]; Wt[i, k] = w / tot

    # ---- animation clips (retargeted motion capture)
    anims = {}; meta = {"fps": FPS, "clips": {}}
    grip_bat = grip_pose(B, order, 1.25, 0.9); grip_pitch = grip_pose(B, order, 0.85, 0.6)
    for name, (f, a, b, mirror) in CLIPS.items():
        P, M, I, ft = rt.cmu(f"{CMU}/{f}.bvh", mirror)
        frames = list(range(a, b + 1, int(round(1 / (ft * FPS)))))
        Rw, root, k = rt.retarget(P, M, I, B, order, frames)
        q = rt.local_quats(Rw, B, order)
        grip = grip_bat if name.startswith("bat") else grip_pitch
        for n, g in grip.items(): q[n] = np.tile(g, (len(frames), 1))
        # ground: lowest heel/toe over the clip sits on y = 0
        wp = rt.fk_world(Rw, root, B, order, None)
        foot_y = min(wp["foot.L"][:, 1].min(), wp["foot.R"][:, 1].min()) - (B["foot.L"]["head"][1])
        root_local = root - np.array([0, foot_y, 0]) - B["root"]["head"]   # translation offset from the rest root
        anims[name] = (q, root_local)
        meta["clips"][name] = {"source": f"CMU {f}", "frames": [a, b], "mirror": mirror, "duration": (len(frames) - 1) / FPS}
    # bat held in the bottom hand: its axis is a fixed direction in that hand's frame (diagonal across the palm, from the motion
    # capture's hand orientation). Rest frames are world-aligned, so the local direction is C_wristᵀ · v_T (v_T in the CMU T-pose).
    P0, M0, I0, _ = rt.cmu(f"{CMU}/124_07.bvh", False)
    for name, side, cmu_side, sgn in (("batR", "L", "Left", 1), ("batL", "R", "Left", -1)):
        rest = B[f"wrist.{side}"]["tail"] - B[f"wrist.{side}"]["head"]
        tdir = (P0[0, I0[f"{cmu_side}HandIndex1"]] - P0[0, I0[f"{cmu_side}Hand"]]) * np.array([sgn, 1, 1])
        C = rt.min_rot(rest, tdir)
        vT = np.array([0.35 * sgn, 0, 1.0]); vT /= np.linalg.norm(vT)
        meta["clips"][name]["bat"] = {"bone": f"wrist_{side}", "dir": (C.T @ vT).round(5).tolist(), "topBone": f"wrist_{'R' if side == 'L' else 'L'}"}
    # hand frames at rest (world-aligned): grip centre and palm normal, for the runtime grip IK and the ball in the hand
    meta["hands"] = {}
    for s in ("L", "R"):
        w, i1, p1 = B[f"wrist.{s}"]["head"], B[f"finger2-1.{s}"]["head"], B[f"finger5-1.{s}"]["head"]
        palm = np.cross(i1 - w, p1 - w); palm /= np.linalg.norm(palm)
        if s == "L": palm = -palm   # palmar side: where the thumb and the resting finger curl point
        mid = (i1 + p1) / 2
        meta["hands"][f"wrist_{s}"] = {"center": ((mid - w) * 0.78 + palm * 0.03).round(5).tolist(), "palm": palm.round(5).tolist(),
                                       "fingers": ((mid - w) / np.linalg.norm(mid - w)).round(5).tolist()}
    # each hand's own estimate of the bat axis (for the top hand's orientation on the handle)
    for name, side, sgn in (("batR", "R", 1), ("batL", "L", -1)):
        rest = B[f"wrist.{side}"]["tail"] - B[f"wrist.{side}"]["head"]
        cs = "Right" if sgn == 1 else "Right"
        tdir = (P0[0, I0["RightHandIndex1"]] - P0[0, I0["RightHand"]]) * np.array([sgn, 1, 1])
        C = rt.min_rot(rest, tdir); vT = np.array([-0.35 * sgn, 0, 1.0]); vT /= np.linalg.norm(vT)
        meta["clips"][name]["bat"]["topDir"] = (C.T @ vT).round(5).tolist()
    ev = lambda f0, fr: round((fr - f0) / 120, 4)
    for n in ("batR", "batL"): meta["clips"][n]["events"] = {"strideStart": ev(150, 282), "strideLand": ev(150, 312), "launch": ev(150, 322), "contact": ev(150, 345), "finish": ev(150, 400)}
    for n in ("pitchR", "pitchL"): meta["clips"][n]["events"] = {"start": ev(230, 280), "legLift": ev(230, 361), "footStrike": ev(230, 432), "release": ev(230, 444), "finish": ev(230, 560)}
    write_glb(order, B, bi, pos, nor, uv, J, Wt, prims, anims, os.path.join(OUT, "player.glb"))
    # handy reference points for the runtime (grip centres, hand frames)
    meta["rest"] = {n.replace(".", "_"): {"head": B[n]["head"].round(5).tolist(), "tail": B[n]["tail"].round(5).tolist()} for n in order}
    json.dump(meta, open(os.path.join(OUT, "player.json"), "w"))
    print("verts", len(vv), "tris", sum(len(v) for v in prims.values()) // 3, "bones", len(order), {k: len(v) // 3 for k, v in prims.items()})


def write_glb(order, B, bi, pos, nor, uv, J, Wt, prims, anims, path):
    buf = bytearray(); views = []; accs = []
    def add(arr, comp, typ, target=None, minmax=False, normalized=False):
        arr = np.ascontiguousarray(arr); off = len(buf); buf.extend(arr.tobytes()); buf.extend(b"\0" * ((4 - len(buf) % 4) % 4))
        views.append({"buffer": 0, "byteOffset": off, "byteLength": arr.nbytes, **({"target": target} if target else {})})
        a = {"bufferView": len(views) - 1, "componentType": comp, "count": int(arr.shape[0]), "type": typ}
        if normalized: a["normalized"] = True
        if minmax: a["min"] = arr.min(axis=0).tolist() if arr.ndim > 1 else [float(arr.min())]; a["max"] = arr.max(axis=0).tolist() if arr.ndim > 1 else [float(arr.max())]
        accs.append(a); return len(accs) - 1
    FLOAT, U8, U16, U32 = 5126, 5121, 5123, 5125
    aP = add(pos.astype(np.float32), FLOAT, "VEC3", 34962, minmax=True); aN = add(nor, FLOAT, "VEC3", 34962)
    aT = add(uv.astype(np.float32), FLOAT, "VEC2", 34962); aJ = add(J, U8, "VEC4", 34962); aW = add(Wt, FLOAT, "VEC4", 34962)
    COL = {"skin": [0.62, 0.45, 0.35], "jersey": [0.85, 0.85, 0.85], "pants": [0.85, 0.85, 0.85], "belt": [0.1, 0.1, 0.12], "undershirt": [0.1, 0.12, 0.2],
           "socks": [0.1, 0.12, 0.2], "shoes": [0.06, 0.06, 0.07], "hands": [0.1, 0.1, 0.12], "eyes": [0.92, 0.92, 0.9]}
    mats, prim_list = [], []
    for r, idx in prims.items():
        mats.append({"name": r, "pbrMetallicRoughness": {"baseColorFactor": COL.get(r, [0.9] * 3) + [1], "metallicFactor": 0, "roughnessFactor": 0.8 if r != "eyes" else 0.3}})
        prim_list.append({"attributes": {"POSITION": aP, "NORMAL": aN, "TEXCOORD_0": aT, "JOINTS_0": aJ, "WEIGHTS_0": aW},
                          "indices": add(np.array(idx, np.uint32), U32, "SCALAR", 34963), "material": len(mats) - 1})
    nodes = []
    for n in order:
        p = B[n]["parent"]; t = B[n]["head"] - (B[p]["head"] if p else 0)
        nodes.append({"name": n.replace(".", "_"), "translation": [float(x) for x in t]})
    for n in order:
        ch = [bi[c] for c in order if B[c]["parent"] == n]
        if ch: nodes[bi[n]]["children"] = ch
    ibm = np.stack([np.linalg.inv(np.block([[np.eye(3), B[n]["head"][:, None]], [np.zeros((1, 3)), np.ones((1, 1))]])).T.reshape(16) for n in order]).astype(np.float32)
    aI = add(ibm, FLOAT, "MAT4")
    mesh_node = len(nodes); nodes.append({"name": "body", "mesh": 0, "skin": 0})
    arm = len(nodes); nodes.append({"name": "player", "children": [bi["root"], mesh_node]})
    animations = []
    for name, (q, root_local) in anims.items():
        F_ = len(root_local); times = add(np.arange(F_, dtype=np.float32) / FPS, FLOAT, "SCALAR", minmax=True)
        samplers, channels = [], []
        for n in order:
            if n.startswith(("finger", "metacarpal")) and np.allclose(q[n], q[n][0]) and False: continue
            samplers.append({"input": times, "output": add(q[n].astype(np.float32), FLOAT, "VEC4"), "interpolation": "LINEAR"})
            channels.append({"sampler": len(samplers) - 1, "target": {"node": bi[n], "path": "rotation"}})
        tr = (B["root"]["head"] + root_local).astype(np.float32)
        samplers.append({"input": times, "output": add(tr, FLOAT, "VEC3"), "interpolation": "LINEAR"})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": bi["root"], "path": "translation"}})
        animations.append({"name": name, "samplers": samplers, "channels": channels})
    gltf = {"asset": {"version": "2.0", "generator": "call-the-game pipeline (MakeHuman CC0 body + CMU mocap)"},
            "scene": 0, "scenes": [{"nodes": [arm]}], "nodes": nodes, "meshes": [{"name": "body", "primitives": prim_list}],
            "skins": [{"joints": [bi[n] for n in order], "inverseBindMatrices": aI, "skeleton": bi["root"]}],
            "materials": mats, "animations": animations, "accessors": accs, "bufferViews": views, "buffers": [{"byteLength": len(buf)}]}
    js = json.dumps(gltf, separators=(",", ":")).encode(); js += b" " * ((4 - len(js) % 4) % 4)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(buf)))
        fh.write(struct.pack("<II", len(js), 0x4E4F534A)); fh.write(js)
        fh.write(struct.pack("<II", len(buf), 0x004E4942)); fh.write(bytes(buf))
    print("wrote", path, round((12 + 16 + len(js) + len(buf)) / 1e6, 2), "MB")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True); main()
