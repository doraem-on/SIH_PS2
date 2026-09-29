from pathlib import Path
import hashlib, json, requests
ROOT=Path(__file__).resolve().parents[1]
raw=ROOT/'data/raw';raw.mkdir(exist_ok=True)
manifest=json.loads((ROOT/'data/derived/provenance.json').read_text())
for filename,source in zip(['landslides.csv','covertype.zip'],manifest['sources']):
    target=raw/filename
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()==source['sha256']:
        print(f'Verified existing {filename}');continue
    print(f'Downloading {source["name"]}…',flush=True)
    response=requests.get(source['url'],timeout=180);response.raise_for_status()
    if hashlib.sha256(response.content).hexdigest()!=source['sha256']:
        raise SystemExit(f'{filename} changed upstream. Review the source and intentionally update provenance before retraining.')
    target.write_bytes(response.content)
    print(f'Checksum verified: {filename}')
