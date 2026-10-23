# python3 gentest.py <base_url> <image> [subject_label]  -> runs describe + generate, prints result summary
import json,urllib.request,time,base64,sys
U=sys.argv[1]; b=base64.b64encode(open(sys.argv[2],'rb').read()).decode(); lab=sys.argv[3] if len(sys.argv)>3 else 'person'
def call(ep,body):
  r=json.load(urllib.request.urlopen(urllib.request.Request(U+'/api/'+ep,json.dumps(body).encode(),{'Content-Type':'application/json'}),timeout=60))
  while True:
    time.sleep(2); s=json.load(urllib.request.urlopen(U+'/job/'+str(r['job'])))
    if s['status']=='done': return s['result']
    if s['status']=='error': raise SystemExit(ep+' ERROR '+s['error'][:300])
t=time.time(); d=call('describe',{'image':b,'mime':'image/jpeg','subject':{'label':lab}})['description']; d = d[0] if isinstance(d, list) else d; print('describe',round(time.time()-t),'s',d.get('identity'))
t=time.time(); r=call('generate',{'image':b,'mime':'image/jpeg','crop':b,'subject':{'label':lab},'description':d}); print('generate',round(time.time()-t),'s')
json.dump({'description':d,'result':r},open('/workspace/lego-site/last_gen.json','w'));print(json.dumps({k:v for k,v in r.items() if k not in('png','svg','image','sketch')},ensure_ascii=False)[:1500])
