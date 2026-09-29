import copy
import pytest
from fastapi.testclient import TestClient
from ml import api
from ml.spatial import match_layers, validate_collection, screen_sites

@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setattr(api,'DB',tmp_path/'test.sqlite')
    return TestClient(api.app)

def feature(owner='Verified person',offset=0,land_use=' Residential '):
    x=76.3+offset;y=32.2
    return {'type':'Feature','id':'A','properties':{'parcel_id':'A','owner':owner,'title_id':'TITLE-A','land_use':land_use},'geometry':{'type':'Polygon','coordinates':[[[x,y],[x+.001,y],[x+.001,y+.001],[x,y+.001],[x,y]]]}}

def layer(name='Survey',f=None,kind='survey'):
    return {'name':name,'kind':kind,'reliability':95,'geojson':{'type':'FeatureCollection','features':[f or feature()]}}

def import_pair(client,a=None,b=None):
    l=client.post('/api/sources',json=a or layer('Reference')).json()['id']
    r=client.post('/api/sources',json=b or layer('Comparison')).json()['id']
    response=client.post('/api/harmonize',json={'left_source':l,'right_source':r})
    assert response.status_code==200
    return response.json()['matches'][0]

def test_safe_correction_reversible_and_audited(client):
    m=import_pair(client)
    assert m['tier']=='ready' and not m['legal_sensitive']
    rid=m['id'];reason='Inspected both sources and confirmed the normalization.'
    assert client.post(f'/api/matches/{rid}/decision',json={'action':'approve','reason':reason}).status_code==200
    out=client.get('/api/export').json()['features']
    assert out[0]['properties']['land_use']=='residential'
    assert client.get('/api/sources').json()[0]['geojson']['features'][0]['properties']['land_use']==' Residential '
    assert client.post(f'/api/matches/{rid}/decision',json={'action':'revert','reason':reason}).status_code==200
    assert client.get('/api/export').json()['features']==[]
    audit=client.get('/api/audit').json()
    assert audit['valid'] and len(audit['entries'])==5

def test_legal_conflict_cannot_be_approved(client):
    m=import_pair(client,b=layer('Conflicting title',feature(owner='Other person')))
    assert m['tier']=='field'
    assert client.post(f'/api/matches/{m["id"]}/decision',json={'action':'approve','reason':'Trying to approve conflicting legal evidence.'}).status_code==409
    assert client.post(f'/api/matches/{m["id"]}/decision',json={'action':'field','reason':'Send disputed title for field verification.'}).status_code==200

def test_missing_legal_evidence_and_displaced_boundary():
    a=layer();b=layer('B');b['geojson']['features'][0]['properties'].pop('owner')
    assert match_layers(a,b)[0]['tier']=='field'
    assert match_layers(a,layer('B',feature(offset=.0005)))[0]['legal_sensitive']

def test_many_to_one_is_field_verification():
    a=layer();f=feature();f['id']='B';a['geojson']['features'].append(f)
    assert all(r['tier']=='field' for r in match_layers(a,layer('B')))

def test_invalid_and_duplicate_uploads_rejected(client):
    x=layer();x['geojson']['features'][0]['geometry']['coordinates'][0][0]=[300,99]
    assert client.post('/api/sources',json=x).status_code==422
    x=layer();assert client.post('/api/sources',json=x).status_code==201
    assert client.post('/api/sources',json=x).status_code==409
    x['geojson']['features'].append(copy.deepcopy(x['geojson']['features'][0]))
    with pytest.raises(ValueError): validate_collection(x['geojson'])

def test_site_missing_data_is_not_safe_and_hazard_excludes():
    s=layer('Site',kind='site');s['geojson']['features'][0]['properties']['water_lpd']=13500
    empty={'type':'FeatureCollection','features':[]}
    r=screen_sites([s],empty)[0]
    assert r['status']=='not assessed' and r['capacity']==100
    h=layer('Hazard',kind='hazard')
    assert screen_sites([s,h],empty)[0]['status']=='excluded'
    s['geojson']['features'][0]['properties'].pop('water_lpd')
    assert screen_sites([s],empty)[0]['capacity'] is None

def test_unknown_population_is_not_counted_as_zero_exposure():
    s=layer('Site',kind='site');h=layer('Hazard',kind='hazard');home=layer('Habitation',kind='habitation')
    home['geojson']['features'][0]['properties']['population']=-100
    assert screen_sites([s,h,home],{'features':[]})[0]['exposed_habitations']==[]

def test_audit_tampering_detected(client):
    client.post('/api/sources',json=layer())
    with api.connect() as c:c.execute("UPDATE audit SET reason='tampered'")
    assert client.get('/api/audit').json()['valid'] is False

def test_model_inference_uses_saved_artifacts(client):
    for c in client.get('/api/models').json():
        response=client.post(f'/api/models/{c["id"]}/predict',json={'features':{f['name']:f['default'] for f in c['inputs']}})
        assert response.status_code==200,response.text
        result=response.json()
        assert result['prediction'] in c['classes']
        assert abs(sum(p['probability'] for p in result['probabilities'])-1)<.0001
        assert result['artifact_sha256']==c['artifact_sha256']
        assert client.post(f'/api/models/{c["id"]}/predict',json={'features':{}}).status_code==422

def test_real_catalog_has_india_and_provenance(client):
    fc=client.get('/api/events?country=India').json()
    assert len(fc['features'])>100
    assert all(f['properties']['country']=='India' for f in fc['features'])
    assert all(f['geometry']['type']=='Point' for f in fc['features'])
    assert client.get('/api/events?country=India&q=NONEXISTENT___').json()['features']==[]

def test_explicit_landuse_precedence_requires_review():
    left=layer('Revenue',feature(land_use='agricultural'),kind='revenue')
    right=layer('Survey',feature(land_use='Residential'),kind='survey')
    r=match_layers(left,right)[0]
    assert r['proposed']['properties']['land_use']=='residential'
    assert r['original']['properties']['land_use']=='agricultural'
    assert r['tier']=='review' and not r['legal_sensitive']

def test_intra_layer_overlap_cannot_be_approved():
    left=layer();other=feature(offset=.0005);other['id']='B';other['properties']['parcel_id']='B'
    left['geojson']['features'].append(other)
    r=match_layers(left,layer('Comparison'))[0]
    assert r['tier']=='field' and any('Overlap' in c for c in r['conflicts'])

@pytest.fixture
def hosted_client(tmp_path,monkeypatch):
    monkeypatch.setenv('BHOOMI_DEPLOYMENT_MODE','public')
    monkeypatch.setenv('BHOOMI_INTERNAL_TOKEN','test-gateway-only')
    monkeypatch.setenv('BHOOMI_WORKSPACE_DIR',str(tmp_path/'workspaces'))
    return TestClient(api.app)

def test_hosted_workspaces_cannot_read_each_others_records(hosted_client):
    a={'x-internal-token':'test-gateway-only','x-workspace-id':'a'*32}
    b={'x-internal-token':'test-gateway-only','x-workspace-id':'b'*32}
    assert hosted_client.post('/api/sources',json=layer(),headers=a).status_code==201
    assert len(hosted_client.get('/api/sources',headers=a).json())==1
    assert hosted_client.get('/api/sources',headers=b).json()==[]
    assert hosted_client.get('/api/audit',headers=b).json()['entries']==[]
    assert hosted_client.get('/api/overview',headers=b).json()['sources']==0

def test_public_api_requires_gateway_and_safe_workspace_id(hosted_client):
    assert hosted_client.get('/api/sources').status_code==403
    assert hosted_client.get('/api/sources',headers={'x-internal-token':'test-gateway-only','x-workspace-id':'../escape'}).status_code==403
    assert hosted_client.get('/api/models',headers={'x-internal-token':'test-gateway-only'}).status_code==200
