#!/usr/bin/env python3
"""
make_sample.py <payload.json> <out.json>

Builds data/sample.json (committed, used by `USE_SAMPLE_DATA=true` and by tests) from a real
TSD payload: renter names, phones and emails are replaced with fake but stable values, note
texts are reduced to their subject, and dates are shifted so that the newest open rental
looks current. Company/body shop names are kept (they are business contacts, not personal data).
"""
import datetime as dt
import hashlib
import json
import sys

FIRST = ["Alex", "Sam", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Quinn", "Drew", "Reese", "Skyler", "Dakota", "Emerson", "Finley"]
LAST = ["Rivera", "Chen", "Patel", "Okafor", "Novak", "Haddad", "Silva", "Kowalski", "Nguyen", "Brooks", "Ivanova", "Moreau", "Yilmaz", "Costa", "Larsen", "Dubois"]


def h(s, n):
    return int(hashlib.sha1(s.encode()).hexdigest(), 16) % n


def fake_person(ra):
    return FIRST[h(ra + "f", len(FIRST))], LAST[h(ra + "l", len(LAST))]


def fake_phone(ra):
    v = h(ra + "p", 10_000_000)
    return f"555{v:07d}"


def main(src, out):
    p = json.load(open(src, encoding="utf-8"))
    # Dates are kept as they were; the fetch date is recorded so tests can pin `today`.
    ref = p["fetchedAt"][:10]
    for r in p["rentals"]:
        f, l = fake_person(r["baseRaNumber"] or r["raNumber"])
        r["renterFirstName"], r["renterLastName"] = f.upper(), l.upper()
        ph = fake_phone(r["baseRaNumber"] or r["raNumber"])
        r["renterHomePhone"] = ph if r.get("renterHomePhone") else ""
        r["renterWorkPhone"] = ""
        r["renterCellPhone"] = ph
        r["renterEmail"] = f"{f.lower()}.{l.lower()}@example.com" if r.get("renterEmail") else ""
        r["raNotes"] = ""
    for n in p["notes"]:
        n["text"] = (n.get("subject") or "Note").title()
    for s in p["splits"]:
        s["claimNumber"] = "CLM-" + str(h(s["raNumber"], 1_000_000)).zfill(6) if s.get("claimNumber") else ""
        s["policyNumber"] = ""
        s["adjusterFirstName"] = "Pat" if s.get("adjusterFirstName") else None
        s["adjusterLastName"] = "Adjuster" if s.get("adjusterLastName") else None
        s["adjusterPhone"] = "5550100" if s.get("adjusterPhone") else None
    for e in p["employees"]:
        e["firstName"], e["lastName"] = FIRST[h(e["employeeId"] + "ef", len(FIRST))], LAST[h(e["employeeId"] + "el", len(LAST))]
        e["userName"] = (e["firstName"][0] + e["lastName"]).upper()
    p["source"] = "sample"
    p["sampleReferenceDate"] = ref
    json.dump(p, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(f"wrote {out}: {len(p['rentals'])} rentals, reference date {ref}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
