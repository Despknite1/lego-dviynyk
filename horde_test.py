import sys,json,time,urllib.request
P=sys.argv[1];H={'apikey':'0000000000','Content-Type':'application/json','Client-Agent':'lego-site:1.0:pavlo','User-Agent':'Mozilla/5.0 (X11; Linux x86_64) Chrome/130'}
def req(u,b=None):return json.load(urllib.request.urlopen(urllib.request.Request(u,json.dumps(b).encode() if b else None,H),timeout=30))
ids={}
for m in sys.argv[2:]:
  st=8 if 'Turbo' in m else (4 if 'Flux' in m else 25)
  try: ids[m]=req('https://aihorde.net/api/v2/generate/async',{'prompt':P,'params':{'width':512,'height':512,'steps':20 if st==25 else st,'cfg_scale':1 if st<10 else 6,'n':1},'models':[m],'r2':True})['id']; print(m,'queued')
  except urllib.error.HTTPError as e: print(m,'ERR',e.read()[:300])
t=time.time();done=set()
while len(done)<len(ids) and time.time()-t<240:
  time.sleep(5)
  for m,i in ids.items():
    if m in done: continue
    s=req('https://aihorde.net/api/v2/generate/check/'+i)
    if s.get('done'):
      g=req('https://aihorde.net/api/v2/generate/status/'+i)['generations'][0]
      urllib.request.urlretrieve(g['img'],'horde_'+m.split()[0].replace('.','')+'.webp'); print('DONE',m,round(time.time()-t),'s'); done.add(m)
for m in ids:
  if m not in done: print('NOTDONE',m, req('https://aihorde.net/api/v2/generate/check/'+ids[m]))
