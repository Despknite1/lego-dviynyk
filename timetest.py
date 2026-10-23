import json,base64,time,sys,urllib.request
U,IMG=sys.argv[1],sys.argv[2]
b64=base64.b64encode(open(IMG,'rb').read()).decode()
def run(ep,body):
    t=time.time();r=urllib.request.Request(U+'/api/'+ep,json.dumps(body).encode(),{'Content-Type':'application/json','User-Agent':'t'})
    jid=json.load(urllib.request.urlopen(r))['job'];last=None
    while True:
        time.sleep(0.7);s=json.load(urllib.request.urlopen(urllib.request.Request(U+'/job/'+jid,headers={'User-Agent':'t'})))
        if s.get('stage')!=last: last=s.get('stage');print(f'   [{time.time()-t:5.1f}s] {last}')
        if s['status']!='pending':
            dt=time.time()-t;print(f'{ep}: {s["status"]} in {dt:.1f}s', s.get('error',''));return s.get('result'),dt
det,t1=run('detect',{'image':b64,'mime':'image/jpeg'})
for x in det['subjects']: print('  ',x['label'],x['box_2d'])
sub=det['subjects'][0]
d,t2=run('describe',{'image':b64,'mime':'image/jpeg','subject':sub});D=d['description'];print('  ',D.get('identity'),D.get('brickset_queries'),D.get('candidates'))
r,t3=run('search',{'description':D})
for x in r['results']: print('  ',x['fig_num'],x['similarity'],x['name'][:60],[(s['set_num'],s.get('retail_price'),s['status']) for s in x['sets']])
print(f'TOTAL detect {t1:.1f}s, describe {t2:.1f}s, search {t3:.1f}s, describe+search {t2+t3:.1f}s')
_,t4=run('search',{'description':D});print(f'cached search {t4:.1f}s')
