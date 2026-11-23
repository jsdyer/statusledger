import test from 'node:test';
import assert from 'node:assert/strict';
import {filterEvents,compare,events,csv,eventDate,closed} from '../web/model.mjs';
const incident={id:'i1',name:'API degraded',kind:'incident',status:'investigating',impact:'minor',created_at:'2026-11-21T09:00:00Z',started_at:'2026-11-21T08:00:00Z',updated_at:'2026-11-21T09:00:00Z',components:[{id:'api',name:'API'}],updates:[{id:'u1',body:'Investigating timeouts',status:'investigating'}],url:'https://example.com/incidents/i1'};
const snapshot=(items,provider='github')=>({providers:[{id:provider,name:provider,events:items}]});
test('filters preserve provider/component distinction and search provider update text',()=>{
 const rows=[...events(snapshot([incident])),...events(snapshot([{...incident,id:'i2',status:'resolved'}],'digitalocean'))];
 assert.equal(filterEvents(rows,{query:'timeouts',provider:'github',component:'github:api'}).length,1);
 assert.equal(filterEvents(rows,{component:'digitalocean:api',state:'open'}).length,0);
 assert.equal(filterEvents(rows,{from:'2026-11-22'}).length,0);
 assert.equal(filterEvents(rows,{until:'2026-11-21',state:'closed'}).length,1);
});
test('missing records are not inferred to be resolved and initial sightings are not new outages',()=>{
 const diffs=compare(snapshot([incident]),snapshot([{...incident,id:'i2'}]));
 assert.deepEqual(diffs.map(c=>c.type),['appeared','not-present']);
 assert.equal(diffs[1].event.status,'investigating');
 assert.match(diffs[1].details,/does not mean resolved/);
 assert.match(diffs[0].details,/may predate/);
});
test('detects same-ID update corrections as well as newly published updates',()=>{
 const after={...incident,status:'resolved',updates:[{...incident.updates[0],body:'Corrected outage details'},{id:'u2',status:'resolved',body:'Recovered'}]};
 const result=compare(snapshot([incident]),snapshot([after]));
 assert.equal(result.length,1);assert.equal(result[0].type,'changed');
 assert.match(result[0].details,/1 new, 1 edited, 0 missing/);
 assert.equal(result[0].previous.updates[0].body,'Investigating timeouts');
 assert.equal(compare(snapshot([incident]),snapshot([structuredClone(incident)])).length,0);
});
test('maintenance dates use scheduled start, and completed is a closed state',()=>{
 assert.equal(eventDate({...incident,kind:'maintenance',scheduled_for:'2026-12-01T00:00:00Z'}),'2026-12-01T00:00:00Z');
 assert.equal(closed({...incident,status:'completed'}),true);
 assert.equal(closed({...incident,status:'monitoring'}),false);
});
test('CSV preserves quoted and multiline source text while neutralizing formula cells',()=>{
 const result=csv(events(snapshot([{...incident,name:'=SUM(1,2)\n"example"'}])),'2026-11-23T00:00:00Z');
 assert.match(result,/"'=SUM\(1,2\)\n""example"""/);
 assert.match(result,/captured_at/);
});
