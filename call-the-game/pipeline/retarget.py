"""Retarget CMU BVH motion (real motion capture) onto the MakeHuman rig.

Method (rest-pose alignment): every mapped MakeHuman bone b follows CMU joint J. C_b rotates b's rest direction onto the CMU
T-pose direction of the same segment (both skeletons face +Z, Y up), and the world rotation is R_b(t) = D_J(t) · C_b with
D_J(t) = Rw_J(t) · Rw_J(T-pose)ᵀ — the actor's rotation away from the T-pose. Bone lengths stay the MakeHuman body's own; the
hips' translation is scaled by leg length. Mirroring (LHH / LHP) reflects the CMU data across the actor's sagittal plane and
swaps left/right joints before retargeting, so a left-handed swing keeps a correct left-hand-on-top grip."""
import numpy as np
from scipy.spatial.transform import Rotation as Rot
import bvh

MAP = {  # MakeHuman bone: (CMU joint J driving rotation, CMU joint K giving the segment direction J→K)
    "spine05": ("LowerBack", "Spine"), "spine04": ("LowerBack", "Spine"), "spine03": ("Spine", "Spine1"), "spine02": ("Spine", "Spine1"),
    "spine01": ("Spine1", "Neck1"), "neck01": ("Neck", "Neck1"), "neck02": ("Neck1", "Head"), "neck03": ("Neck1", "Head"), "head": ("Head", "HeadEnd"),
}
for s, c in (("L", "Left"), ("R", "Right")):
    MAP.update({
        f"clavicle.{s}": (f"{c}Shoulder", f"{c}Arm"), f"shoulder01.{s}": (f"{c}Shoulder", f"{c}Arm"),
        f"upperarm01.{s}": (f"{c}Arm", f"{c}ForeArm"), f"upperarm02.{s}": (f"{c}Arm", f"{c}ForeArm"),
        f"lowerarm01.{s}": (f"{c}ForeArm", f"{c}Hand"), f"lowerarm02.{s}": (f"{c}ForeArm", f"{c}Hand"),
        f"wrist.{s}": (f"{c}Hand", f"{c}HandIndex1"),
        f"pelvis.{s}": (f"{s}HipJoint", f"{c}UpLeg"), f"upperleg01.{s}": (f"{c}UpLeg", f"{c}Leg"), f"upperleg02.{s}": (f"{c}UpLeg", f"{c}Leg"),
        f"lowerleg01.{s}": (f"{c}Leg", f"{c}Foot"), f"lowerleg02.{s}": (f"{c}Leg", f"{c}Foot"), f"foot.{s}": (f"{c}Foot", f"{c}ToeBase"),
    })


def swap_lr(n):
    for a, b in (("Left", "Right"), ("LHip", "RHip"), ("LThumb", "RThumb")):
        if n.startswith(a): return b + n[len(a):]
        if n.startswith(b): return a + n[len(b):]
    return n


def cmu(path, mirror=False):
    J, O, D, ft = bvh.load(path)
    P, M, I = bvh.fk(J, O, D)
    ends = bvh.end_sites(J, O, P, M, I)
    P = np.concatenate([P, ends["Head"][:, None]], axis=1); M = np.concatenate([M, M[:, I["Head"]][:, None]], axis=1); I = dict(I, HeadEnd=len(O))
    if mirror:
        S = np.diag([-1.0, 1, 1])
        P = P * np.array([-1.0, 1, 1]); M = S @ M @ S
        I = {swap_lr(n): k for n, k in I.items()}
    return P, M, I, ft


def min_rot(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b); v = np.cross(a, b); c = float(np.dot(a, b))
    if np.linalg.norm(v) < 1e-9: return np.eye(3) if c > 0 else Rot.from_rotvec(np.pi * np.array([0, 0, 1.0])).as_matrix()
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1 / (1 + c))


def retarget(P, M, I, bones, order, frames):
    """→ world rotations {bone: (F,3,3)} and root translation (F,3) in metres (MakeHuman rest frame axes)"""
    F = len(frames); Rw = {}
    T = 0  # frame 0 = T-pose in the cgspeed release
    for b in order:
        if b == "root":
            DJ = M[frames, I["Hips"]] @ M[T, I["Hips"]].T
            Rw[b] = DJ
        elif b in MAP:
            j, k = MAP[b]
            rest = bones[b]["tail"] - bones[b]["head"]; tdir = P[T, I[k]] - P[T, I[j]]
            Cb = min_rot(rest, tdir)
            Rw[b] = (M[frames, I[j]] @ M[T, I[j]].T) @ Cb
        else:
            Rw[b] = Rw[bones[b]["parent"]] if bones[b]["parent"] else np.tile(np.eye(3), (F, 1, 1))
    # hips translation, scaled by leg length (CMU hip-to-ankle vs MakeHuman)
    cmu_leg = np.linalg.norm(P[T, I["LeftUpLeg"]] - P[T, I["LeftLeg"]]) + np.linalg.norm(P[T, I["LeftLeg"]] - P[T, I["LeftFoot"]])
    mh_leg = np.linalg.norm(bones["upperleg01.L"]["head"] - bones["lowerleg01.L"]["head"]) + np.linalg.norm(bones["lowerleg01.L"]["head"] - bones["foot.L"]["head"])
    k = mh_leg / cmu_leg
    root = P[frames, I["Hips"]] * k
    return Rw, root, k


def local_quats(Rw, bones, order):
    """local rotation (parent⁻¹ · world) as quaternions xyzw per bone — rest frames are world-aligned (identity rest rotation)"""
    out = {}
    for b in order:
        p = bones[b]["parent"]
        L = Rw[b] if p is None else np.einsum("fji,fjk->fik", Rw[p], Rw[b])
        q = Rot.from_matrix(L).as_quat()
        # keep quaternion signs continuous for clean interpolation
        for i in range(1, len(q)):
            if np.dot(q[i], q[i - 1]) < 0: q[i] = -q[i]
        out[b] = q
    return out


def fk_world(Rw, root, bones, order, rest_root):
    """world joint positions of the MakeHuman rig for verification (F, bone) → head positions"""
    pos = {}
    for b in order:
        p = bones[b]["parent"]
        if p is None: pos[b] = root + 0  # root head follows the scaled hips
        else:
            off = bones[b]["head"] - bones[p]["head"]
            pos[b] = pos[p] + np.einsum("fij,j->fi", Rw[p], off)
    return pos
