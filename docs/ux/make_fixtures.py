"""Create isolated, mutable UX-evaluation fixtures: `python docs/ux/make_fixtures.py OUT.json NAME [NAME ...]`.

Per name: a duplication incident (unique fingerprint so it never merges with other fixtures) with an investigation
awaiting review and a recovery proposal, plus an open manual incident for the start-investigation journey.
Fixture-only data change: the fingerprint suffix `:ux-<name>-<run>` (unique across rounds) is what keeps the incidents separate.
"""

import json
import sys

from drc import agent, obs, pipeline, quality, store

obs.setup("drc-ux-fixtures")
out_path, names = sys.argv[1], sys.argv[2:]
out = {}
for name in names:
    run = pipeline.execute("DUP-01")
    inc = quality.detect(run)
    inv = agent.create(inc, provider="fake")
    st = agent.run(inv)
    with store.connect() as c:
        c.execute("update incident set fingerprint = fingerprint || %s where id=%s", (f":ux-{name}-{run}", inc))
    manual = quality.report_manual(run, "rpt_daily_collections", f"UX fixture {name}: analyst suspects totals are off")
    out[name] = {"dup_incident": inc, "dup_investigation": inv, "dup_proposal": st.get("proposal_id"),
                 "open_manual_incident": manual}
    print(name, out[name], flush=True)
json.dump(out, open(out_path, "w"), indent=2)
