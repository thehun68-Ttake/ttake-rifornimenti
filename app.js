(function(){
'use strict';
var $=function(s,r){return (r||document).querySelector(s);};
var $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));};
var clone=function(o){return JSON.parse(JSON.stringify(o));};
var DEFAULTS={aircraft:['LY-HLZ','LY-ASQ','9A-DHC'],operators:['TARABUSI','TEDESCHI','BECCARI'],members:[]};
var K_CACHE='ttake-fuel-cache',K_OUT='ttake-fuel-outbox',K_CONN='ttake-fuel-conn',K_MAIL='ttake-fuel-mail';
var CFG=window.TTAKE_CONFIG||{};
var S={entries:[],lists:clone(DEFAULTS),tab:'nuovo',editingId:null,confirmDel:null,confirmRm:null,galManual:false,saving:false,
  net:'idle',flushing:false,filters:{month:'',aircraft:'',operator:'',member:''},mailTo:'',withList:true,url:'',token:''};
var outbox=[];

/* ---------- storage ---------- */
function lsGet(k){try{return JSON.parse(localStorage.getItem(k)||'null');}catch(e){return null;}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
function arr(a){return Array.isArray(a)?a.filter(function(x){return typeof x==='string'&&x;}):[];}
function normLists(l){return {aircraft:arr(l&&l.aircraft),operators:arr(l&&l.operators),members:arr(l&&l.members)};}
function persistCache(){lsSet(K_CACHE,{entries:S.entries,lists:S.lists});}
function persistOutbox(){lsSet(K_OUT,outbox);}
(function loadAll(){
  var c=lsGet(K_CACHE);
  if(c){if(Array.isArray(c.entries))S.entries=c.entries;if(c.lists)S.lists=normLists(c.lists);}
  var o=lsGet(K_OUT);if(Array.isArray(o))outbox=o;
  var conn=lsGet(K_CONN)||{};
  S.url=conn.url!=null?conn.url:(CFG.scriptUrl||'');
  S.token=conn.token||'';
  S.mailTo=lsGet(K_MAIL)||'';
})();
function syncOn(){return !!(S.url&&S.token);}

/* ---------- helpers ---------- */
var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
var pad=function(n){return String(n).padStart(2,'0');};
var nf2=new Intl.NumberFormat('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2});
var nfc=new Intl.NumberFormat('it-IT',{minimumFractionDigits:0,maximumFractionDigits:2});
var fmtG=function(n){return nf2.format(Number(n)||0);};
var fmtC=function(n){return (n==null||n===''||isNaN(Number(n)))?'-':nfc.format(Number(n));};
var toInput=function(n){return String(Math.round(n*1000)/1000).replace('.',',');};
var round3=function(n){return Math.round(n*1000)/1000;};
function parseNum(v){
  if(v==null)return null;var s=String(v).trim().replace(/\s/g,'');if(!s)return null;
  if(s.indexOf(',')>=0)s=s.replace(/\./g,'').replace(',','.');
  var n=Number(s);return isFinite(n)?n:NaN;
}
function todayStr(){var d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function fmtDate(s){var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||'');return m?m[3]+'/'+m[2]+'/'+m[1]:(s||'');}
function monthLabel(ym){
  var m=/^(\d{4})-(\d{2})$/.exec(ym||'');if(!m)return ym||'-';
  var t=new Intl.DateTimeFormat('it-IT',{month:'long',year:'numeric'}).format(new Date(+m[1],+m[2]-1,1));
  return t.charAt(0).toUpperCase()+t.slice(1);
}
var newId=function(){return 'e'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);};
var plural=function(n){return n===1?'rifornimento':'rifornimenti';};
function uniq(){var out=[],seen={};Array.prototype.forEach.call(arguments,function(a){(a||[]).forEach(function(v){if(v&&!seen[v]){seen[v]=1;out.push(v);}});});return out;}
function toast(msg,bad){
  var slot=$('#toast-slot');slot.innerHTML='<div class="toast'+(bad?' bad':'')+'">'+esc(msg)+'</div>';
  clearTimeout(toast.t);toast.t=setTimeout(function(){slot.innerHTML='';},3200);
}

/* ---------- dati: copia locale + coda verso Google Sheets ---------- */
function applyOp(op){
  if(op.type==='save'){
    var i=S.entries.findIndex(function(x){return x.id===op.entry.id;});
    if(i>=0)S.entries[i]=op.entry;else S.entries.push(op.entry);
  }else if(op.type==='delete'){
    S.entries=S.entries.filter(function(x){return x.id!==op.id;});
  }else if(op.type==='lists'){
    S.lists=normLists(op.lists);
  }
}
function queue(op){
  if(op.type==='save')outbox=outbox.filter(function(o){return !(o.type==='save'&&o.entry.id===op.entry.id);});
  if(op.type==='lists')outbox=outbox.filter(function(o){return o.type!=='lists';});
  outbox.push(op);persistOutbox();
}
function commit(op){
  applyOp(op);persistCache();
  if(syncOn()){queue(op);flush();}
  return Promise.resolve();
}
var Store={
  saveEntry:function(e){return commit({type:'save',entry:e});},
  removeEntry:function(id){return commit({type:'delete',id:id});},
  saveLists:function(){return commit({type:'lists',lists:clone(S.lists)});}
};
async function api(body){
  var r=await fetch(S.url,{method:'POST',redirect:'follow',cache:'no-store',body:JSON.stringify(Object.assign({token:S.token},body))});
  var j=await r.json();
  if(!j||!j.ok){var e=new Error((j&&j.error)||'errore');e.code=(j&&j.error)||'server';throw e;}
  return j;
}
function opBody(op){
  if(op.type==='save')return {action:'save',entry:op.entry};
  if(op.type==='delete')return {action:'delete',id:op.id};
  return {action:'lists',lists:op.lists};
}
async function pull(){
  S.net='syncing';renderStatus();
  var j=await api({action:'all'});
  S.entries=Array.isArray(j.entries)?j.entries:[];
  if(j.lists)S.lists=normLists(j.lists);
  persistCache();S.net='idle';renderData();
}
async function flush(){
  if(!syncOn()||S.flushing)return;
  S.flushing=true;
  try{
    while(outbox.length){
      try{await api(opBody(outbox[0]));outbox.shift();persistOutbox();renderStatus();}
      catch(e){
        if(e&&e.code==='invalid'){outbox.shift();persistOutbox();toast('Un dato non è stato accettato dal foglio.',true);}
        else throw e;
      }
    }
    await pull();
  }catch(e){S.net=(e&&e.code==='auth')?'auth':'offline';}
  S.flushing=false;renderStatus();
}
function sync(){
  if(!syncOn()){renderStatus();return;}
  if(outbox.length)return flush();
  if(S.flushing)return;
  S.flushing=true;
  return pull().catch(function(e){S.net=(e&&e.code==='auth')?'auth':'offline';}).then(function(){S.flushing=false;renderStatus();});
}

/* ---------- query ---------- */
function sorted(){
  return S.entries.slice().sort(function(a,b){return String(b.date||'').localeCompare(String(a.date||''))||(b.createdAt||0)-(a.createdAt||0);});
}
function lastEnd(){var l=sorted();for(var i=0;i<l.length;i++){var v=Number(l[i].end);if(l[i].end!=null&&l[i].end!==''&&isFinite(v))return v;}return null;}
function filtered(){
  var f=S.filters;
  return sorted().filter(function(e){
    return (!f.month||String(e.date||'').slice(0,7)===f.month)&&(!f.aircraft||e.aircraft===f.aircraft)&&(!f.operator||e.operator===f.operator)&&
      (!f.member||(f.member==='__none__'?!e.member:e.member===f.member));
  });
}
function sumG(list){return round3(list.reduce(function(a,e){return a+(Number(e.gallons)||0);},0));}
function group(list,keyFn){
  var m=new Map();
  list.forEach(function(e){var k=keyFn(e),r=m.get(k)||{g:0,n:0};r.g=round3(r.g+(Number(e.gallons)||0));r.n++;m.set(k,r);});
  return m;
}
var NONE='Non assegnato';
function memberSort(a,b){if(a===NONE)return 1;if(b===NONE)return -1;return a.localeCompare(b,'it');}
function summary(list){
  var byMonth=group(list,function(e){return String(e.date||'').slice(0,7)||'-';});
  var months=Array.from(byMonth.keys()).sort().reverse();
  var byMM=months.map(function(m){
    var sub=list.filter(function(e){return (String(e.date||'').slice(0,7)||'-')===m;});
    var gm=group(sub,function(e){return e.member||NONE;});
    return {month:m,total:byMonth.get(m),members:Array.from(gm.keys()).sort(memberSort).map(function(k){return {name:k,v:gm.get(k)};})};
  });
  var ga=group(list,function(e){return e.aircraft||'-';});
  var aircraft=Array.from(ga.keys()).map(function(k){return {name:k,v:ga.get(k)};}).sort(function(a,b){return b.v.g-a.v.g;});
  return {months:months,byMonth:byMonth,byMM:byMM,aircraft:aircraft};
}

/* ---------- selects ---------- */
function setOptions(sel,opts,value){
  var sig=JSON.stringify(opts);
  if(sel.dataset.sig!==sig){sel.innerHTML=opts.map(function(o){return '<option value="'+esc(o.v)+'">'+esc(o.t)+'</option>';}).join('');sel.dataset.sig=sig;}
  if(value!==undefined)sel.value=value;
}
var COMBOS=[
  {key:'operators',id:'op',label:'Operatore',ph:'Seleziona operatore',newTxt:'+ Nuovo operatore…',upper:true,addPh:'Nome operatore'},
  {key:'aircraft',id:'ac',label:'Aereo (sigla)',ph:'Seleziona aereo',newTxt:'+ Altra marca…',upper:true,addPh:'Sigla, es. I-ABCD'},
  {key:'members',id:'mem',label:'Socio a cui addebitare',ph:'Nessuno (da assegnare)',newTxt:'+ Nuovo socio…',upper:false,addPh:'Nome e cognome del socio'}
];
function buildCombos(){
  $('#combo-slot').innerHTML=COMBOS.map(function(c){
    return '<div class="field"><label for="f-'+c.id+'">'+c.label+'</label><select id="f-'+c.id+'"></select>'+
      '<div class="addbox" id="add-'+c.id+'" hidden><input id="add-'+c.id+'-in" type="text" placeholder="'+c.addPh+'" aria-label="'+c.addPh+'" autocapitalize="'+(c.upper?'characters':'words')+'" autocorrect="off">'+
      '<button type="button" class="btn small primary" data-act="combo-ok" data-c="'+c.id+'">Aggiungi</button>'+
      '<button type="button" class="btn small" data-act="combo-no" data-c="'+c.id+'">Annulla</button></div></div>';
  }).join('');
}
function formLists(){
  var ed=S.editingId&&S.entries.find(function(e){return e.id===S.editingId;});
  return {operators:uniq(S.lists.operators,ed&&[ed.operator]),aircraft:uniq(S.lists.aircraft,ed&&[ed.aircraft]),members:uniq(S.lists.members,ed&&[ed.member])};
}
function populateForm(){
  var L=formLists();
  COMBOS.forEach(function(c){
    var sel=$('#f-'+c.id),cur=sel.value;
    setOptions(sel,[{v:'',t:c.ph}].concat(L[c.key].map(function(v){return {v:v,t:v};})).concat([{v:'__new__',t:c.newTxt}]),cur);
  });
}
function normName(c,v){v=String(v||'').trim().replace(/\s+/g,' ');return c.upper?v.toUpperCase():v;}
function comboAdd(cid){
  var c=COMBOS.find(function(x){return x.id===cid;}),inp=$('#add-'+cid+'-in'),v=normName(c,inp.value);
  if(!v){inp.focus();return;}
  var list=S.lists[c.key],ex=list.find(function(x){return x.toLowerCase()===v.toLowerCase();});
  if(!ex){list.push(v);ex=v;Store.saveLists();}
  inp.value='';$('#add-'+cid).hidden=true;populateForm();$('#f-'+cid).value=ex;renderLists();
}
function comboCancel(cid){$('#add-'+cid).hidden=true;$('#add-'+cid+'-in').value='';$('#f-'+cid).value='';}

/* ---------- form ---------- */
function updateFormMode(){
  var ed=!!S.editingId;
  $('#form-title').textContent=ed?'Modifica rifornimento':'Nuovo rifornimento';
  $('#f-save').textContent=ed?'Salva modifiche':'Registra rifornimento';
  $('#f-cancel').hidden=!ed;
  $('#f-save').disabled=S.saving;
  $('#conn-banner').hidden=!(S.url&&!S.token);
}
function clearErr(){$('#f-err').hidden=true;$$('.invalid').forEach(function(x){x.classList.remove('invalid');});}
function resetForm(full){
  var op=$('#f-op').value;
  S.editingId=null;S.galManual=false;clearErr();
  populateForm();
  if(full||!$('#f-date').value)$('#f-date').value=todayStr();
  $('#f-op').value=full?'':(op==='__new__'?'':op);
  $('#f-ac').value='';$('#f-mem').value='';
  $('#f-end').value='';$('#f-gal').value='';
  var le=lastEnd();$('#f-start').value=le==null?'':toInput(le);
  COMBOS.forEach(function(c){$('#add-'+c.id).hidden=true;});
  recalc();updateFormMode();
}
function recalc(){
  var a=parseNum($('#f-start').value),b=parseNum($('#f-end').value),gal=$('#f-gal'),h=$('#gal-hint'),sh=$('#start-hint'),eh=$('#end-hint');
  var okA=a!=null&&!isNaN(a),okB=b!=null&&!isNaN(b);
  h.className='hint';eh.className='hint';eh.textContent='';
  if(okA&&okB){
    if(b>=a){gal.value=toInput(b-a);S.galManual=false;h.textContent='Calcolati: contatore finale meno iniziale.';}
    else{eh.textContent='Il finale è minore dell\'iniziale.';eh.className='hint warn';}
  }else if(!S.galManual){h.textContent='Si calcolano da finale meno iniziale. Puoi correggerli a mano.';}
  var le=lastEnd(),chip=$('#use-last');
  if(le!=null&&!S.editingId){chip.hidden=false;chip.textContent='Ultimo finale: '+fmtC(le);}else{chip.hidden=true;}
  sh.className='hint';sh.textContent='';
  if(okA&&le!=null&&!S.editingId&&Math.abs(a-le)>0.0005){sh.textContent='Diverso dall\'ultimo contatore finale ('+fmtC(le)+').';sh.className='hint warn';}
}
function galDiff(){
  var a=parseNum($('#f-start').value),b=parseNum($('#f-end').value),g=parseNum($('#f-gal').value),h=$('#gal-hint');
  if(a!=null&&b!=null&&g!=null&&!isNaN(a)&&!isNaN(b)&&!isNaN(g)&&b>=a&&Math.abs((b-a)-g)>0.005){
    h.textContent='Diverso dai contatori ('+fmtG(b-a)+' gal): controlla.';h.className='hint warn';
  }else{h.className='hint';}
}
function showErrs(errs){
  clearErr();
  $('#f-err').innerHTML=errs.map(function(x){return esc(x[1]);}).join('<br>');$('#f-err').hidden=false;
  errs.forEach(function(x){$('#'+x[0]).classList.add('invalid');});
  var el=$('#'+errs[0][0]);if(el&&el.focus)el.focus();
}
async function onSubmit(ev){
  ev.preventDefault();
  if(S.saving)return;
  var g=function(id){return $('#'+id).value;};
  var date=g('f-date'),op=g('f-op'),ac=g('f-ac'),mem=g('f-mem');
  if(op==='__new__')op='';if(ac==='__new__')ac='';if(mem==='__new__')mem='';
  var start=parseNum(g('f-start')),end=parseNum(g('f-end')),gal=parseNum(g('f-gal')),errs=[];
  var okS=start!=null&&!isNaN(start),okE=end!=null&&!isNaN(end);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))errs.push(['f-date','Inserisci la data.']);
  if(!op)errs.push(['f-op','Scegli l\'operatore.']);
  if(!ac)errs.push(['f-ac','Scegli la sigla dell\'aereo.']);
  if(isNaN(start))errs.push(['f-start','Contatore iniziale non valido.']);
  if(isNaN(end))errs.push(['f-end','Contatore finale non valido.']);
  if(okS&&okE&&end<start)errs.push(['f-end','Il contatore finale è minore di quello iniziale.']);
  if((gal==null)&&okS&&okE&&end>=start)gal=round3(end-start);
  if(gal==null||isNaN(gal)||gal<=0)errs.push(['f-gal','Inserisci i galloni (maggiori di zero) oppure i due contatori.']);
  if(errs.length){showErrs(errs);return;}
  clearErr();
  var old=S.editingId&&S.entries.find(function(e){return e.id===S.editingId;});
  var entry={id:S.editingId||newId(),date:date,operator:op,aircraft:ac,member:mem,start:okS?start:null,end:okE?end:null,gallons:round3(gal),createdAt:(old&&old.createdAt)||Date.now()};
  S.saving=true;updateFormMode();
  await Store.saveEntry(entry);
  toast((old?'Modifica salvata: ':'Registrato: ')+fmtG(entry.gallons)+' US gal su '+entry.aircraft);
  S.saving=false;resetForm(!!old);renderData();
}
function startEdit(id){
  var e=S.entries.find(function(x){return x.id===id;});if(!e)return;
  S.editingId=id;S.confirmDel=null;clearErr();populateForm();
  $('#f-date').value=e.date||todayStr();$('#f-op').value=e.operator||'';$('#f-ac').value=e.aircraft||'';$('#f-mem').value=e.member||'';
  $('#f-start').value=e.start==null||e.start===''?'':toInput(e.start);$('#f-end').value=e.end==null||e.end===''?'':toInput(e.end);$('#f-gal').value=toInput(e.gallons);
  S.galManual=true;recalc();$('#f-gal').value=toInput(e.gallons);updateFormMode();renderLog();setTab('nuovo');
}

/* ---------- filtri ---------- */
var FILTERS=[['month','Mese'],['aircraft','Aereo'],['operator','Operatore'],['member','Socio']];
function buildFilterBars(){
  ['log','sum'].forEach(function(p){
    $('#filters-'+p).innerHTML=FILTERS.map(function(f){return '<div class="field"><label for="'+p+'-fl-'+f[0]+'">'+f[1]+'</label><select id="'+p+'-fl-'+f[0]+'" data-filter="'+f[0]+'"></select></div>';}).join('')+
      '<div class="field"><button type="button" class="btn small" data-act="reset-filters">Azzera filtri</button></div>';
  });
}
function populateFilters(){
  var months=uniq(S.entries.map(function(e){return String(e.date||'').slice(0,7);})).sort().reverse();
  var sets={
    month:[{v:'',t:'Tutti i mesi'}].concat(months.map(function(m){return {v:m,t:monthLabel(m)};})),
    aircraft:[{v:'',t:'Tutti gli aerei'}].concat(uniq(S.lists.aircraft,S.entries.map(function(e){return e.aircraft;})).map(function(v){return {v:v,t:v};})),
    operator:[{v:'',t:'Tutti gli operatori'}].concat(uniq(S.lists.operators,S.entries.map(function(e){return e.operator;})).map(function(v){return {v:v,t:v};})),
    member:[{v:'',t:'Tutti i soci'},{v:'__none__',t:NONE}].concat(uniq(S.lists.members,S.entries.map(function(e){return e.member;})).map(function(v){return {v:v,t:v};}))
  };
  FILTERS.forEach(function(f){
    var k=f[0];
    if(S.filters[k]&&!sets[k].some(function(o){return o.v===S.filters[k];}))S.filters[k]='';
    ['log','sum'].forEach(function(p){setOptions($('#'+p+'-fl-'+k),sets[k],S.filters[k]);});
  });
}

/* ---------- viste ---------- */
var ICON_EDIT='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>';
var ICON_DEL='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/></svg>';
function entryHtml(e){
  var id=esc(e.id);
  var act=S.confirmDel===e.id
    ?'<span class="ask">Eliminare?</span><button class="btn small danger" data-act="del-yes" data-id="'+id+'">Sì</button><button class="btn small" data-act="del-no">No</button>'
    :'<button class="icon" data-act="edit" data-id="'+id+'" aria-label="Modifica rifornimento">'+ICON_EDIT+'</button><button class="icon" data-act="del" data-id="'+id+'" aria-label="Elimina rifornimento">'+ICON_DEL+'</button>';
  return '<article class="entry"><div class="e-date">'+esc(fmtDate(e.date))+'</div><div class="e-ac"><span class="tag">'+esc(e.aircraft||'-')+'</span></div>'+
    '<div class="e-op">'+esc(e.operator||'-')+'</div><div class="e-mem">'+(e.member?esc(e.member):'<span class="dim">Da assegnare</span>')+'</div>'+
    '<div class="e-c1" data-l="Iniz.">'+fmtC(e.start)+'</div><div class="e-c2" data-l="Fin.">'+fmtC(e.end)+'</div>'+
    '<div class="e-gal">'+fmtG(e.gallons)+'<small>US gal</small></div><div class="e-act">'+act+'</div></article>';
}
function renderLog(){
  var list=filtered(),box=$('#log-list');
  $('#log-count').textContent=list.length+' '+plural(list.length)+' · '+fmtG(sumG(list))+' US gal';
  if(!list.length){box.innerHTML='<p class="empty">'+(S.entries.length?'Nessun rifornimento con questi filtri.':'Nessun rifornimento registrato. Aggiungi il primo dalla scheda Nuovo.')+'</p>';return;}
  box.innerHTML='<div class="log-head"><span>Data</span><span>Aereo</span><span>Operatore</span><span>Socio</span><span>Iniziale</span><span>Finale</span><span>US gal</span><span></span></div>'+list.map(entryHtml).join('');
}
function filterText(){
  var f=S.filters,p=[];
  if(f.month)p.push('Mese: '+monthLabel(f.month));
  if(f.aircraft)p.push('Aereo: '+f.aircraft);
  if(f.operator)p.push('Operatore: '+f.operator);
  if(f.member)p.push('Socio: '+(f.member==='__none__'?NONE:f.member));
  return p.length?p.join(' | '):'Tutti i rifornimenti';
}
function renderSummary(){
  var box=$('#sum-body'),list=filtered(),tot=sumG(list);
  var head='<div class="readout sum"><div><div class="unit">Totale erogato</div><div class="big">'+fmtG(tot)+' <span class="unit">US gal</span></div></div><div class="meta">'+list.length+' '+plural(list.length)+'<br>'+esc(filterText())+'</div></div>';
  if(!list.length){box.innerHTML=head+'<p class="empty">Nessun dato per questi filtri.</p>';return;}
  var s=summary(list),maxA=s.aircraft.reduce(function(m,a){return Math.max(m,a.v.g);},0)||1;
  var t1='<div class="card"><h3>Per mese</h3><div class="scroll"><table class="tbl"><thead><tr><th>Mese</th><th class="n">Rifornimenti</th><th class="n">US gal</th></tr></thead><tbody>'+
    s.months.map(function(m){var v=s.byMonth.get(m);return '<tr><td>'+esc(monthLabel(m))+'</td><td class="n">'+v.n+'</td><td class="n">'+fmtG(v.g)+'</td></tr>';}).join('')+
    '</tbody><tfoot><tr><td>Totale</td><td class="n">'+list.length+'</td><td class="n">'+fmtG(tot)+'</td></tr></tfoot></table></div></div>';
  var t2='<div class="card"><h3>Per mese e socio</h3><div class="scroll"><table class="tbl"><thead><tr><th>Mese / socio</th><th class="n">Rifornimenti</th><th class="n">US gal</th></tr></thead><tbody>'+
    s.byMM.map(function(m){
      return '<tr class="mh"><td>'+esc(monthLabel(m.month))+' · subtotale</td><td class="n">'+m.total.n+'</td><td class="n">'+fmtG(m.total.g)+'</td></tr>'+
        m.members.map(function(r){return '<tr class="mem"><td>'+(r.name===NONE?'<span class="dim">'+NONE+'</span>':esc(r.name))+'</td><td class="n">'+r.v.n+'</td><td class="n">'+fmtG(r.v.g)+'</td></tr>';}).join('');
    }).join('')+'</tbody><tfoot><tr><td>Totale</td><td class="n">'+list.length+'</td><td class="n">'+fmtG(tot)+'</td></tr></tfoot></table></div></div>';
  var t3='<div class="card"><h3>Per aeromobile</h3><div class="scroll"><table class="tbl"><thead><tr><th>Aereo</th><th class="n">Rifornimenti</th><th class="n">US gal</th><th></th></tr></thead><tbody>'+
    s.aircraft.map(function(a){return '<tr><td><span class="tag">'+esc(a.name)+'</span></td><td class="n">'+a.v.n+'</td><td class="n">'+fmtG(a.v.g)+'</td><td class="barcell"><span class="bar" style="--w:'+Math.max(2,Math.round(a.v.g/maxA*100))+'%"></span></td></tr>';}).join('')+
    '</tbody><tfoot><tr><td>Totale</td><td class="n">'+list.length+'</td><td class="n">'+fmtG(tot)+'</td><td></td></tr></tfoot></table></div></div>';
  box.innerHTML=head+t1+t2+t3;
}
function renderLists(){
  var grid=$('#lists-grid'),keep={};
  $$('input[data-addkey]',grid).forEach(function(i){keep[i.dataset.addkey]=i.value;});
  var focused=document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.addkey;
  var titles={aircraft:'Aerei',operators:'Operatori',members:'Soci a cui addebitare'};
  var ph={aircraft:'Nuova sigla, es. I-ABCD',operators:'Nuovo operatore',members:'Nome e cognome'};
  grid.innerHTML=['aircraft','operators','members'].map(function(k){
    var chips=S.lists[k].map(function(v){
      var ask=S.confirmRm&&S.confirmRm.key===k&&S.confirmRm.val===v;
      return '<span class="chip">'+esc(v)+(ask
        ?' <button class="btn small danger" data-act="rm-yes">Rimuovi</button><button class="btn small" data-act="rm-no">No</button>'
        :'<button data-act="rm" data-key="'+k+'" data-val="'+esc(v)+'" aria-label="Rimuovi '+esc(v)+'">×</button>')+'</span>';
    }).join('')||'<span class="muted">Nessuna voce.</span>';
    return '<div class="card"><h3>'+titles[k]+'</h3><div class="chips">'+chips+'</div>'+
      '<form class="addrow" data-key="'+k+'"><input type="text" data-addkey="'+k+'" placeholder="'+ph[k]+'" aria-label="'+ph[k]+'" autocapitalize="'+(k==='members'?'words':'characters')+'" autocorrect="off" value="'+esc(keep[k]||'')+'"><button class="btn primary small" type="submit">Aggiungi</button></form></div>';
  }).join('');
  if(focused){var el=$('input[data-addkey="'+focused+'"]',grid);if(el)el.focus();}
}
function renderStatus(){
  var d=$('#st-dot'),t=$('#st-txt'),n=outbox.length;
  if(!S.url){d.className='dot';t.textContent='Solo su questo dispositivo';}
  else if(!S.token){d.className='dot warn';t.textContent='Manca il codice di accesso';}
  else if(S.net==='auth'){d.className='dot warn';t.textContent='Codice di accesso non valido';}
  else if(S.net==='offline'){d.className='dot warn';t.textContent='Offline'+(n?': '+n+' da inviare':'');}
  else if(S.net==='syncing'||n){d.className='dot warn';t.textContent='Sincronizzazione…';}
  else{d.className='dot ok';t.textContent='Sincronizzato';}
  updateFormMode();
}
function renderData(){
  populateForm();populateFilters();renderLists();renderLog();renderSummary();renderStatus();updateMail();
  if(!S.editingId)recalc();
}
function setTab(t){
  S.tab=t;
  ['nuovo','registro','riepilogo','elenchi'].forEach(function(n){$('#view-'+n).hidden=(n!==t);});
  $$('.tab').forEach(function(b){b.setAttribute('aria-selected',b.dataset.tab===t?'true':'false');});
  S.confirmDel=null;if(t==='registro')renderLog();
  window.scrollTo(0,0);
}

/* ---------- riepilogo / mail ---------- */
function csvCell(v){var s=String(v==null?'':v);return /[;"\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function buildReport(){
  var list=filtered(),tot=sumG(list),s=summary(list),L=[],D=[];
  L.push('TTake Aerobatic Team - Riepilogo rifornimenti');
  L.push('Filtri: '+filterText());
  L.push('Unità di misura: US gallon (gal)');L.push('');
  L.push('TOTALE: '+fmtG(tot)+' gal ('+list.length+' '+plural(list.length)+')');L.push('');
  L.push('PER MESE');
  s.months.forEach(function(m){var v=s.byMonth.get(m);L.push(monthLabel(m)+': '+fmtG(v.g)+' gal ('+v.n+')');});
  L.push('');L.push('PER MESE E SOCIO');
  s.byMM.forEach(function(m){
    L.push(monthLabel(m.month)+' - subtotale '+fmtG(m.total.g)+' gal ('+m.total.n+')');
    m.members.forEach(function(r){L.push('   '+r.name+': '+fmtG(r.v.g)+' gal ('+r.v.n+')');});
  });
  L.push('');L.push('PER AEROMOBILE');
  s.aircraft.forEach(function(a){L.push(a.name+': '+fmtG(a.v.g)+' gal ('+a.v.n+')');});
  D.push('ELENCO RIFORNIMENTI');
  list.forEach(function(e){
    var has=e.start!=null&&e.start!==''&&e.end!=null&&e.end!=='';
    D.push(fmtDate(e.date)+' | '+(e.aircraft||'-')+' | '+(e.operator||'-')+' | '+(e.member||NONE)+' | '+(has?fmtC(e.start)+' > '+fmtC(e.end)+' | ':'')+fmtG(e.gallons)+' gal');
  });
  var csv=['Data','Operatore','Aereo','Socio a cui addebitare','Contatore iniziale','Contatore finale','Galloni US'].join(';')+'\r\n'+
    list.map(function(e){return [fmtDate(e.date),e.operator,e.aircraft,e.member||'',e.start==null||e.start===''?'':toInput(e.start),e.end==null||e.end===''?'':toInput(e.end),toInput(e.gallons)].map(csvCell).join(';');}).join('\r\n');
  var subj='TTake Aerobatic Team - Riepilogo rifornimenti'+(S.filters.month?' - '+monthLabel(S.filters.month):'');
  return {subject:subj,text:L.join('\n'),detail:D.join('\n'),csv:csv,file:'rifornimenti-'+(S.filters.month||'tutti')+'.csv'};
}
function updateMail(){
  var r=buildReport(),body=r.text+(S.withList?'\n\n'+r.detail:''),dropped=false;
  var to=S.mailTo.replace(/[\s?&]/g,'');
  var href=function(b){return 'mailto:'+to+'?subject='+encodeURIComponent(r.subject)+'&body='+encodeURIComponent(b.replace(/\n/g,'\r\n'));};
  var h=href(body);
  if(h.length>7500&&S.withList){body=r.text;h=href(body);dropped=true;}
  $('#mail-go').setAttribute('href',h);
  $('#mail-pre').textContent=body;
  $('#mail-note').textContent=dropped?'L\'elenco è troppo lungo per il link di Mail ed è escluso. Usa Copia testo o il CSV per averlo completo.':'Il riepilogo usa i filtri scelti qui sopra. Per avere tutto in allegato usa Condividi CSV.';
}
function copyText(){
  var r=buildReport(),body=r.text+(S.withList?'\n\n'+r.detail:'');
  var fallback=function(){$('#mail-card details').open=true;var rg=document.createRange();rg.selectNodeContents($('#mail-pre'));var se=window.getSelection();se.removeAllRanges();se.addRange(rg);toast('Testo selezionato: usa Copia dal menu.');};
  try{navigator.clipboard.writeText(body).then(function(){toast('Testo copiato');},fallback);}catch(e){fallback();}
}
async function saveCsv(){
  var r=buildReport(),blob=new Blob(['﻿'+r.csv],{type:'text/csv'});
  try{
    var file=new File([blob],r.file,{type:'text/csv'});
    if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:r.subject});return;}
  }catch(e){if(e&&e.name==='AbortError')return;}
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=r.file;document.body.appendChild(a);a.click();
  setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},1500);
}

/* ---------- collegamento ---------- */
function fillConn(){$('#c-url').value=S.url||'';$('#c-token').value=S.token||'';}
async function saveConn(){
  var url=$('#c-url').value.trim(),token=$('#c-token').value.trim(),note=$('#c-note');
  S.url=url;S.token=token;lsSet(K_CONN,{url:url,token:token});S.net='idle';
  if(!url){note.textContent='Nessun indirizzo: i dati restano solo su questo dispositivo.';renderStatus();return;}
  if(!token){note.textContent='Inserisci il codice di accesso.';renderStatus();return;}
  note.textContent='Verifica in corso…';
  try{
    await api({action:'ping'});
    note.textContent='Collegato. I dati sono condivisi con gli altri operatori.';
    // i dati già presenti solo su questo dispositivo vengono inviati al foglio
    if(!outbox.length&&S.entries.length&&!lsGet('ttake-fuel-uploaded')){
      S.entries.forEach(function(e){queue({type:'save',entry:e});});queue({type:'lists',lists:clone(S.lists)});lsSet('ttake-fuel-uploaded',1);
    }
    sync();
  }catch(e){
    S.net=(e&&e.code==='auth')?'auth':'offline';
    note.textContent=(e&&e.code==='auth')?'Codice di accesso non valido.':'Impossibile raggiungere lo script. Controlla l\'indirizzo e la connessione.';
    renderStatus();
  }
}

/* ---------- eventi ---------- */
document.addEventListener('click',function(ev){
  var t=ev.target.closest('[data-act],[data-tab]');if(!t)return;
  if(t.dataset.tab){setTab(t.dataset.tab);return;}
  var a=t.dataset.act,id=t.dataset.id;
  if(a==='edit')startEdit(id);
  else if(a==='del'){S.confirmDel=id;renderLog();}
  else if(a==='del-no'){S.confirmDel=null;renderLog();}
  else if(a==='del-yes'){S.confirmDel=null;Store.removeEntry(id).then(function(){toast('Rifornimento eliminato');renderData();});}
  else if(a==='reset-filters'){S.filters={month:'',aircraft:'',operator:'',member:''};populateFilters();renderLog();renderSummary();updateMail();}
  else if(a==='use-last'){var le=lastEnd();if(le!=null){$('#f-start').value=toInput(le);recalc();}}
  else if(a==='combo-ok')comboAdd(t.dataset.c);
  else if(a==='combo-no')comboCancel(t.dataset.c);
  else if(a==='rm'){S.confirmRm={key:t.dataset.key,val:t.dataset.val};renderLists();}
  else if(a==='rm-no'){S.confirmRm=null;renderLists();}
  else if(a==='rm-yes'){
    var c=S.confirmRm;S.confirmRm=null;
    if(c){S.lists[c.key]=S.lists[c.key].filter(function(x){return x!==c.val;});Store.saveLists();}
    renderData();
  }
  else if(a==='copy')copyText();
  else if(a==='csv')saveCsv();
});
document.addEventListener('change',function(ev){
  var t=ev.target;
  if(t.dataset&&t.dataset.filter){
    S.filters[t.dataset.filter]=t.value;
    ['log','sum'].forEach(function(p){var s=$('#'+p+'-fl-'+t.dataset.filter);if(s&&s!==t)s.value=t.value;});
    renderLog();renderSummary();updateMail();return;
  }
  var c=COMBOS.find(function(x){return t.id==='f-'+x.id;});
  if(c){var box=$('#add-'+c.id);box.hidden=(t.value!=='__new__');if(!box.hidden)$('#add-'+c.id+'-in').focus();}
  if(t.id==='mail-list'){S.withList=t.checked;updateMail();}
});
document.addEventListener('keydown',function(ev){
  if(ev.key!=='Enter')return;
  var m=/^add-(\w+)-in$/.exec(ev.target.id||'');
  if(m){ev.preventDefault();comboAdd(m[1]);}
});
document.addEventListener('submit',function(ev){
  var f=ev.target;
  if(f.id==='f'){onSubmit(ev);return;}
  if(f.classList&&f.classList.contains('addrow')){
    ev.preventDefault();
    var k=f.dataset.key,inp=$('input',f),c=COMBOS.find(function(x){return x.key===k;}),v=normName(c,inp.value);
    if(!v)return;
    if(!S.lists[k].some(function(x){return x.toLowerCase()===v.toLowerCase();})){S.lists[k].push(v);Store.saveLists();toast('Aggiunto: '+v);}
    else toast('Già presente: '+v);
    inp.value='';renderData();
  }
});
document.addEventListener('input',function(ev){
  var t=ev.target;
  if(t.classList&&t.classList.contains('invalid'))t.classList.remove('invalid');
  if(t.id==='f-start'||t.id==='f-end')recalc();
  else if(t.id==='f-gal'){S.galManual=true;galDiff();}
  else if(t.id==='mail-to'){S.mailTo=t.value;lsSet(K_MAIL,S.mailTo);updateMail();}
});
$('#f-cancel').addEventListener('click',function(){resetForm(true);renderLog();});
$('#c-save').addEventListener('click',saveConn);
document.addEventListener('visibilitychange',function(){if(!document.hidden)sync();});
window.addEventListener('online',function(){sync();});
setInterval(function(){if(!document.hidden)sync();},30000);

/* ---------- avvio ---------- */
buildCombos();buildFilterBars();fillConn();
$('#mail-to').value=S.mailTo;
resetForm(true);renderData();
sync();
if('serviceWorker' in navigator&&location.protocol!=='file:'){navigator.serviceWorker.register('sw.js').catch(function(){});}
})();
