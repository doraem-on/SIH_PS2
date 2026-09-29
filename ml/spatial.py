"""Transparent geospatial rules. These scores are NOT learned probabilities."""
import math
from shapely.geometry import shape, mapping
from shapely import make_valid
from shapely.ops import transform
from pyproj import Transformer, Geod

GEOD = Geod(ellps='WGS84')
LEGAL = ('owner', 'title_id', 'parcel_id')

def distance(a, b):
    return abs(GEOD.inv(a.x, a.y, b.x, b.y)[2])

def validate_collection(fc):
    if not isinstance(fc, dict) or fc.get('type') != 'FeatureCollection':
        raise ValueError('Upload a GeoJSON FeatureCollection in EPSG:4326.')
    features = fc.get('features', [])
    if not isinstance(features, list) or not 1 <= len(features) <= 250:
        raise ValueError('Each layer must contain 1–250 features for this local pilot.')
    if fc.get('crs'):
        raise ValueError('Remove the legacy CRS field after reprojecting to EPSG:4326.')
    seen = set()
    for i, f in enumerate(features):
        if f.get('type') != 'Feature' or not isinstance(f.get('properties'), dict):
            raise ValueError(f'Feature {i+1} requires type Feature and a properties object.')
        g = shape(f.get('geometry'))
        if g.is_empty or g.geom_type not in ('Polygon', 'MultiPolygon', 'Point'):
            raise ValueError(f'Feature {i+1}: use nonempty Polygon, MultiPolygon, or Point.')
        bounds = g.bounds
        if not all(math.isfinite(v) for v in bounds) or not (-180 <= bounds[0] <= bounds[2] <= 180 and -85 <= bounds[1] <= bounds[3] <= 85):
            raise ValueError(f'Feature {i+1}: invalid WGS84 coordinates.')
        key = str(f.get('id', f['properties'].get('parcel_id', i+1)))
        if key in seen: raise ValueError('Feature identifiers must be unique within a layer.')
        seen.add(key)
        f['id'] = key
    return fc

def projected_pair(a, b):
    center = a.centroid
    crs = f'+proj=laea +lat_0={center.y} +lon_0={center.x} +datum=WGS84 +units=m'
    project = Transformer.from_crs('EPSG:4326', crs, always_xy=True).transform
    return transform(project, a), transform(project, b)

def topology_issues(source):
    features=source['geojson']['features']; issues={str(f['id']):[] for f in features}
    for i,a in enumerate(features):
        ga=shape(a['geometry'])
        if not ga.is_valid: issues[str(a['id'])].append('Invalid source geometry')
        for b in features[i+1:]:
            gb=shape(b['geometry'])
            if not ga.intersects(gb): continue
            aa,bb=projected_pair(make_valid(ga),make_valid(gb))
            overlap=aa.intersection(bb).area
            if overlap>1:
                issues[str(a['id'])].append(f'Overlap with {b["id"]}: {overlap:.1f} m²')
                issues[str(b['id'])].append(f'Overlap with {a["id"]}: {overlap:.1f} m²')
    return issues

def match_layers(left, right):
    results = []
    left_topology=topology_issues(left);right_topology=topology_issues(right)
    for a in left['geojson']['features']:
        ga = shape(a['geometry']); pa = a['properties']
        candidates = []
        for b in right['geojson']['features']:
            gb = shape(b['geometry']); pb = b['properties']
            d = distance(ga.centroid, gb.centroid)
            same_id = bool(pa.get('parcel_id')) and pa.get('parcel_id') == pb.get('parcel_id')
            if d <= 100 or same_id:
                aa, bb = projected_pair(make_valid(ga), make_valid(gb))
                union = aa.union(bb).area
                iou = aa.intersection(bb).area / union if union > 0 else max(0, 1-d/100)
                candidates.append((iou + int(same_id), b, d, iou))
        if not candidates:
            results.append({'left_id':a['id'], 'right_id':None, 'confidence':0, 'tier':'field', 'conflicts':['No candidate within 100 m or with the same parcel ID'], 'evidence':{}, 'original':a, 'proposed':a, 'legal_sensitive':True})
            continue
        candidates.sort(key=lambda x:x[0], reverse=True)
        _, b, d, iou = candidates[0]; pb=b['properties']
        keys = sorted(set(pa) | set(pb))
        comparable = [k for k in keys if pa.get(k) is not None and pb.get(k) is not None]
        agreed = [k for k in comparable if str(pa[k]).strip().lower() == str(pb[k]).strip().lower()]
        completeness = len(comparable)/max(1,len(keys))
        attributes = len(agreed)/max(1,len(comparable))*completeness
        position = math.exp(-d/25)
        reliability = (left['reliability']+right['reliability'])/200
        score = round(100*(.4*iou + .25*position + .2*attributes + .15*reliability),1)
        legal = [k for k in LEGAL if k in comparable and k not in agreed]
        missing = [k for k in ('owner','title_id','parcel_id') if not pa.get(k) or not pb.get(k)]
        boundary = iou < .98
        invalid = not ga.is_valid or not shape(b['geometry']).is_valid
        ambiguous = len(candidates)>1 and candidates[0][0]-candidates[1][0]<.05
        conflicts = [f'{k}: source values disagree' for k in comparable if k not in agreed]
        conflicts += [f'Missing legal evidence: {k}' for k in missing]
        if boundary: conflicts.append('Boundary disagreement: original geometries retained')
        if invalid: conflicts.append('Invalid topology: repair proposal requires field verification')
        if ambiguous: conflicts.append('Ambiguous match: multiple comparable candidates')
        topology=left_topology.get(str(a['id']),[])+right_topology.get(str(b['id']),[])
        conflicts += topology
        sensitive = bool(legal or missing or boundary or invalid or ambiguous or topology)
        tier = 'field' if sensitive or score < 60 else 'review' if score < 85 or conflicts else 'ready'
        proposed = {**a, 'properties':dict(pa)}
        # Only nonlegal land-use attributes receive a precedence proposal.
        # This is an explicit pilot convention, not a claim of statutory authority.
        precedence={'survey':3,'cadastral':2,'revenue':1}
        chosen=pb if isinstance(pb.get('land_use'),str) and precedence.get(right['kind'],0)>precedence.get(left['kind'],0) else pa
        if isinstance(chosen.get('land_use'), str): proposed['properties']['land_use']=chosen['land_use'].strip().lower().replace(' ', '_')
        resolution={'attribute':'land_use','left_value':pa.get('land_use'),'right_value':pb.get('land_use'),'proposed_value':proposed['properties'].get('land_use'),'rule':'Pilot precedence: survey > cadastral > revenue; ties preserve the reference. Reviewer approval required. Legal attributes never copied.'}
        results.append({'left_id':a['id'], 'right_id':b['id'], 'confidence':score, 'tier':tier,'conflicts':conflicts, 'legal_sensitive':sensitive,
            'evidence':{'geometry_iou':round(iou,4),'centroid_distance_m':round(d,2),'position_score':round(position,4),'attribute_agreement':round(attributes,4),'source_reliability':reliability,'reliability_basis':'User-declared; not independently verified','weights':{'geometry':.4,'position':.25,'attributes':.2,'source':.15},'candidate_count':len(candidates),'left_source':left['name'],'right_source':right['name'],'agreed_attributes':agreed},
            'attribute_resolution':resolution,'topology_repair_preview':mapping(make_valid(ga)) if not ga.is_valid else None,'original':a,'comparison':b,'proposed':proposed})
    # A many-to-one match must never become approval-ready.
    counts={}
    for r in results:
        if r['right_id'] is not None: counts[r['right_id']]=counts.get(r['right_id'],0)+1
    for r in results:
        if counts.get(r['right_id'],0)>1:
            r.update(tier='field',legal_sensitive=True)
            r['conflicts'].append('Many-to-one match requires independent verification')
    return results

def screen_sites(sources, events, sqm_per_person=45, liters_per_person=135):
    sites=[f for s in sources if s['kind']=='site' for f in s['geojson']['features']]
    hazards=[shape(f['geometry']) for s in sources if s['kind']=='hazard' for f in s['geojson']['features']]
    homes=[f for s in sources if s['kind']=='habitation' for f in s['geojson']['features']]
    result=[]
    for f in sites:
        g=shape(f['geometry']); p=f['properties']; center=g.centroid
        if g.geom_type in ('Polygon','MultiPolygon') and g.is_valid:
            area=abs(GEOD.geometry_area_perimeter(g)[0])
        else: area=None
        water=p.get('water_lpd')
        area_capacity=math.floor(area/sqm_per_person) if area else None
        water_capacity=math.floor(float(water)/liters_per_person) if isinstance(water,(int,float)) and math.isfinite(water) and water>=0 else None
        capacity=min(area_capacity,water_capacity) if area_capacity is not None and water_capacity is not None else None
        intersects=any(g.intersects(h) for h in hazards)
        nearby=sum(distance(center,shape(e['geometry']))<=10000 for e in events['features'])
        exposed=[]; missing_population=0
        for home in homes:
            hg=shape(home['geometry']); hp=home['properties']
            pop=hp.get('population')
            intersects_home=any(hg.intersects(h) for h in hazards)
            if intersects_home and (not isinstance(pop,(int,float)) or not math.isfinite(pop) or pop<0): missing_population+=1
            if intersects_home and isinstance(pop,(int,float)) and math.isfinite(pop) and pop>0:
                exposed.append({'id':home['id'],'name':hp.get('name',home['id']),'population':int(pop),'distance_km':round(distance(center,hg.centroid)/1000,2)})
        exposed.sort(key=lambda h:h['distance_km'])
        status='excluded' if intersects else 'not assessed' if not hazards or capacity is None else 'review required'
        result.append({'id':f['id'],'name':p.get('name',f['id']),'area_m2':round(area,1) if area else None,'capacity':capacity,'area_capacity':area_capacity,'water_capacity':water_capacity,'historical_events_10km':nearby,'status':status,'exposed_habitations':exposed,'population_demand':None if not hazards or missing_population else sum(h['population'] for h in exposed),'habitations_missing_population':missing_population,'geometry':f['geometry']})
    return sorted(result,key=lambda s:(s['status']=='excluded',s['capacity'] is None,-(s['capacity'] or 0)))
