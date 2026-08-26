"""Semantic matching for new exercise names against the existing catalog.

Used by routes/exercise_plan.py's "propose a new exercise" flow: before a
typed name that didn't substring-match anything gets sent to admin approval,
we check whether it's plausibly the same exercise as one already in the
catalog under different wording (e.g. "DB Row" vs "Dumbbell Row") and ask the
user to confirm rather than silently merging or silently creating a
duplicate - see the design discussion this came out of for why silent
auto-merge isn't safe (an unrelated exercise sharing a common word, e.g.
"Copenhagen Plank" vs "Plank", scores about as high as genuine synonyms do).

Uses model2vec (static embeddings, no torch/GPU) rather than
sentence-transformers, whose torch dependency alone would likely blow the
512MB disk quota on the free PythonAnywhere host this app deploys to. The
model is vendored into data/exercise-match-model/ rather than fetched from
Hugging Face at runtime, since PythonAnywhere's free tier also restricts
outbound internet access to a small allowlist that may not include it.
"""
import os

import numpy as np

from paths import BASE_DIR

MODEL_PATH = os.path.join(BASE_DIR, "data", "exercise-match-model")

# Candidates below this are noise (shared stopwords, same muscle group, no
# real relation) - not worth surfacing even as a "did you mean" option.
# Empirically, genuinely-different exercises that share a word can still
# score into the 0.6-0.8 range (see module docstring), so this is
# deliberately loose: false positives here just cost the user one "No,
# that's different" tap, while missing a real match sends a duplicate to
# admin review instead. Tune based on real usage.
MIN_SIMILARITY = 0.35
MAX_CANDIDATES = 3

_model = None


def _get_model():
    global _model
    if _model is None:
        from model2vec import StaticModel
        _model = StaticModel.from_pretrained(MODEL_PATH)
    return _model


def best_matches(query, candidates):
    """Ranks `candidates` (existing exercise names) by similarity to `query`
    (a newly typed name), most similar first. Returns at most
    MAX_CANDIDATES entries as [{"exercise": str, "score": float}, ...],
    filtered to MIN_SIMILARITY and up. Empty list if `candidates` is empty."""
    if not candidates:
        return []
    model = _get_model()
    vectors = model.encode([query, *candidates])
    query_vec, candidate_vecs = vectors[0], vectors[1:]
    query_norm = np.linalg.norm(query_vec)
    if query_norm == 0:
        return []
    norms = np.linalg.norm(candidate_vecs, axis=1)
    scores = (candidate_vecs @ query_vec) / np.where(norms == 0, 1, norms) / query_norm
    ranked = sorted(zip(candidates, scores), key=lambda pair: pair[1], reverse=True)
    return [
        {"exercise": name, "score": round(float(score), 3)}
        for name, score in ranked[:MAX_CANDIDATES]
        if score >= MIN_SIMILARITY
    ]
