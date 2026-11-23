export const closed = e => ['resolved', 'completed'].includes(e.status);
export const titleCase = s => String(s || 'unknown').replaceAll('_', ' ');
export const eventDate = e => e.kind === 'maintenance' ? (e.scheduled_for || e.created_at) : (e.started_at || e.created_at);
export const keyOf = e => `${e.provider}:${e.kind}:${e.id}`;
export function events(snapshot) {
  return snapshot.providers.flatMap(p => p.events.map(e => ({...e, provider:p.id, providerName:p.name})));
}
export function filterEvents(rows, filters = {}) {
  const query = (filters.query || '').toLowerCase().trim();
  return rows.filter(e => (!filters.provider || e.provider === filters.provider)
    && (!filters.kind || e.kind === filters.kind)
    && (!filters.state || (filters.state === 'closed' ? closed(e) : !closed(e)))
    && (!filters.component || e.components.some(c => `${e.provider}:${c.id}` === filters.component))
    && (!filters.from || (eventDate(e) || '').slice(0,10) >= filters.from)
    && (!filters.until || (eventDate(e) || '').slice(0,10) <= filters.until)
    && (!query || [e.name,e.providerName,...e.components.map(c=>c.name),...e.updates.map(u=>u.body)].join(' ').toLowerCase().includes(query)))
    .sort((a,b)=>(eventDate(b)||'').localeCompare(eventDate(a)||''));
}
export function compare(before, after) {
  const old = new Map(events(before).map(e=>[keyOf(e),e]));
  const current = new Map(events(after).map(e=>[keyOf(e),e]));
  const result=[];
  for (const [key,e] of current) {
    const previous=old.get(key);
    if(!previous) result.push({type:'appeared', event:e, previous:null, details:'First seen in this comparison; may predate our capture.'});
    else if(JSON.stringify(e)!==JSON.stringify(previous)) {
      const oldUpdates=new Map(previous.updates.map(u=>[u.id,u]));
      const added=e.updates.filter(u=>!oldUpdates.has(u.id)).length;
      const edited=e.updates.filter(u=>oldUpdates.has(u.id)&&JSON.stringify(u)!==JSON.stringify(oldUpdates.get(u.id))).length;
      const removed=previous.updates.filter(u=>!e.updates.some(n=>n.id===u.id)).length;
      result.push({type:'changed',event:e,previous,details:`${previous.status} → ${e.status}; ${added} new, ${edited} edited, ${removed} missing updates.`});
    }
  }
  for (const [key,e] of old) if(!current.has(key)) result.push({type:'not-present',event:e,previous:e,details:'Not present in the later response. It may have aged out of the provider feed; this does not mean resolved.'});
  return result;
}
function cell(value) {
  let s=String(value??'');
  if (/^[=+@\-\t\r]/.test(s)) s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
export function csv(rows, captured) {
  return [['provider','kind','title','status','impact','event_date','provider_updated_at','captured_at','source_url'], ...rows.map(e=>[e.providerName,e.kind,e.name,e.status,e.impact,eventDate(e),e.updated_at,captured,e.url])].map(row=>row.map(cell).join(',')).join('\r\n');
}
