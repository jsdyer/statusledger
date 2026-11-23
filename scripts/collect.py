#!/usr/bin/env python3
"""Capture official Statuspage responses; publish only a complete, validated capture."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import tempfile
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
PROVIDERS = [('github', 'GitHub', 'https://www.githubstatus.com'), ('digitalocean', 'DigitalOcean', 'https://status.digitalocean.com')]
RETAIN = 90
MAX_BYTES = 12_000_000

def utc():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')

def stamp(value):
    if value is not None:
        if not isinstance(value, str):
            raise ValueError('Date must be an ISO string or null')
        datetime.fromisoformat(value.replace('Z', '+00:00'))
    return value

def text(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'Missing {field}')
    return value

def event(item, kind, base):
    identifier = text(item.get('id'), 'event id')
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', identifier):
        raise ValueError('Unexpected event identifier')
    updates = item.get('incident_updates')
    if not isinstance(updates, list):
        raise ValueError('Missing incident_updates')
    return {
        'id': identifier, 'kind': kind, 'name': text(item.get('name'), 'event name'),
        'status': text(item.get('status'), 'event status'), 'impact': item.get('impact', 'unknown'),
        'created_at': stamp(item.get('created_at')), 'updated_at': stamp(item.get('updated_at')),
        'started_at': stamp(item.get('started_at')), 'resolved_at': stamp(item.get('resolved_at')),
        'scheduled_for': stamp(item.get('scheduled_for')), 'scheduled_until': stamp(item.get('scheduled_until')),
        'url': f'{base}/incidents/{identifier}',
        'components': [{'id': text(c.get('id'), 'component id'), 'name': text(c.get('name'), 'component name')} for c in item.get('components', [])],
        'updates': [{'id': text(u.get('id'), 'update id'), 'status': text(u.get('status'), 'update status'),
                     'body': u.get('body') or '', 'created_at': stamp(u.get('created_at')),
                     'display_at': stamp(u.get('display_at')), 'updated_at': stamp(u.get('updated_at'))} for u in updates]
    }

def normalize_provider(pid, name, base, responses, sources):
    summary = responses['summary']
    if not isinstance(summary.get('components'), list) or not isinstance(summary.get('incidents'), list) or not isinstance(summary.get('scheduled_maintenances'), list):
        raise ValueError(f'{name}: summary shape changed')
    if not summary['components']:
        raise ValueError(f'{name}: unexpectedly empty components')
    if not isinstance(responses['incidents'].get('incidents'), list) or not isinstance(responses['scheduled-maintenances'].get('scheduled_maintenances'), list):
        raise ValueError(f'{name}: event list shape changed')
    events = {}
    for kind, rows in [('incident', responses['incidents']['incidents']), ('maintenance', responses['scheduled-maintenances']['scheduled_maintenances']), ('incident', summary['incidents']), ('maintenance', summary['scheduled_maintenances'])]:
        for item in rows:
            e = event(item, kind, base)
            key = (kind, e['id'])
            if key not in events or (e['updated_at'] or '') >= (events[key]['updated_at'] or ''):
                events[key] = e
    return {'id': pid, 'name': name, 'url': base, 'source_updated_at': stamp(summary['page'].get('updated_at')),
            'status': {'indicator': text(summary['status'].get('indicator'), 'status indicator'), 'description': text(summary['status'].get('description'), 'status description')},
            'components': [{'id': text(c.get('id'), 'component id'), 'name': text(c.get('name'), 'component name'), 'status': text(c.get('status'), 'component status'), 'group': bool(c.get('group')), 'group_id': c.get('group_id'), 'updated_at': stamp(c.get('updated_at'))} for c in summary['components']],
            'events': sorted(events.values(), key=lambda e: e['created_at'] or '', reverse=True), 'sources': sources}

def fetch(url):
    request = Request(url, headers={'User-Agent': 'CoolCode-StatusLedger/1.0 (+https://coolcode.ca/statusledger/)', 'Accept': 'application/json'})
    with urlopen(request, timeout=40) as response:
        raw = response.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError('Provider response exceeded size limit')
    return json.loads(raw), {'url': url, 'retrieved_at': utc(), 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}

def validate_snapshot(snapshot):
    if snapshot.get('schema_version') != 1 or len(snapshot.get('providers', [])) != 2:
        raise ValueError('Snapshot requires both providers')
    stamp(snapshot['captured_at'])
    if {p['id'] for p in snapshot['providers']} != {'github', 'digitalocean'}:
        raise ValueError('Unexpected provider set')
    for p in snapshot['providers']:
        if not p.get('components') or len(p.get('sources', [])) != 3:
            raise ValueError('Incomplete provider capture')
        for source in p['sources']:
            stamp(source['retrieved_at'])
            if not re.fullmatch(r'[0-9a-f]{64}', source['sha256']):
                raise ValueError('Invalid source checksum')
        for e in p['events']:
            text(e['name'], 'event name')
            text(e['status'], 'event status')
            if e['kind'] not in ('incident', 'maintenance'):
                raise ValueError('Unknown event kind')
            stamp(e['created_at'])
            stamp(e['updated_at'])
            if not isinstance(e['updates'], list):
                raise ValueError('Invalid update list')
            for update in e['updates']:
                if not isinstance(update['body'], str):
                    raise ValueError('Update body must be text')
        ids = [(e['kind'], e['id']) for e in p['events']]
        if len(ids) != len(set(ids)):
            raise ValueError('Duplicate event IDs')
    return snapshot

def validate_archive(directory):
    directory = Path(directory)
    manifest = json.loads((directory / 'index.json').read_text())
    entries = manifest.get('captures', [])
    if manifest.get('schema_version') != 1 or not 1 <= len(entries) <= RETAIN:
        raise ValueError('Invalid capture index')
    seen = set()
    for entry in entries:
        filename = entry['file']
        if not re.fullmatch(r'\d{8}T\d{6}Z\.json', filename) or filename in seen:
            raise ValueError('Invalid or duplicate capture filename')
        seen.add(filename)
        snapshot = validate_snapshot(json.loads((directory / filename).read_text()))
        if snapshot['captured_at'] != entry['captured_at']:
            raise ValueError('Capture timestamp does not match index')
    return manifest


def collect(directory, fetcher=fetch):
    directory = Path(directory)
    providers = []
    for pid, name, base in PROVIDERS:
        responses, sources = {}, []
        for endpoint in ['summary', 'incidents', 'scheduled-maintenances']:
            response, source = fetcher(f'{base}/api/v2/{endpoint}.json')
            responses[endpoint] = response
            sources.append(source)
        providers.append(normalize_provider(pid, name, base, responses, sources))
    snapshot = validate_snapshot({'schema_version': 1, 'captured_at': utc(), 'providers': providers})
    manifest_path = directory / 'index.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {'schema_version': 1, 'captures': []}
    filename = snapshot['captured_at'].replace(':', '').replace('-', '') + '.json'
    entry = {'captured_at': snapshot['captured_at'], 'file': filename}
    captures = sorted([c for c in manifest['captures'] if c['file'] != filename] + [entry], key=lambda c:c['captured_at'], reverse=True)
    keep = captures[:RETAIN]
    directory.mkdir(parents=True, exist_ok=True)
    # Stage both files on the same filesystem; readers see either old manifest or complete new data.
    with tempfile.TemporaryDirectory(dir=directory) as tmp:
        data = Path(tmp) / filename
        data.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(',', ':')) + '\n')
        index = Path(tmp) / 'index.json'
        index.write_text(json.dumps({'schema_version': 1, 'retention_captures': RETAIN, 'captures': keep}, indent=2) + '\n')
        data.replace(directory / filename)
        index.replace(manifest_path)
    for old in captures[RETAIN:]:
        if re.fullmatch(r'\d{8}T\d{6}Z\.json', old['file']):
            (directory / old['file']).unlink(missing_ok=True)
    return snapshot

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'web/data')
    args = parser.parse_args()
    data = collect(args.output)
    print(f"Captured {data['captured_at']}: " + ', '.join(f"{p['name']} {len(p['events'])} events" for p in data['providers']))
