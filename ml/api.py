"""Local-only analysis API. Uploaded source records are immutable."""
import os, json, sqlite3, hashlib, uuid, math
from datetime import datetime, timezone
from pathlib import Path
from functools import lru_cache
import joblib
import pandas as pd
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from ml.spatial import validate_collection, match_layers, screen_sites

ROOT=Path(__file__).resolve().parents[1]
DB=Path(os.environ.get('BHOOMI_DB', ROOT/'data/workspace.sqlite'))
app=FastAPI(title='Bhoomi Suraksha',version='2.0.0')

def now(): return datetime.now(timezone.utc).isoformat()
def connect():
    DB.parent.mkdir(parents=True,exist_ok=True)
    c=sqlite3.connect(DB); c.row_factory=sqlite3.Row
    c.execute('PRAGMA journal_mode=WAL')
    c.executescript('''CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, name TEXT, kind TEXT, reliability REAL, created_at TEXT, checksum TEXT, geojson TEXT);
    CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, run_id TEXT, left_source TEXT, right_source TEXT, result TEXT, status TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT, action TEXT, subject TEXT, actor TEXT, reason TEXT, payload TEXT, previous_hash TEXT, hash TEXT);''')
    return c

def log(c,action,subject,reason,payload=None):
    last=c.execute('SELECT hash FROM audit ORDER BY id DESC LIMIT 1').fetchone()
    prev=last['hash'] if last else 'GENESIS'
    at=now(); actor='Local analyst'
    raw=json.dumps(payload or {},sort_keys=True,separators=(',',':'))
    digest=hashlib.sha256(json.dumps([at,action,subject,actor,reason,raw,prev],separators=(',',':')).encode()).hexdigest()
    c.execute('INSERT INTO audit(at,action,subject,actor,reason,payload,previous_hash,hash) VALUES(?,?,?,?,?,?,?,?)',(at,action,subject,actor,reason,raw,prev,digest))

def sources(c):
    return [{**dict(r),'geojson':json.loads(r['geojson'])} for r in c.execute('SELECT * FROM sources ORDER BY created_at DESC')]

@lru_cache
def events():
    p=ROOT/'data/derived/events.geojson'
    return json.loads(p.read_text()) if p.exists() else {'type':'FeatureCollection','features':[]}
@lru_cache
def cards():
    p=ROOT/'models/registry.json'
    return json.loads(p.read_text()) if p.exists() else []
@lru_cache
def model(name):
    path=ROOT/'models'/f'{name}.joblib'
    card=next((c for c in cards() if c['id']==name),None)
    if not card or not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest()!=card['artifact_sha256']:
        raise HTTPException(503,'Model artifact is missing or its integrity check failed.')
    return joblib.load(path)

@app.get('/api/health')
def health(): return {'status':'ok','models':len(cards()),'catalog_events':len(events()['features']),'mode':'local single-user workspace'}
@app.get('/api/overview')
def overview():
    fc=events()['features']; india=[f for f in fc if f['properties']['country']=='India']
    with connect() as c:
        ss=sources(c); statuses=dict(c.execute('SELECT status,COUNT(*) FROM matches GROUP BY status').fetchall())
        review=c.execute("SELECT count(*) FROM matches WHERE status='pending'").fetchone()[0]
    by_year={}; by_region={}
    for f in india:
        p=f['properties']; year=p['date'][:4]; by_year[year]=by_year.get(year,0)+1
        region=p.get('region') or 'Unspecified';by_region[region]=by_region.get(region,0)+1
    return {'total_events':len(fc),'india_events':len(india),'sources':len(ss),'features':sum(len(s['geojson']['features']) for s in ss),'pending':review,'models':len(cards()),'by_year':by_year,'by_region':sorted(by_region.items(),key=lambda x:-x[1])[:5],'period':{'start':min((f['properties']['date'] for f in fc),default=''),'end':max((f['properties']['date'] for f in fc),default='')},'statuses':statuses}
@app.get('/api/events')
def get_events(country:str='India',size:str='all',q:str='',year:str='all'):
    rows=[f for f in events()['features'] if (country=='all' or f['properties']['country']==country) and (size=='all' or f['properties']['size']==size) and (year=='all' or f['properties']['date'].startswith(year)) and q.lower() in json.dumps(f['properties']).lower()]
    return {'type':'FeatureCollection','features':rows}
@app.get('/api/sources')
def get_sources():
    with connect() as c: return sources(c)
class SourceInput(BaseModel):
    name:str=Field(min_length=2,max_length=100)
    kind:str
    reliability:float=Field(ge=0,le=100)
    geojson:dict
@app.post('/api/sources',status_code=201)
def add_source(body:SourceInput):
    if body.kind not in ('cadastral','revenue','survey','habitation','site','hazard'): raise HTTPException(422,'Unknown layer type.')
    try: fc=validate_collection(body.geojson)
    except Exception as e: raise HTTPException(422,str(e))
    if body.kind in ('cadastral','revenue','survey','hazard','site') and any(f['geometry']['type'] not in ('Polygon','MultiPolygon') for f in fc['features']):
        raise HTTPException(422,'This layer type requires polygon geometries.')
    if body.kind in ('hazard','site','habitation'):
        from shapely.geometry import shape
        if any(not shape(f['geometry']).is_valid for f in fc['features']): raise HTTPException(422,'Repair invalid geometries before using them for site screening.')
    raw=json.dumps(fc,sort_keys=True,allow_nan=False); checksum=hashlib.sha256(raw.encode()).hexdigest(); sid=str(uuid.uuid4())
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        if c.execute('SELECT id FROM sources WHERE checksum=? AND name=?',(checksum,body.name)).fetchone(): raise HTTPException(409,'This layer is already imported.')
        c.execute('INSERT INTO sources VALUES(?,?,?,?,?,?,?)',(sid,body.name,body.kind,body.reliability,now(),checksum,raw))
        log(c,'source.import',sid,'Imported user-supplied GeoJSON',{'name':body.name,'features':len(fc['features']),'sha256':checksum})
    return {'id':sid,'features':len(fc['features']),'sha256':checksum}
class MatchInput(BaseModel):
    left_source:str
    right_source:str
@app.post('/api/harmonize')
def harmonize(body:MatchInput):
    if body.left_source==body.right_source: raise HTTPException(422,'Select two different sources.')
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        ss={s['id']:s for s in sources(c)}
        if body.left_source not in ss or body.right_source not in ss: raise HTTPException(404,'Source not found.')
        left,right=ss[body.left_source],ss[body.right_source]
        if any(s['kind'] not in ('cadastral','revenue','survey') for s in (left,right)): raise HTTPException(422,'Match cadastral, revenue, or survey layers.')
        rr=match_layers(left,right); run_id=str(uuid.uuid4())
        for r in rr:
            rid=str(uuid.uuid4());r['id']=rid;r['run_id']=run_id
            c.execute('INSERT INTO matches VALUES(?,?,?,?,?,?,?)',(rid,run_id,body.left_source,body.right_source,json.dumps(r),'pending',now()))
        log(c,'match.run',run_id,'Computed rule-based evidence scores',{'matches':len(rr),'left':body.left_source,'right':body.right_source})
    return {'run_id':run_id,'matches':rr}
@app.get('/api/matches')
def get_matches():
    with connect() as c: return [{**json.loads(r['result']),'status':r['status'],'updated_at':r['updated_at']} for r in c.execute('SELECT * FROM matches ORDER BY updated_at DESC')]
class Decision(BaseModel):
    action:str
    reason:str=Field(min_length=10,max_length=2000)
@app.post('/api/matches/{rid}/decision')
def decision(rid:str,body:Decision):
    if body.action not in ('approve','reject','field','revert'): raise HTTPException(422,'Unknown action.')
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        r=c.execute('SELECT * FROM matches WHERE id=?',(rid,)).fetchone()
        if not r: raise HTTPException(404,'Match not found.')
        result=json.loads(r['result'])
        if body.action=='approve' and (result['legal_sensitive'] or result['tier']=='field'): raise HTTPException(409,'This match requires field verification. Legal or boundary conflicts cannot be approved in this workspace.')
        if body.action=='revert' and r['status']!='approved': raise HTTPException(409,'Only approved corrections can be reverted.')
        if body.action!='revert' and r['status'] not in ('pending','reverted'): raise HTTPException(409,'A decision has already been recorded.')
        status={'approve':'approved','reject':'rejected','field':'field verification','revert':'reverted'}[body.action]
        c.execute('UPDATE matches SET status=?,updated_at=? WHERE id=?',(status,now(),rid))
        log(c,f'review.{body.action}',rid,body.reason,{'before':r['status'],'after':status,'original':result['original'],'proposed':result['proposed']})
    return {'status':status}
@app.get('/api/export')
def export():
    with connect() as c:
        rows=c.execute("SELECT * FROM matches WHERE status='approved'").fetchall()
        features=[{**json.loads(r['result'])['proposed'],'properties':{**json.loads(r['result'])['proposed']['properties'],'_review_id':r['id'],'_source_id':r['left_source'],'_comparison_source_id':r['right_source'],'_reviewed_at':r['updated_at']}} for r in rows]
    return JSONResponse({'type':'FeatureCollection','features':features},headers={'Content-Disposition':'attachment; filename="harmonized-records.geojson"'})
@app.get('/api/audit')
def audit():
    with connect() as c: rows=[dict(r) for r in c.execute('SELECT * FROM audit ORDER BY id')]
    prev='GENESIS';valid=True
    for r in rows:
        digest=hashlib.sha256(json.dumps([r['at'],r['action'],r['subject'],r['actor'],r['reason'],r['payload'],r['previous_hash']],separators=(',',':')).encode()).hexdigest()
        valid=valid and prev==r['previous_hash'] and digest==r['hash'];prev=r['hash'];r['payload']=json.loads(r['payload'])
    return {'valid':valid,'entries':list(reversed(rows)),'note':'Hash-linked local audit; not an externally notarized ledger.'}
@app.get('/api/models')
def get_models(): return cards()
class PredictInput(BaseModel):
    features:dict
@app.post('/api/models/{name}/predict')
def predict(name:str,body:PredictInput):
    card=next((c for c in cards() if c['id']==name),None)
    if not card: raise HTTPException(404,'Model not found.')
    values={}
    for feature in card['inputs']:
        key=feature['name'];value=body.features.get(key)
        if feature['type']=='number':
            if not isinstance(value,(int,float)) or isinstance(value,bool) or not math.isfinite(value) or not feature['min']<=value<=feature['max']: raise HTTPException(422,f'{key} must be between {feature["min"]} and {feature["max"]}.')
        elif value not in feature['options']: raise HTTPException(422,f'Unsupported {key}.')
        values[key]=value
    prediction=model(name).predict_proba(pd.DataFrame([values]))[0]
    probs=[{'label':str(label),'probability':round(float(p),5)} for label,p in zip(model(name).classes_,prediction)]
    probs.sort(key=lambda p:-p['probability'])
    return {'prediction':probs[0]['label'],'probabilities':probs,'model_id':name,'artifact_sha256':card['artifact_sha256'],'limitation':card['limitation'],'probability_note':'Uncalibrated model scores; not operational risk probabilities.'}
class ScreenInput(BaseModel):
    sqm_per_person:float=Field(default=45,ge=10,le=1000)
    liters_per_person:float=Field(default=135,ge=1,le=1000)
@app.post('/api/relocation')
def relocation(body:ScreenInput):
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        result=screen_sites(sources(c),events(),body.sqm_per_person,body.liters_per_person)
        log(c,'relocation.screen','sites','Screened uploaded sites using explicit planning assumptions',{'assumptions':body.model_dump(),'results':result})
    return {'sites':result,'assumptions':body.model_dump(),'limitation':'Screening only. Hazard coverage completeness, land title, roads, utilities, community consent, and field suitability remain unverified. No automatic relocation approval.'}
