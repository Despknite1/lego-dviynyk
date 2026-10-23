# crop the torso graphic from the photo (box_2d normalized 0-1000), remove the shirt background, posterize -> base64 PNG (restored)
import sys,json,base64,io
from PIL import Image,ImageOps
d=json.load(sys.stdin); im=Image.open(io.BytesIO(base64.b64decode(d['img']))).convert('RGB')
W,H=im.size; y1,x1,y2,x2=[float(v)/1000 for v in d['box']]
c=im.crop((int(x1*W),int(y1*H),int(x2*W),int(y2*H)))
c.thumbnail((512,512)); c=ImageOps.posterize(c,4).convert('RGBA')
bg=tuple(int(d.get('bg','#000000')[i:i+2],16) for i in (1,3,5))
px=c.load(); w,h=c.size
corners=[px[0,0],px[w-1,0],px[0,h-1],px[w-1,h-1]]
ref=max(set(c[:3] for c in corners),key=lambda k:sum(1 for q in corners if q[:3]==k))
for y in range(h):
    for x in range(w):
        p=px[x,y]
        if sum(abs(p[i]-ref[i]) for i in range(3))<60: px[x,y]=(0,0,0,0)
o=io.BytesIO(); c.save(o,'PNG'); print(base64.b64encode(o.getvalue()).decode())
