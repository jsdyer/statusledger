import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from collect import collect, normalize_provider, validate_snapshot

STAMP='2026-11-23T00:00:00Z'
ITEM={'id':'i1','name':'Incident','status':'investigating','created_at':STAMP,'updated_at':STAMP,'components':[], 'incident_updates':[{'id':'u1','status':'investigating','body':'Evidence','created_at':STAMP}]}
SUMMARY={'page':{'updated_at':STAMP},'status':{'indicator':'none','description':'Operational'},'components':[{'id':'c1','name':'API','status':'operational'}],'incidents':[ITEM],'scheduled_maintenances':[]}
def fixture(url):
    endpoint=url.rsplit('/',1)[-1]
    data=SUMMARY if endpoint=='summary.json' else {'incidents':[ITEM]} if endpoint=='incidents.json' else {'scheduled_maintenances':[]}
    return copy.deepcopy(data), {'url':url,'retrieved_at':STAMP,'sha256':'a'*64,'bytes':100}
class CollectionTests(unittest.TestCase):
    def test_deduplicates_summary_records_and_publishes_both_providers(self):
        with tempfile.TemporaryDirectory() as tmp:
            value=collect(tmp,fixture)
            self.assertEqual([len(p['events']) for p in value['providers']],[1,1])
            manifest=json.loads((Path(tmp)/'index.json').read_text())
            self.assertEqual(len(manifest['captures']),1)
            validate_snapshot(json.loads((Path(tmp)/manifest['captures'][0]['file']).read_text()))
    def test_failed_provider_does_not_replace_good_capture_or_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            collect(tmp,fixture)
            before={p.name:p.read_bytes() for p in Path(tmp).glob('*.json')}
            def broken(url):
                if 'digitalocean' in url:raise OSError('Provider unavailable')
                return fixture(url)
            with self.assertRaises(OSError):collect(tmp,broken)
            self.assertEqual(before,{p.name:p.read_bytes() for p in Path(tmp).glob('*.json')})
    def test_shape_change_fails_before_publishing(self):
        with tempfile.TemporaryDirectory() as tmp:
            def bad(url):
                data,source=fixture(url)
                if 'summary.json' in url:data['components']=[]
                return data,source
            with self.assertRaisesRegex(ValueError,'empty components'):collect(tmp,bad)
            self.assertFalse((Path(tmp)/'index.json').exists())
    def test_retention_is_bounded_and_indexed_files_exist(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);entries=[]
            for n in range(1,92):
                name=f'20260101T{n:06d}Z.json';(root/name).write_text('{}');entries.append({'captured_at':f'2026-01-01T00:00:{n:03d}Z','file':name})
            (root/'index.json').write_text(json.dumps({'schema_version':1,'captures':entries}))
            collect(root,fixture)
            index=json.loads((root/'index.json').read_text())
            self.assertEqual(len(index['captures']),90)
            self.assertEqual(len(list(root.glob('*.json'))),91)
            self.assertTrue(all((root/e['file']).exists() for e in index['captures']))
if __name__=='__main__':unittest.main()
