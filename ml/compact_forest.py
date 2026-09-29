"""Memory-mapped inference for the unchanged, trained Covertype forest.

Each tree is traversed using sklearn's float32 inputs and float64 thresholds.
This is a deployment representation, not a new model or a retraining step.
"""
import hashlib
import json
from pathlib import Path
import numpy as np


def file_sha(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def export_forest(model, directory, source_sha):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    roots = []
    total = sum(tree.tree_.node_count for tree in model.estimators_)
    specs = {'left': (np.int32, (total,)), 'right': (np.int32, (total,)),
             'feature': (np.int32, (total,)), 'threshold': (np.float64, (total,)),
             'value': (np.float64, (total, len(model.classes_)))}
    arrays = {key: np.lib.format.open_memmap(directory / f'{key}.npy', mode='w+', dtype=dtype, shape=shape)
              for key, (dtype, shape) in specs.items()}
    offset = 0
    for estimator in model.estimators_:
        tree = estimator.tree_
        roots.append(offset)
        end = offset + tree.node_count
        arrays['left'][offset:end] = np.where(tree.children_left < 0, -1, tree.children_left + offset)
        arrays['right'][offset:end] = np.where(tree.children_right < 0, -1, tree.children_right + offset)
        arrays['feature'][offset:end] = tree.feature
        arrays['threshold'][offset:end] = tree.threshold
        values = tree.value[:, 0, :]
        arrays['value'][offset:end] = values / values.sum(axis=1, keepdims=True)
        offset = end
    for array in arrays.values():
        array.flush()
    manifest = {'source_sha256': source_sha, 'classes': list(model.classes_),
                'features': list(model.feature_names_in_), 'roots': roots,
                'files': {key: file_sha(directory / f'{key}.npy') for key in specs}}
    (directory / 'manifest.json').write_text(json.dumps(manifest))


class CompactForest:
    def __init__(self, directory, source_sha):
        directory = Path(directory)
        manifest = json.loads((directory / 'manifest.json').read_text())
        if manifest['source_sha256'] != source_sha:
            raise ValueError('Compact model source checksum mismatch')
        self.arrays = {}
        for key in ('left', 'right', 'feature', 'threshold', 'value'):
            path = directory / f'{key}.npy'
            if file_sha(path) != manifest['files'][key]:
                raise ValueError('Compact model checksum mismatch')
            self.arrays[key] = np.load(path, mmap_mode='r', allow_pickle=False)
        self.classes_ = np.array(manifest['classes'])
        self.features = manifest['features']
        self.roots = manifest['roots']

    def predict_proba(self, frame):
        values = frame[self.features].to_numpy(dtype=np.float32)
        results = np.zeros((len(values), len(self.classes_)), dtype=np.float64)
        a = self.arrays
        for row_index, row in enumerate(values):
            for root in self.roots:
                node = root
                while a['left'][node] != -1:
                    node = a['left'][node] if row[a['feature'][node]] <= a['threshold'][node] else a['right'][node]
                results[row_index] += a['value'][node]
        return results / len(self.roots)
