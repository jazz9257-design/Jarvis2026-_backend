"""Prepare an auditable development input from recovered SEC evidence.

Does not infer missing numbers or call an LLM. Review decisions are explicit JSON.
Usage: python prepare.py CORPUS_DIRECTORY REVIEW_FILE OUTPUT_DIRECTORY
"""
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import sys
from zoneinfo import ZoneInfo
from engine import freeze, score_stock


def select_population(rows, start, end):
    start = dt.date.fromisoformat(start).strftime('%Y%m%d')
    end = dt.date.fromisoformat(end).strftime('%Y%m%d')
    selected = []
    for row in rows:
        if row.get('form') != '8-K':
            continue
        accepted = row.get('acceptance_et', '')
        if len(accepted) != 14 or not accepted.isdigit():
            raise ValueError('Unverified SEC acceptance timestamp')
        if start <= accepted[:8] <= end:
            selected.append(row)
    return selected


def prepare(corpus, review_file, destination):
    corpus, destination = Path(corpus), Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    reviews = json.loads(Path(review_file).read_text())
    population = select_population(json.loads((corpus / 'accepted_event_population.json').read_text()),
                                   reviews['spec']['window_start'], reviews['spec']['window_end'])
    dispositions, queue, source_manifest = {}, [], []
    terms = re.compile(r'\b(?:supply agreement|supplier|purchase commitments?|capacity reservations?|'
                       r'prepayments?|purchase volume|royalt(?:y|ies)|offtake|cost.sharing|'
                       r'manufacturing agreement|capital expenditures|capital spending|backlog|'
                       r'remaining performance obligations|procurement|purchase orders?)\b', re.I)
    missing = []
    for row in population:
        event = row['accession']
        path = corpus / 'event_text' / (event + '.txt')
        if not path.exists():
            path = corpus / 'agreement_text' / (event + '.txt')
        if not path.exists():
            missing.append(event); dispositions[event] = 'SOURCE_UNRECOVERED'; continue
        content = path.read_text()
        source_manifest.append({'event_id': event, 'url': row['url'],
                                'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        dispositions[event] = reviews.get('dispositions', {}).get(event, 'UNREVIEWED')
        hits = list(terms.finditer(content))
        if hits:
            queue.append({'event_id': event, 'issuer': row['issuer'], 'material_agreement': row['material_agreement'],
                          'source_url': row['url'], 'hit_count': len(hits),
                          'snippets': [content[max(0,m.start()-180):m.end()+450] for m in hits[:8]],
                          'status': dispositions[event]})
    inputs = {'spec': reviews['spec'], 'population': [r['accession'] for r in population],
              'cases': reviews.get('cases', []), 'dispositions': dispositions,
              'prior_assets': reviews.get('prior_assets', [])}
    seal = freeze(**inputs)
    result = {'engine': 'YELLOW', 'stage': 'TRAINING', 'result': 'BLOCKED' if seal['manifest']['errors'] else 'READY_FOR_OUTCOMES',
              'population': len(population), 'texts_recovered': len(source_manifest), 'missing_sources': missing,
              'keyword_review_queue': len(queue), 'reviewed_events': sum(v.startswith('REVIEWED_') for v in dispositions.values()),
              'cases': len(inputs['cases']), 'measurable': sum(r['status']=='MEASURABLE' for r in seal['manifest']['rows']),
              'errors': seal['manifest']['errors'], 'investment_outcomes_evaluated': 0}
    for name, value in [('input.json', inputs), ('freeze.json', seal), ('source_manifest.json', source_manifest),
                        ('review_queue.json', queue), ('result.json', result)]:
        (destination / name).write_text(json.dumps(value, indent=2, allow_nan=False))
    print(json.dumps({**result, 'missing_sources': len(missing)}))


if __name__ == '__main__': prepare(*sys.argv[1:])
