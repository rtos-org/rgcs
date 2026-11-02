#!/usr/bin/env python3
"""Flatten ArduPilot's apm.pdef.json (Tools/autotest/param_metadata/param_parse.py --vehicle ArduCopter
--format json; needs lxml, so run it in a venv) into the UI asset the parameter table reads.

    python3 scripts/sync-params-meta.py /path/to/apm.pdef.json

Output: apps/rgcs-server/ui/public/params/arducopter.json — {NAME: {n, d, u?, r?, v?, b?, i?, reboot?}}
"""
import json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DST = ROOT / "apps/rgcs-server/ui/public/params/arducopter.json"

if len(sys.argv) != 2:
    sys.exit(__doc__)
src = json.load(open(sys.argv[1], encoding="utf-8"))
out = {}
for group, params in src.items():
    if not isinstance(params, dict):
        continue
    for name, m in params.items():
        if not isinstance(m, dict) or name in out:
            continue
        e = {"n": m.get("DisplayName", name), "d": m.get("Description", "")}
        if m.get("Units"):
            e["u"] = m["Units"]
        r = m.get("Range")
        if isinstance(r, dict) and "low" in r and "high" in r:
            try:
                e["r"] = [float(r["low"]), float(r["high"])]
            except ValueError:
                pass
        if isinstance(m.get("Values"), dict):
            e["v"] = {str(k): str(v) for k, v in m["Values"].items()}
        if isinstance(m.get("Bitmask"), dict):
            e["b"] = {str(k): str(v) for k, v in m["Bitmask"].items()}
        if m.get("Increment"):
            try:
                e["i"] = float(m["Increment"])
            except ValueError:
                pass
        if str(m.get("RebootRequired", "")).lower() == "true":
            e["reboot"] = True
        out[name] = e
DST.parent.mkdir(parents=True, exist_ok=True)
DST.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"wrote {DST.relative_to(ROOT)}: {len(out)} parameters, {DST.stat().st_size // 1024} KB")
