"""Minimal BVH reader + forward kinematics (numpy). Units: CMU/cgspeed BVH units → metres via SCALE."""
import numpy as np
from scipy.spatial.transform import Rotation as Rot

SCALE = 0.056444  # cgspeed CMU BVH unit → metres (1 unit = 1/0.45 in)


class Joint:
    def __init__(self, name, parent):
        self.name, self.parent, self.offset, self.channels, self.children, self.end = name, parent, np.zeros(3), [], [], None


def load(path):
    toks = open(path).read().split()
    i, joints, stack, order = 0, {}, [], []
    cur = None
    while toks[i] != "MOTION":
        t = toks[i]
        if t in ("ROOT", "JOINT"):
            j = Joint(toks[i + 1], stack[-1].name if stack else None)
            joints[j.name] = j; order.append(j.name)
            if stack: stack[-1].children.append(j.name)
            cur = j; i += 2
        elif t == "End":
            cur = "END"; i += 2
        elif t == "{":
            stack.append(cur if cur != "END" else Joint("_end", None)); i += 1
        elif t == "}":
            stack.pop(); i += 1
        elif t == "OFFSET":
            off = np.array([float(x) for x in toks[i + 1:i + 4]])
            if stack[-1].name == "_end": stack[-2].end = off
            else: stack[-1].offset = off
            i += 4
        elif t == "CHANNELS":
            n = int(toks[i + 1]); stack[-1].channels = toks[i + 2:i + 2 + n]; i += 2 + n
        else:
            i += 1
    nf = int(toks[i + 2]); ft = float(toks[i + 5]); data = np.array(toks[i + 6:], dtype=float).reshape(nf, -1)
    return joints, order, data, ft


def fk(joints, order, data):
    """world positions (F,J,3) metres and world rotations (F,J) as scipy Rotations (matrices F,J,3,3)"""
    F = data.shape[0]; J = len(order)
    pos = np.zeros((F, J, 3)); mat = np.zeros((F, J, 3, 3)); col = 0; idx = {n: k for k, n in enumerate(order)}
    local_t = {}; local_r = {}
    for n in order:
        j = joints[n]; ch = j.channels; c = data[:, col:col + len(ch)]; col += len(ch)
        tr = np.tile(j.offset, (F, 1)).astype(float)
        rot_ch = [k for k in range(len(ch)) if ch[k].endswith("rotation")]
        for k, name in enumerate(ch):
            if name.endswith("position"): tr[:, "XYZ".index(name[0])] = c[:, k]
        axes = "".join(ch[k][0] for k in rot_ch)
        R = Rot.from_euler(axes, c[:, rot_ch], degrees=True).as_matrix() if rot_ch else np.tile(np.eye(3), (F, 1, 1))
        local_t[n] = tr; local_r[n] = R
    for n in order:
        k = idx[n]; p = joints[n].parent
        if p is None:
            mat[:, k] = local_r[n]; pos[:, k] = local_t[n]
        else:
            kp = idx[p]
            mat[:, k] = mat[:, kp] @ local_r[n]
            pos[:, k] = pos[:, kp] + np.einsum("fij,fj->fi", mat[:, kp], local_t[n])
    return pos * SCALE, mat, idx


def end_sites(joints, order, pos, mat, idx):
    out = {}
    for n in order:
        j = joints[n]
        if j.end is not None:
            k = idx[n]; out[n] = pos[:, k] + np.einsum("fij,j->fi", mat[:, k], j.end * SCALE)
    return out
