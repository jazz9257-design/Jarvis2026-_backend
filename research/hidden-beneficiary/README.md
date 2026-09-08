# Hidden-beneficiary research component

This implements the independent candidate experiment, not the full JARVIS
production stack. Python 3.9+; standard library only. No network access, scheduler,
database writes, trade submission, or holdout unlocking in the engine.

## Run

```
python -m unittest discover -s research/hidden-beneficiary -v
python research/hidden-beneficiary/prepare.py CORPUS REVIEW_JSON NEW_RUN_DIRECTORY
python research/hidden-beneficiary/engine.py freeze INPUT_JSON NEW_SEAL_JSON
python research/hidden-beneficiary/engine.py evaluate EVALUATION_JSON NEW_RESULT_JSON
```

The corpus includes `accepted_event_population.json` and `event_text/ACCESSION.txt`.
The preparer preserves every filing, including missing and unreviewed documents.
Keyword matches only prioritize human review; absence of a match never certifies
absence of beneficiaries. It scans the recovered 8-K and EX-10/EX-99 text.

Review JSON contains `spec`, `cases`, `dispositions`, `prior_assets`. Cases require
stable `id`, `event_id`, verified `asset_id`, `cluster_id`, `lane`, timezone-aware
`t0`, typed economic fields, and field-level `evidence` with URL, publication time
and SHA256 of the source. The tests show the schema using **synthetic** examples.
Human reviewers must establish that each source actually supports its field;
hashes and timestamps do not do semantic verification.

Stock score: disclosed incremental binding revenue deliverable in the next 12
months divided by beneficiary trailing revenue, in the same currency. Keep
one-time and recurring revenue identified separately. Equity, deposits and cost
transfers are not revenue. Unknowns never become zero. A known adverse funding
direction can reject a positive economic claim even when other fields are missing.

Crypto: require historical token identity, active holder capture and all explicit
safety checks. Unverified safety remains blocked; explicit vetoes remain vetoes.
The candidate crossing compares the completed 7-day holder-revenue window with
the prior 90-day percentile and requires positive economics after incentives and
dilution. The data reviewer must verify window construction, historical activation
and units. This component does not implement the complete production Sentinel.

Freeze permits outcomes only after complete event review, complete prior-company
exclusions, at least 30 selected customer clusters and measurable controls. Stocks
select the top quartile of measurable scores, retaining other candidates in the
manifest. Stock and crypto are separate runs. A month-clustered interval additionally
needs multiple event months: a one-week pilot can establish feasibility but cannot
validate alpha under this specification.

Evaluation input is `{ "sealed": <freeze output>, "outcomes": { "freeze_sha256":
"...", "records": [...] } }`. Records have `case_id`, `net_benchmark_relative`
for 30/60/90/180 calendar days, `lead_days` for media/analyst/market, and auditable
`provenance` for prices, benchmark, costs, factor matching, delistings and session
coverage. Returns are decimal fractions; lead times are days. The engine refuses
missing labels, including identifiable unscored/vetoed candidates. The return
helper computes an observed entry-open/target-close return; a production-quality
price/benchmark/cost adapter is still required. Precomputed outcome assertions are
not independently verified by this module.

The primary comparison is 90-day selected-minus-control net relative return.
Bootstrap resamples customer and event-month clusters (10,000, seed 42); the
interval uses Bonferroni adjustment for the two allowed development variants.
Report other horizons without choosing a favorable one. Unobserved recognition
is censored; the conservative development gate requires coverage and positive
median lead for all three proxies. This threshold is a research assumption.

Every development result remains YELLOW even if its statistical test passes.
Holdout execution is deliberately unavailable here. No file is silently overwritten.
Hashes detect accidental changes; they are not cryptographic authentication against
a malicious operator. Operators must retain attempt history across studies; the
variant field alone cannot prevent someone restarting under a new identifier.

Tests validate code behavior with synthetic data, not discovery or investment alpha.
No revised live JARVIS decision is claimed until this component is integrated,
reviewed, supplied with actual evidence, and separately validated.
