import bvh, numpy as np, sys, matplotlib
matplotlib.use("Agg"); import matplotlib.pyplot as plt
f, a, b, step, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
J,O,D,ft = bvh.load('/home/user/sfd158/cmu-mocap/data/124/%s.bvh' % f)
P,M,I = bvh.fk(J,O,D)
frames = list(range(a, b, step)); n = len(frames)
fig, ax = plt.subplots(2, n, figsize=(2.2*n, 6))
for c, fr in enumerate(frames):
    for r, (u, v, title) in enumerate([(0, 1, "XY (front?)"), (2, 1, "ZY (side)")]):
        A = ax[r, c]
        for nme in O:
            p = J[nme].parent
            if p: 
                col = 'r' if nme.startswith(('Left','L')) else ('b' if nme.startswith(('Right','R')) else 'k')
                A.plot([P[fr,I[p],u], P[fr,I[nme],u]], [P[fr,I[p],v], P[fr,I[nme],v]], col, lw=1.5)
        A.set_aspect('equal'); A.set_xlim(P[fr,0,u]-1.1, P[fr,0,u]+1.1); A.set_ylim(-0.05, 2.0); A.set_xticks([]); A.set_yticks([])
        if r == 0: A.set_title(str(fr), fontsize=8)
plt.tight_layout(); plt.savefig(out, dpi=70)
