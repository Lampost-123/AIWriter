# From mcreader-v2, tts/app/workers/__init__.py (Adam's rule, 2 October 2026: only speech code is reused).
"""Worker processes, one per engine that needs its own Python environment.

Each runs as `venvs/<engine>/Scripts/python -m app.workers.<engine>` (bin/python off Windows)
and speaks one JSON line per request on stdin/stdout. See `_common.serve`.
"""
