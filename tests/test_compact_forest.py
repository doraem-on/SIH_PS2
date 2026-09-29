"""Compare deployment traversal to sklearn, including split-threshold boundaries."""
import numpy as np
import pandas as pd
import pytest
from sklearn.ensemble import ExtraTreesClassifier
from ml.compact_forest import export_forest, CompactForest


def test_compact_forest_matches_sklearn_and_rejects_corruption(tmp_path):
    rng = np.random.default_rng(42)
    x = pd.DataFrame(rng.normal(size=(300, 3)), columns=['a', 'b', 'c'])
    y = np.where(x.a > .2, 'first', np.where(x.b > -.1, 'second', 'third'))
    model = ExtraTreesClassifier(n_estimators=11, max_depth=8, random_state=42).fit(x, y)
    export_forest(model, tmp_path, 'original-trained-hash')
    compact = CompactForest(tmp_path, 'original-trained-hash')
    points = pd.DataFrame(rng.normal(size=(100, 3)), columns=x.columns)
    tree = model.estimators_[0].tree_
    for node in np.flatnonzero(tree.children_left >= 0)[:20]:
        row = np.zeros(3)
        row[tree.feature[node]] = tree.threshold[node]
        points.loc[len(points)] = row
    np.testing.assert_allclose(compact.predict_proba(points), model.predict_proba(points), atol=1e-14, rtol=0)
    assert list(compact.classes_) == list(model.classes_)
    with pytest.raises(ValueError, match='source checksum'):
        CompactForest(tmp_path, 'different-trained-hash')
    with open(tmp_path/'threshold.npy', 'ab') as stream:
        stream.write(b'corrupt')
    with pytest.raises(ValueError, match='checksum'):
        CompactForest(tmp_path, 'original-trained-hash')
