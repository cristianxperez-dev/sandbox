import sys, numpy as np, matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
import mh, retarget as rt
clip, a, b, step, mirror, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5] == "1", sys.argv[6]
V, VT, F = mh.load_obj(); S = mh.shape(V) * 0.1
B = mh.skeleton(S); order = [n for n in B if mh.kept(n)]
def depth(n): d=0; 
order.sort(key=lambda n: (lambda f: f(f, n))(lambda f, n: 0 if B[n]["parent"] is None else 1 + f(f, B[n]["parent"])))
P, M, I, ft = rt.cmu(f"/home/user/sfd158/cmu-mocap/data/124/{clip}.bvh", mirror)
frames = list(range(a, b, step))
Rw, root, k = rt.retarget(P, M, I, B, order, frames)
pos = rt.fk_world(Rw, root, B, order, None)
fig, ax = plt.subplots(2, len(frames), figsize=(2.2 * len(frames), 6))
for c, fr in enumerate(range(len(frames))):
    for r, (u, v) in enumerate([(0, 1), (2, 1)]):
        A = ax[r, c]
        for n in order:
            p = B[n]["parent"]
            if p and not n.startswith(("finger", "metacarpal")):
                col = 'r' if n.endswith('.L') else ('b' if n.endswith('.R') else 'k')
                A.plot([pos[p][fr, u], pos[n][fr, u]], [pos[p][fr, v], pos[n][fr, v]], col, lw=1.5)
        # CMU for comparison (grey)
        for nme, kk in I.items():
            pass
        A.set_aspect('equal'); cx = pos["root"][fr, u]; A.set_xlim(cx - 1.1, cx + 1.1); A.set_ylim(-0.05 + pos['root'][fr,1]-1.2, pos['root'][fr,1]+1.1); A.set_xticks([]); A.set_yticks([])
        if r == 0: A.set_title(str(frames[fr]), fontsize=8)
plt.tight_layout(); plt.savefig(out, dpi=70)
print("leg scale", k)
