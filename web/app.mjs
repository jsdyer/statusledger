import {closed, titleCase, eventDate, keyOf, events, filterEvents, compare, csv, readableText} from './model.mjs';
const $ = id => document.getElementById(id);
const el = (tag, content, cls) => {const n=document.createElement(tag);if(content!==undefined)n.textContent=content;if(cls)n.className=cls;return n;};
const date = value => value ? new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(value))+' UTC' : 'Not supplied';
const day = value => value ? value.slice(0,10) : 'No date';
const chip = (text, attention=false) => el('span',text,'chip'+(attention?' attention':''));
let manifest, snapshot, selected, rows=[], limit=40;
const cache=new Map();
async function read(file){if(!/^\d{8}T\d{6}Z\.json$/.test(file))throw Error('Invalid capture path');if(!cache.has(file)){const r=await fetch('./data/'+file);if(!r.ok)throw Error('Capture unavailable');const data=await r.json();if(data.schema_version!==1||!Array.isArray(data.providers))throw Error('Unsupported capture');cache.set(file,data);}return cache.get(file);}
function external(url,label){const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function describeComponent(provider,c){const parent=provider.components.find(x=>x.id===c.group_id);return parent?`${parent.name} / ${c.name}`:c.name;}
function providers(){
 $('providers').replaceChildren();
 for(const p of snapshot.providers){
  const box=el('article',undefined,'provider-card'),head=el('div',undefined,'provider-head');
  head.append(el('h2',p.name),chip(p.status.description,p.status.indicator!=='none'));box.append(head);
  box.append(el('p','Provider-reported status at this capture.'));
  const counts=el('div',undefined,'provider-counts');
  for(const [number,label] of [[p.events.filter(e=>e.kind==='incident').length,'incidents in feed'],[p.events.filter(e=>e.kind==='maintenance').length,'maintenance records'],[p.events.filter(e=>!closed(e)).length,'not marked closed']]){
   const item=el('div');item.append(el('strong',number),el('span',label));counts.append(item);
  }box.append(counts);
  const dates=p.events.filter(e=>e.kind==='incident').map(eventDate).filter(Boolean).sort();
  box.append(el('p',dates.length?`Incident start/creation dates: ${day(dates[0])} – ${day(dates.at(-1))}. Feed windows differ.`:'No incidents present in this response.'));
  const details=el('details'),summary=el('summary',`${p.components.length} reported components · inspect status`),list=el('ul',undefined,'component-list');
  for(const c of [...p.components].sort((a,b)=>describeComponent(p,a).localeCompare(describeComponent(p,b)))){const li=el('li');li.append(el('span',describeComponent(p,c)),el('span',titleCase(c.status)));list.append(li);}details.append(summary,list);box.append(details,external(p.url,'Open provider status ↗'));$('providers').append(box);
 }
}
function componentOptions(){
 const prev=$('component').value;$('component').replaceChildren(new Option('All components',''));
 for(const p of snapshot.providers.filter(p=>!$('provider').value||p.id===$('provider').value)){
  const group=el('optgroup');group.label=p.name;
  const known=new Map(p.components.map(c=>[c.id,describeComponent(p,c)]));for(const e of p.events)for(const c of e.components)if(!known.has(c.id))known.set(c.id,c.name);
  for(const [id,name] of [...known].sort((a,b)=>a[1].localeCompare(b[1])))group.append(new Option(name,`${p.id}:${id}`));$('component').append(group);
 }if([...$('component').options].some(o=>o.value===prev))$('component').value=prev;
}
function filters(){return Object.fromEntries(['provider','kind','state','component','from','until'].map(k=>[k,$(k).value]).concat([['query',$('search').value]]));}
function renderResults(){
 rows=filterEvents(events(snapshot),filters());$('result-count').textContent=`${rows.length} matching ${rows.length===1?'record':'records'} · captured ${day(snapshot.captured_at)}`;
 const list=$('event-list'), scroll=list.scrollTop, restoreFocus=list.contains(document.activeElement);list.replaceChildren();
 if(!rows.length){list.append(el('p','No records match these filters. Try another date range or clear the filters.','empty'));$('detail').replaceChildren(el('p','No matching record selected.','muted'));selected=null;}
 else if(!rows.some(e=>keyOf(e)===selected))selected=keyOf(rows[0]);
 for(const e of rows.slice(0,limit)){
  const b=el('button',undefined,'event-button');b.type='button';b.setAttribute('aria-pressed',String(keyOf(e)===selected));
  const meta=el('span',undefined,'meta');meta.append(el('span',e.providerName),el('span',day(eventDate(e))));
  const tags=el('span',undefined,'record-tags');tags.append(chip(titleCase(e.status),!closed(e)),el('span',e.kind,'muted'));
  b.append(meta,el('strong',e.name),tags);b.addEventListener('click',()=>{selected=keyOf(e);renderResults();});list.append(b);
 }
 list.scrollTop=scroll;if(restoreFocus)list.querySelector('[aria-pressed="true"]')?.focus({preventScroll:true});
 $('more').hidden=rows.length<=limit;if(selected)renderDetail(rows.find(e=>keyOf(e)===selected));
}
function renderDetail(e){
 const panel=$('detail');panel.replaceChildren();panel.append(el('div',`${e.providerName.toUpperCase()} / ${e.kind.toUpperCase()}`,'eyebrow'),el('h3',e.name),chip(titleCase(e.status),!closed(e)));
 const a=external(e.url,'Read the original provider report ↗');a.className='source-link';panel.append(el('br'),a);
 const dl=el('dl');for(const [label,value] of [[e.kind==='maintenance'?'Scheduled start':'Reported start / creation',date(eventDate(e))],['Provider last updated',date(e.updated_at)],['Impact reported',titleCase(e.impact)],['Components',e.components.map(c=>c.name).join(', ')||'None named'],...(e.kind==='maintenance'?[['Scheduled end',date(e.scheduled_until)]]:[])]){const group=el('div');group.append(el('dt',label),el('dd',value));dl.append(group);}panel.append(dl,el('h4',`${e.updates.length} PROVIDER UPDATES · NEWEST FIRST`));
 const list=el('ol',undefined,'timeline');
 for(const u of [...e.updates].sort((a,b)=>(b.display_at||b.created_at||'').localeCompare(a.display_at||a.created_at||''))){const li=el('li');li.append(el('div',`${titleCase(u.status)} · ${date(u.display_at||u.created_at)}`,'update-meta'),el('p',readableText(u.body)||'No narrative supplied.'));list.append(li);}
 panel.append(list);if(!e.updates.length)panel.append(el('p','No update messages in this response.','muted'));
}
function sources(){
 const holder=$('sources');holder.replaceChildren();for(const p of snapshot.providers){holder.append(el('h3',p.name));for(const s of p.sources){const div=el('div',undefined,'source-row');div.append(external(s.url,s.url),el('p',`Retrieved ${date(s.retrieved_at)} · ${s.bytes.toLocaleString()} bytes`),el('code',`SHA-256 ${s.sha256}`));holder.append(div);}}
}
let captureRequest=0;
async function selectCapture(){const request=++captureRequest;try{const next=await read($('capture').value);if(request!==captureRequest)return;snapshot=next;limit=40;providers();componentOptions();renderResults();sources();$('export-csv').disabled=false;$('export-json').disabled=false;$('load-status').textContent=`Viewing ${date(snapshot.captured_at)}. Select a record to read the provider’s update timeline.`;}catch(e){$('load-status').textContent='Could not load that capture. The previous capture remains displayed.';}}
async function runComparison(){
 const out=$('comparison');out.replaceChildren();const beforeFile=$('before').value,afterFile=$('after').value;
 if(beforeFile===afterFile){out.append(el('p','Choose two different retained captures to compare.','empty'));return;}
 try{const [before,after]=await Promise.all([read(beforeFile),read(afterFile)]);if(before.captured_at>=after.captured_at){out.append(el('p','Choose an earlier capture that precedes the later capture.','empty'));return;}const changes=compare(before,after);out.append(el('p',`${changes.length} changed, appeared or missing records between ${date(before.captured_at)} and ${date(after.captured_at)}. Counts describe reporting changes.`));
  if(!changes.length)out.append(el('p','The event records are unchanged between these captures. Component status may still differ.','empty'));
  for(const c of changes){const box=el('article',undefined,'compare-entry');box.append(chip(c.type==='not-present'?'Not present later':titleCase(c.type)),el('h3',`${c.event.providerName} · ${c.event.name}`),el('p',c.details),external(c.event.url,'Original report ↗'));if(c.type==='changed'){const d=el('details');d.append(el('summary','Inspect previous and later provider text'));for(const [label,event] of [['Earlier',c.previous],['Later',c.event]]){d.append(el('h4',label));for(const u of event.updates)d.append(el('p',`${date(u.display_at||u.created_at)} · ${titleCase(u.status)}\n${readableText(u.body)}`));}box.append(d);}out.append(box);}
  for(const p of after.providers){const old=before.providers.find(x=>x.id===p.id);if(!old)continue;const changes=p.components.filter(c=>old.components.some(x=>x.id===c.id&&x.status!==c.status));if(changes.length)out.append(el('p',`${p.name} component state changes: ${changes.map(c=>`${describeComponent(p,c)} → ${titleCase(c.status)}`).join('; ')}`));}
 }catch(e){out.append(el('p','Comparison could not load. Please retry.','error'));}
}
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('provider').addEventListener('change',()=>{if(!snapshot)return;componentOptions();limit=40;renderResults();});for(const id of ['search','kind','state','component','from','until'])$(id).addEventListener(id==='search'?'input':'change',()=>{if(snapshot){limit=40;renderResults();}});
$('reset').addEventListener('click',()=>{for(const id of ['search','provider','kind','state','component','from','until'])$(id).value='';if(snapshot){componentOptions();limit=40;renderResults();}});
$('more').addEventListener('click',()=>{limit+=40;renderResults();});$('capture').addEventListener('change',selectCapture);$('compare').addEventListener('click',runComparison);
$('export-csv').addEventListener('click',()=>download(csv(rows,snapshot.captured_at),'status-ledger-'+day(snapshot.captured_at)+'.csv','text/csv;charset=utf-8'));
$('export-json').addEventListener('click',()=>download(JSON.stringify(snapshot,null,2),'status-ledger-'+snapshot.captured_at.replaceAll(':','')+'.json','application/json'));
async function init(){try{const response=await fetch('./data/index.json');if(!response.ok)throw Error('No capture index');manifest=await response.json();if(!manifest.captures?.length)throw Error('No retained captures');for(const id of ['capture','before','after'])for(const entry of manifest.captures)$(id).append(new Option(date(entry.captured_at),entry.file));$('captured').textContent=date(manifest.captures[0].captured_at);$('capture-count').textContent=`${manifest.captures.length} retained capture${manifest.captures.length===1?'':'s'} · history begins ${day(manifest.captures.at(-1).captured_at)}`;
 const age=(Date.now()-Date.parse(manifest.captures[0].captured_at))/86400000;if(age>2)$('capture-count').append(` · Collection is ${Math.floor(age)} days old; check the source for current status.`);
 if(manifest.captures.length>1){$('before').selectedIndex=1;$('compare').disabled=false;}else $('comparison').append(el('p','Baseline captured. Changes become available after the next successful daily collection. The incident timelines above already contain the providers’ earlier updates.','empty'));
 await selectCapture();
 }catch(e){$('load-status').className='error';$('load-status').textContent='The retained ledger could not load. Reload this page or use the official provider links below. No current status is inferred from missing data.';$('captured').textContent='Capture unavailable';}}
init();
