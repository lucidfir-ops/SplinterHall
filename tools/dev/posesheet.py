# Contact sheets of skeleton poses from tools/dev/poses.mjs: one image per scene, frames in a grid.
# Each cell: the side view (as the game camera sees it; near limbs bright and thick, far limbs dark and thin)
# and a top view strip underneath (x across, depth up = toward the camera).
import json, sys, os, math
from PIL import Image, ImageDraw
data = json.load(open(sys.argv[1])); out = sys.argv[2]
SEGS = [(2,2),(0,1),(6,7),(7,8),(3,4),(4,5),(12,13),(13,14),(9,10),(10,11)]
NEAR = {4,5,8,9}; FAR = {2,3,6,7}
COL = {0:(239,230,210),3:(139,227,58),5:(229,36,59)}
REACH = {'axe':0.95,'sword':1.55,'hammer':1.15}
CW, CH, TH = 260, 230, 70
SC = 46  # px per metre
for sc in data:
    fr = sc['frames']; n = len(fr); cols = 6; rows = math.ceil(n/cols)
    img = Image.new('RGB', (cols*CW, rows*(CH+TH)+30), (18,18,18)); d = ImageDraw.Draw(img)
    d.text((8,8), sc['id']+'  '+sc['name'], fill=(230,230,230))
    # centre on the player's first pelvis
    p0 = next(f for f in fr[0]['f'] if f['slot']==0)['j']
    cx0, cy0 = p0[0], 3.0
    for i, F in enumerate(fr):
        ox, oy = (i%cols)*CW, (i//cols)*(CH+TH)+30
        d.rectangle([ox,oy,ox+CW-1,oy+CH+TH-1], outline=(50,50,50))
        me = next((f for f in F['f'] if f['slot']==0), None)
        cx = me['j'][0] if me else cx0
        X = lambda x: ox + CW/2 + (x-cx)*SC
        Y = lambda y: oy + CH - 20 - (y-cy0+0.3)*SC
        Z = lambda z: oy + CH + TH/2 - z*SC*0.9
        d.line([ox, Y(3.0), ox+CW, Y(3.0)], fill=(90,70,50), width=2)  # floor (y=3 top of row 2)
        d.line([ox, oy+CH, ox+CW, oy+CH], fill=(60,60,60))
        d.text((ox+4, oy+4), str(F['s']) + ' ' + (me['move'] or '' if me else ''), fill=(160,160,160))
        for f in F['f']:
            j = f['j']; base = COL.get(f['slot'], (200,200,200))
            P = lambda k: (j[k*3], j[k*3+1], j[k*3+2])
            order = sorted(range(10), key=lambda k: (P(SEGS[k][0])[2]+P(SEGS[k][1])[2]))
            for k in order:
                a, b = SEGS[k]; A, B = P(a), P(b)
                shade = 0.55 if k in FAR else 1.0
                c = tuple(int(v*shade) for v in base)
                if k == 0:
                    r = 0.235*SC; d.ellipse([X(A[0])-r, Y(A[1])-r, X(A[0])+r, Y(A[1])+r], fill=c, outline=(0,0,0))
                else:
                    w = 9 if k == 1 else (6 if k in NEAR else 4)
                    d.line([X(A[0]),Y(A[1]),X(B[0]),Y(B[1])], fill=c, width=w)
                # top view
                d.line([X(A[0]),Z(A[2]),X(B[0]),Z(B[2])], fill=c, width=3 if k in NEAR else 2)
            if f['item'] in REACH:
                e, h = P(4), P(5); dx, dy, dz = h[0]-e[0], h[1]-e[1], h[2]-e[2]; l = math.sqrt(dx*dx+dy*dy+dz*dz) or 1; R = REACH[f['item']]
                t = (h[0]+dx/l*R, h[1]+dy/l*R, h[2]+dz/l*R)
                d.line([X(h[0]),Y(h[1]),X(t[0]),Y(t[1])], fill=(200,200,220), width=3)
                d.line([X(h[0]),Z(h[2]),X(t[0]),Z(t[2])], fill=(200,200,220), width=2)
            if f.get('rag',0) > 0.3: d.text((X(j[0])-10, Y(j[1])+10), 'rag', fill=(255,80,80))
    img.save(os.path.join(out, 'pose-'+sc['id']+'.png'))
print('sheets in', out)
