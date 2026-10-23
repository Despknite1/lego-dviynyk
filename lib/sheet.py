import sys,json,base64,io
from PIL import Image,ImageDraw,ImageFont
d=json.load(sys.stdin); ims=d['imgs']; C=6; S=160
R=(len(ims)+C-1)//C; sh=Image.new('RGB',(C*S,R*S),'white'); dr=ImageDraw.Draw(sh)
try: f=ImageFont.truetype('DejaVuSans-Bold.ttf',22)
except Exception: f=ImageFont.load_default()
for i,b in enumerate(ims):
    x,y=(i%C)*S,(i//C)*S
    if b:
        try:
            im=Image.open(io.BytesIO(base64.b64decode(b))).convert('RGBA'); im.thumbnail((S-10,S-30))
            bg=Image.new('RGBA',im.size,'white'); bg.alpha_composite(im); sh.paste(bg.convert('RGB'),(x+(S-im.width)//2,y+26))
        except Exception: pass
    dr.rectangle([x,y,x+S-1,y+S-1],outline='#999'); dr.rectangle([x,y,x+34,y+24],fill='black'); dr.text((x+4,y+1),str(i+1),fill='yellow',font=f)
o=io.BytesIO(); sh.save(o,'JPEG',quality=80); print(base64.b64encode(o.getvalue()).decode())
