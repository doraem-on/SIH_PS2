"""Build a low-memory representation; never modifies the trained source artifact."""
import json
import sys
from pathlib import Path
import joblib
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from ml.compact_forest import export_forest, file_sha

card = next(c for c in json.loads((ROOT/'models/registry.json').read_text()) if c['id']=='forest-cover')
source = ROOT/'models/forest-cover.joblib'
if file_sha(source) != card['artifact_sha256']:
    raise RuntimeError('Trained model checksum mismatch')
export_forest(joblib.load(source), ROOT/'models/forest-compact', card['artifact_sha256'])
print('Prepared memory-mapped inference for the original 100 trained trees.')
