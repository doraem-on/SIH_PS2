"""Reproduce the two CPU models and all displayed evaluation metrics from real observations."""
from pathlib import Path
import io, json, hashlib, zipfile, gzip, platform
from datetime import datetime, timezone
import numpy as np
import pandas as pd
import joblib, sklearn
from sklearn.ensemble import RandomForestClassifier, ExtraTreesClassifier
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder
from sklearn.pipeline import make_pipeline
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score, confusion_matrix, classification_report
from sklearn.dummy import DummyClassifier
ROOT=Path(__file__).resolve().parents[1]
RAW=ROOT/'data/raw'; OUT=ROOT/'models'; OUT.mkdir(exist_ok=True)
DER=ROOT/'data/derived'; DER.mkdir(exist_ok=True)
SEED=42

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def save_card(name,title,source,source_url,raw_path,estimator,xtrain,xtest,ytrain,ytest,inputs,split,limitation,total_rows,extra=None):
    print(f'Training {name}: {len(xtrain):,} observations',flush=True)
    estimator.fit(xtrain,ytrain)
    predicted=estimator.predict(xtest)
    dummy=DummyClassifier(strategy='most_frequent').fit(xtrain,ytrain)
    path=OUT/f'{name}.joblib';joblib.dump(estimator,path,compress=3)
    card={'id':name,'title':title,'algorithm':type(estimator.steps[-1][1]).__name__ if hasattr(estimator,'steps') else type(estimator).__name__,
        'source':source,'source_url':source_url,'data_sha256':sha(raw_path),'artifact_sha256':sha(path),'trained_at':datetime.now(timezone.utc).isoformat(),
        'seed':SEED,'dataset_rows':total_rows,'train_rows':len(xtrain),'test_rows':len(xtest),'features':len(inputs),'split':split,'inputs':inputs,
        'metrics':{'accuracy':accuracy_score(ytest,predicted),'balanced_accuracy':balanced_accuracy_score(ytest,predicted),'macro_f1':f1_score(ytest,predicted,average='macro'),'baseline_accuracy':accuracy_score(ytest,dummy.predict(xtest))},
        'classes':list(estimator.classes_),'confusion_matrix':confusion_matrix(ytest,predicted,labels=estimator.classes_).tolist(),
        'classification_report':classification_report(ytest,predicted,output_dict=True,zero_division=0),'limitation':limitation,
        'versions':{'python':platform.python_version(),'sklearn':sklearn.__version__},'evaluation_note':'Single frozen holdout; no hyperparameter selection on test data. Probabilities are not calibrated.',**(extra or {})}
    if hasattr(estimator,'feature_importances_'): card['importance']=[{'name':n,'value':float(v)} for n,v in zip(xtrain.columns,estimator.feature_importances_)]
    print(json.dumps(card['metrics']),flush=True)
    return card

def numeric_inputs(df):
    return [{'name':col,'label':col.replace('_',' ').capitalize(),'type':'number','min':float(df[col].min()),'max':float(df[col].max()),'default':float(df[col].median())} for col in df.columns]

# NASA GLC: observed event-size classification, not event occurrence prediction.
df=pd.read_csv(RAW/'landslides.csv')
df['date']=pd.to_datetime(df.event_date,format='mixed',errors='coerce')
df=df.drop_duplicates(subset=['event_id']).dropna(subset=['latitude','longitude','date'])
df=df[df.latitude.between(-85,85)&df.longitude.between(-180,180)]
features=[]
for _,r in df.iterrows():
    def value(key,default='Unknown'): return str(r[key]) if pd.notna(r[key]) else default
    features.append({'type':'Feature','id':str(r.event_id),'geometry':{'type':'Point','coordinates':[float(r.longitude),float(r.latitude)]},'properties':{'id':str(r.event_id),'title':value('event_title'),'date':r.date.strftime('%Y-%m-%d'),'country':value('country_name'),'region':value('admin_division_name'),'size':value('landslide_size','unknown'),'trigger':value('landslide_trigger','unknown'),'category':value('landslide_category'),'fatalities':int(r.fatality_count) if pd.notna(r.fatality_count) else None,'accuracy':value('location_accuracy'),'source':value('source_name'),'source_url':value('source_link',''),'description':value('event_description','')}})
(DER/'events.geojson').write_text(json.dumps({'type':'FeatureCollection','features':features},separators=(',',':')))
# Omit outcomes, report text, population, and size-derived fields from predictors.
selected=df[df.landslide_size.isin(['small','medium','large','very_large','catastrophic'])].copy()
selected['target']=selected.landslide_size.replace({'very_large':'large','catastrophic':'large'})
selected['month']=selected.date.dt.month
cols=['latitude','longitude','month','landslide_trigger','landslide_category','landslide_setting']
x=selected[cols].copy()
for c in cols[3:]: x[c]=x[c].fillna('unknown')
y=selected.target
# Keep entire calendar dates on one side of a chronological split.
cutoff=selected.date.sort_values().iloc[int(len(selected)*.8)].normalize()
mask=selected.date<cutoff
pipe=make_pipeline(ColumnTransformer([('category',OneHotEncoder(handle_unknown='ignore',sparse_output=False),cols[3:])],remainder='passthrough'),RandomForestClassifier(n_estimators=140,max_depth=16,min_samples_leaf=5,class_weight='balanced_subsample',random_state=SEED,n_jobs=4))
inputs=numeric_inputs(x[cols[:3]])+[{'name':c,'label':c.replace('_',' ').capitalize(),'type':'category','options':sorted(x.loc[mask,c].unique().tolist()),'default':x.loc[mask,c].mode()[0]} for c in cols[3:]]
card1=save_card('landslide-size','Landslide event size','NASA Global Landslide Catalog','https://catalog.data.gov/dataset/global-landslide-catalog-export',RAW/'landslides.csv',pipe,x[mask],x[~mask],y[mask],y[~mask],inputs,f'Chronological holdout: train before {cutoff.date()}, test on/after. Entire dates separated.','Research baseline for the size of an already reported event. Reporting bias, approximate locations, geographic imbalance, and weak temporal generalization limit use. Does not predict whether a landslide will occur or declare land safe.',len(df),{'target':'Reported size: small / medium / large (very_large and catastrophic grouped with large)','excluded_rows':len(df)-len(selected),'train_class_counts':y[mask].value_counts().to_dict(),'test_class_counts':y[~mask].value_counts().to_dict()})

# UCI Covertype: measured forest types, no synthetic records or fabricated labels.
with zipfile.ZipFile(RAW/'covertype.zip') as z:
    filename=next(n for n in z.namelist() if n.endswith('covtype.data.gz'))
    cov=pd.read_csv(io.BytesIO(gzip.decompress(z.read(filename))),header=None)
cols=['elevation','aspect','slope','horizontal_distance_to_hydrology','vertical_distance_to_hydrology','horizontal_distance_to_roadways','hillshade_9am','hillshade_noon','hillshade_3pm','horizontal_distance_to_fire_points']
x=cov.iloc[:,:10].copy();x.columns=cols
labels={1:'Spruce / Fir',2:'Lodgepole Pine',3:'Ponderosa Pine',4:'Cottonwood / Willow',5:'Aspen',6:'Douglas-fir',7:'Krummholz'}
y=cov.iloc[:,-1].map(labels)
# A reproducible 150k stratified subset keeps CPU/runtime/artifact sizes manageable.
idx,_=train_test_split(np.arange(len(x)),train_size=150000,stratify=y,random_state=SEED)
x=x.iloc[idx];y=y.iloc[idx]
a,b,c,d=train_test_split(x,y,test_size=.2,stratify=y,random_state=SEED)
rf=ExtraTreesClassifier(n_estimators=100,max_depth=24,min_samples_leaf=2,max_features=.85,n_jobs=4,random_state=SEED)
card2=save_card('forest-cover','Terrain → forest cover','UCI Covertype · US Forest Service','https://archive.ics.uci.edu/dataset/31/covertype',RAW/'covertype.zip',rf,a,b,c,d,numeric_inputs(x),'Stratified 80/20 split of a seeded 150,000-row stratified sample (120,000 train / 30,000 test).','Colorado wilderness benchmark using ten continuous cartographic features. Random split may overstate geographic generalization. Not validated for India; never used to determine Indian land cover or relocation suitability. No imagery segmentation is claimed.',len(cov),{'license':'CC BY 4.0','citation':'Blackard, J. (1998). Covertype. UCI Machine Learning Repository. DOI: 10.24432/C50K5N','sample_rows':150000,'target':'Seven observed forest cover types','sample':{k:float(v) for k,v in b.iloc[0].items()},'sample_expected_label':str(d.iloc[0])})
(OUT/'registry.json').write_text(json.dumps([card1,card2],indent=2))
manifest={'downloaded_at':datetime.now(timezone.utc).isoformat(),'sources':[{'name':'NASA Global Landslide Catalog','url':'https://data.nasa.gov/docs/legacy/Global_Landslide_Catalog_Export/Global_Landslide_Catalog_Export_rows.csv','sha256':sha(RAW/'landslides.csv'),'rows':len(df),'license':'NASA catalog metadata does not specify a license; public access. Preserve NASA attribution and event source links.'},{'name':'UCI Covertype','url':'https://archive.ics.uci.edu/static/public/31/covertype.zip','sha256':sha(RAW/'covertype.zip'),'rows':len(cov),'license':'CC BY 4.0','citation':card2['citation']}]}
(DER/'provenance.json').write_text(json.dumps(manifest,indent=2))
print('Training and provenance export complete.',flush=True)
