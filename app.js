(()=>{
const $=id=>document.getElementById(id);
const R=80, C=100, NS='http://www.w3.org/2000/svg';
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const store={
  get(k,d){ try{ const v=localStorage.getItem(k); return v===null?d:v; }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k,String(v)); }catch(e){} }
};

/* モードごとの設定
   normal  : 100%から下がる。低い%までクリアするほどすごい
   yamedoki: 100%から下がる。当たるたびに点がたまり、いつでもやめて点をもらえる。はずれたら0点
   gyaku   : 1%から上がる。はずれるたびに+1%。早く当たるほどラッキー */
const MODES={
  normal:  {start:100, bestKey:'kakuritsu-best',          better:(a,b)=>a<b, unit:'%',
            hint:'みどりにとまればクリア。1かいごとに1%ずつ下がるよ'},
  gyaku:   {start:1,   bestKey:'kakuritsu-best-gyaku',    better:(a,b)=>a<b, unit:'%',
            hint:'1%からスタート。はずれるたびに1%ずつ上がるよ<br>早くあたるほどラッキー'}
};
let mode=store.get('kakuritsu-mode','normal'); if(!MODES[mode]) mode='normal';
let p=MODES[mode].start, rot=0, busy=false, streak=0, pot=0, misses=0;
let soundOn=store.get('kakuritsu-sound','on')!=='off';
const bests={}; for(const m in MODES) bests[m]=parseInt(store.get(MODES[m].bestKey,'0'),10)||0;

// 目盛り
for(let i=0;i<100;i+=10){
  const a=(i/100)*2*Math.PI, l=document.createElementNS(NS,'line');
  l.setAttribute('x1',C+Math.sin(a)*70);l.setAttribute('y1',C-Math.cos(a)*70);
  l.setAttribute('x2',C+Math.sin(a)*90);l.setAttribute('y2',C-Math.cos(a)*90);
  l.setAttribute('stroke','var(--disc)');l.setAttribute('stroke-width','1.5');
  $('ticks').appendChild(l);
}
// 玉の残像
const trail=[];
for(let i=0;i<6;i++){
  const c=document.createElementNS(NS,'circle');
  c.setAttribute('cx',C);c.setAttribute('cy',20);c.setAttribute('r',7-i*.8);
  c.setAttribute('fill','var(--ball)');c.setAttribute('opacity',0);
  $('trail').appendChild(c);trail.push(c);
}

function arcPath(pc){
  if(pc>=100) return `M ${C} ${C-R} A ${R} ${R} 0 1 1 ${C-0.01} ${C-R}`;
  const a=(pc/100)*2*Math.PI;
  return `M ${C} ${C-R} A ${R} ${R} 0 ${pc>50?1:0} 1 ${C+Math.sin(a)*R} ${C-Math.cos(a)*R}`;
}
// ふつう:この%までクリアできる確率
const {clearProb,hitByProb,spinOnce}=window.Core;
// ぎゃく:この%までに当たる確率
// 「何回に何回」で言う
function timesText(q){
  if(q>=0.999999) return '<span class="big">かならず</span>';
  if(q>=0.1) return '10回やったら<br><span class="big">'+Math.max(1,Math.round(q*10))+'回</span>くらい';
  return '<span class="big">'+Math.round(1/q).toLocaleString()+'回</span>に<br>1回くらい';
}
function fmt(q){
  if(q>=0.995) return '100%';
  if(q>=0.1) return Math.round(q*100)+'%';
  if(q>=0.01) return (q*100).toFixed(1)+'%';
  return '約 '+Math.round(1/q).toLocaleString()+' 分の1';
}
const gainAt=pc=>101-pc;   // やめどき:この%で当たったときにもらえる点

function draw(){
  $('arc').setAttribute('d',arcPath(p));
  $('glow').setAttribute('d',arcPath(p));
  $('pct').innerHTML=p+'<small>%</small>';
  const b=bests[mode];
  $('best').textContent=b?b+MODES[mode].unit:'—';
  $('snd').textContent=soundOn?'おと あり':'おと なし';
  if(mode==='normal'){
    $('reach').innerHTML='ここまで来る確率 <b>'+fmt(clearProb(p+1))+'</b>';
    $('combo').textContent=streak>=2?streak+' れんぞく!':'';
  }else if(mode==='yamedoki'){
    $('reach').innerHTML='ためた点 <span class="pot">'+pot+'</span>点　<span class="next">つぎ +'+gainAt(p)+'点</span>';
    $('combo').textContent='';
    $('stopPts').textContent=pot+'点もらう';
    $('stop').disabled=busy||pot===0;
  }else{
    $('reach').innerHTML='はずれた回数 <b>'+misses+'回</b>';
    $('combo').textContent='';
  }
  $('spin').disabled=busy;
  document.querySelectorAll('.modes button').forEach(btn=>{
    btn.setAttribute('aria-pressed',btn.dataset.mode===mode);
    btn.disabled=busy;
  });
}
function retrigger(el,cls){ if(reduce&&cls!=='bannerGo') return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

/* ===== 音 ===== */
let ac=null;
function ctx(){ return ac=ac||new (window.AudioContext||window.webkitAudioContext)(); }
function tone(freq,dur,type='sine',vol=.18,slide=0,delay=0){
  if(!soundOn) return;
  try{
    const a=ctx(),t=a.currentTime+delay,o=a.createOscillator(),g=a.createGain();
    o.type=type;o.frequency.setValueAtTime(freq,t);
    if(slide) o.frequency.exponentialRampToValueAtTime(slide,t+dur);
    g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+0.008);
    g.gain.exponentialRampToValueAtTime(.0008,t+dur);
    o.connect(g).connect(a.destination);o.start(t);o.stop(t+dur+.02);
  }catch(e){}
}
function noise(dur,vol=.2,hp=800){
  if(!soundOn) return;
  try{
    const a=ctx(),len=Math.floor(a.sampleRate*dur),b=a.createBuffer(1,len,a.sampleRate),d=b.getChannelData(0);
    for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2);
    const s=a.createBufferSource(),f=a.createBiquadFilter(),g=a.createGain();
    f.type='highpass';f.frequency.value=hp;g.gain.value=vol;
    s.buffer=b;s.connect(f).connect(g).connect(a.destination);s.start();
  }catch(e){}
}
const SCALE=[0,2,4,7,9,12,14,16,19,21,24,26,28,31];
const tick=()=>tone(1500,.025,'square',.035);
function winSound(){
  const base=440*Math.pow(2,SCALE[Math.min(streak,SCALE.length-1)]/12)/2;
  tone(base,.16,'triangle',.22);
  tone(base*1.5,.2,'triangle',.18,0,.06);
  tone(base*2,.28,'sine',.16,0,.12);
  noise(.12,.12,4000);
}
function bigWin(){
  [0,4,7,12,16].forEach((s,i)=>tone(523*Math.pow(2,s/12),.45,'triangle',.18,0,i*.07));
  tone(130,.4,'sine',.3,65);
  noise(.5,.18,2500);
}
function coinSound(){ tone(988,.08,'square',.12); tone(1319,.35,'square',.12,0,.08); }
function softMiss(){ tone(260,.16,'triangle',.12,200); }
function loseSound(){
  tone(330,.55,'sawtooth',.16,80);
  tone(110,.45,'square',.12,50,.05);
  noise(.35,.25,300);
}

/* ===== 紙ふぶき ===== */
const cv=$('fx'),g2=cv.getContext('2d');let parts=[],dpr=1,running=false;
// 大きさは窓 (innerHeight) ではなく canvas そのものから取る。0 のときは組み直さない (落とし穴の表)
let VW=innerWidth, VH=innerHeight;
function size(){
  const w=cv.clientWidth, h=cv.clientHeight;
  if(!(w>=1&&h>=1)) return;
  VW=w; VH=h; dpr=Math.min(2,devicePixelRatio||1); cv.width=w*dpr; cv.height=h*dpr;
}
size();addEventListener('resize',size);
function burst(x,y,n,colors,power=1,gravity=.18){
  if(reduce) n=Math.min(n,8);
  for(let i=0;i<n;i++){
    const a=Math.random()*Math.PI*2,s=(2+Math.random()*7)*power;
    parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-2*power,life:1,decay:.012+Math.random()*.018,
      size:3+Math.random()*5,color:colors[i%colors.length],rot:Math.random()*6,vr:(Math.random()-.5)*.4,
      shape:Math.random()<.5?0:1,g:gravity});
  }
  if(!running){ running=true; requestAnimationFrame(frame); }
}
function frame(){
  g2.setTransform(dpr,0,0,dpr,0,0);g2.clearRect(0,0,VW,VH);
  parts=parts.filter(q=>q.life>0);
  for(const q of parts){
    q.vx*=.985;q.vy=q.vy*.985+q.g;q.x+=q.vx;q.y+=q.vy;q.rot+=q.vr;q.life-=q.decay;
    g2.globalAlpha=Math.max(0,q.life);g2.fillStyle=q.color;
    g2.save();g2.translate(q.x,q.y);g2.rotate(q.rot);
    if(q.shape) g2.fillRect(-q.size/2,-q.size/4,q.size,q.size/2);
    else {g2.beginPath();g2.arc(0,0,q.size/2,0,Math.PI*2);g2.fill();}
    g2.restore();
  }
  g2.globalAlpha=1;
  if(parts.length) requestAnimationFrame(frame); else {running=false;g2.clearRect(0,0,VW,VH);}
}
const PARTY=()=>[css('--win'),css('--ball'),'#4FA3E0','#FF7FA8','#ffffff'];
function ballScreenPos(deg){
  const b=$('wrap').getBoundingClientRect(),k=b.width/200,a=deg*Math.PI/180;
  const o=cv.getBoundingClientRect();
  return {x:b.left-o.left+(C+Math.sin(a)*R)*k,y:b.top-o.top+(C-Math.cos(a)*R)*k};
}
function banner(text){ const b=$('banner'); b.textContent=text; retrigger(b,'bannerGo'); }
function buzz(ms){ try{navigator.vibrate&&navigator.vibrate(ms);}catch(e){} }
function darkenArc(){
  $('glow').setAttribute('opacity',.35);
  setTimeout(()=>$('glow').setAttribute('opacity',0),260);
}
function fireworks(){
  for(let i=0;i<3;i++) setTimeout(()=>burst(VW*(.2+.3*i),VH*.3,60,PARTY(),1.3,.15),i*180);
  bigWin();
}

/* ===== ゲーム ===== */
function rand(){ const a=new Uint32Array(1); crypto.getRandomValues(a); return a[0]/4294967296; }
function setBall(a,speed){
  $('ballG').setAttribute('transform',`rotate(${a} ${C} ${C})`);
  trail.forEach((c,i)=>{
    c.setAttribute('transform',`rotate(${a-speed*(i+1)*1.6} ${C} ${C})`);
    c.setAttribute('opacity',Math.min(.5,speed/14)*(1-i/trail.length));
  });
}

function spin(){
  if(busy||$('over').classList.contains('show')) return;
  if(ac&&ac.state==='suspended') ac.resume();
  busy=true; $('msg').textContent=''; draw();
  $('glow').setAttribute('opacity',0);
  const {ok,deg:target}=spinOnce(p,rand());   // 止まった場所がみどりならあたり
  const from=rot%360, to=from+360*3+(target-from+360)%360;
  const dur=reduce?200:Math.max(650,950-Math.max(streak,misses)*15);
  const start=performance.now(); let last=from,lastSeg=-1;
  (function step(now){
    const t=Math.min(1,(now-start)/dur), e=1-Math.pow(1-t,3), a=from+(to-from)*e;
    setBall(a,a-last); last=a;
    const seg=Math.floor(a/18); if(seg!==lastSeg){lastSeg=seg; if(t<.97) tick();}
    if(t<1) requestAnimationFrame(step); else { rot=to; setBall(to,0); finish(ok,target); }
  })(start);
}

function done(){ busy=false; draw(); }

function finish(ok,deg){
  const pos=ballScreenPos(deg), win=css('--win'), gold=css('--ball');

  if(mode==='gyaku'){
    if(ok){
      bigWin(); buzz([20,40,30]);
      burst(pos.x,pos.y,90,PARTY(),1.6,.12);
      banner(p+'% で あたり!');
      retrigger($('wrap'),'thump');
      $('msg').textContent='あたり!';
      setTimeout(()=>gameOver('hit'),1000);
    }else{
      softMiss(); buzz(10);
      misses++; p+=1;
      $('msg').textContent='はずれ… つぎは '+p+'%';
      retrigger($('pct'),'pop');
      done();
    }
    return;
  }

  if(ok){
    streak++;
    const cleared=p; p-=1;
    let gained=0;
    if(mode==='yamedoki'){ gained=gainAt(cleared); pot+=gained; }
    const milestone=(cleared%10===0&&cleared<100)||(cleared<=85&&cleared%5===0);
    if(milestone){
      bigWin(); buzz([20,40,30]);
      burst(pos.x,pos.y,90,PARTY(),1.6,.12);
      banner(cleared+'% とっぱ!');
      retrigger($('wrap'),'thump');
    }else{
      winSound(); buzz(15);
      burst(pos.x,pos.y,26+Math.min(streak,20)*2,[win,gold,'#ffffff'],1+Math.min(streak,20)*.03);
    }
    darkenArc();
    $('msg').textContent= mode==='yamedoki' ? '+'+gained+'点!' :
      ['クリア!','ナイス!','いいね!','その調子!','すごい!'][Math.floor(rand()*5)];
    retrigger($('pct'),'pop');
    done();
    if(p<=0) gameOver('all');
  }else{
    loseSound(); buzz([60,40,120]);
    burst(pos.x,pos.y,40,[css('--lose'),'#7a2a24',css('--rim')],1.1,.35);
    retrigger($('wrap'),'shake');
    $('msg').textContent= mode==='yamedoki'&&pot>0 ? pot+'点が きえた…' : 'はずれ…';
    setTimeout(()=>gameOver('lose'),750);
  }
}

function stopNow(){
  if(mode!=='yamedoki'||busy||pot===0) return;
  coinSound(); buzz(20);
  const b=$('stop').getBoundingClientRect();
  burst(b.left+b.width/2-cv.getBoundingClientRect().left,b.top-cv.getBoundingClientRect().top,50,[css('--ball'),'#ffffff',css('--win')],1.2,.2);
  gameOver('stop');
}

function saveBest(score){
  const m=MODES[mode], cur=bests[mode];
  const isBest=score>0&&(cur===0||m.better(score,cur));
  if(isBest){ bests[mode]=score; store.set(m.bestKey,score); }
  return isBest;
}

function gameOver(why){
  busy=true; draw();
  const lost=$('lostAt'); lost.classList.remove('good');
  let isBest=false;

  if(mode==='normal'){
    const cleared=p+1;
    isBest=saveBest(cleared);
    lost.textContent= why==='all' ? 'ぜんぶクリア!' : p+'% で はずれ';
    if(why==='all') lost.classList.add('good');
    $('score').innerHTML=cleared+'<small>%</small>';
    $('cap').textContent='までクリア';
    $('odds').innerHTML='ここまで来られるのは<br>'+timesText(clearProb(cleared));
  }

  else if(mode==='yamedoki'){
    if(why==='stop'){
      isBest=saveBest(pot);
      lost.textContent='やめた!'; lost.classList.add('good');
      $('score').innerHTML=pot+'<small>点</small>';
      $('cap').textContent=p+'% のところでストップ';
      // もしまわしていたら…
      const would=rand()*100<p;
      $('odds').innerHTML='もし まわしていたら…<br>'+(would
        ? '<span class="big w">あたり</span>だった(+'+gainAt(p)+'点)'
        : '<span class="big l">はずれ</span>だった!');
    }else if(why==='all'){
      isBest=saveBest(pot);
      lost.textContent='ぜんぶクリア!'; lost.classList.add('good');
      $('score').innerHTML=pot+'<small>点</small>';
      $('cap').textContent='';
      $('odds').innerHTML='';
    }else{
      lost.textContent=p+'% で はずれ';
      $('score').innerHTML='0<small>点</small>';
      $('cap').textContent=pot>0 ? 'ためていた '+pot+'点 が きえた…' : '';
      $('odds').innerHTML= pot>0 ? '1回まえで やめていたら<br><span class="big">'+pot+'点</span>だった' : '';
    }
  }

  else{
    isBest=saveBest(p);
    lost.textContent=(misses+1)+'回目で あたり!'; lost.classList.add('good');
    $('score').innerHTML=p+'<small>%</small>';
    $('cap').textContent='で あたり';
    $('odds').innerHTML= p===1
      ? 'いきなり あたるのは<br>'+timesText(hitByProb(1))
      : (hitByProb(p)<0.5?'こんなに早く あたるのは':'ここまでに あたるのは')+'<br>'+timesText(hitByProb(p));
  }

  $('newbest').textContent=isBest?'さいこう記録!':'';
  $('over').classList.add('show');
  if(isBest) setTimeout(fireworks,250);
  $('again').focus();
}

function reset(){
  p=MODES[mode].start; streak=0; pot=0; misses=0; busy=false;
  $('msg').textContent= mode==='gyaku' ? 'みどりにとまれば あたり' : 'みどりにとまればクリア';
  $('hint').innerHTML=MODES[mode].hint;
  document.body.className=mode;
  $('over').classList.remove('show');
  draw();
}

function setMode(m){
  if(busy||m===mode&&!$('over').classList.contains('show')) return;
  mode=m; store.set('kakuritsu-mode',m);
  reset();
}

$('spin').addEventListener('click',spin);
$('wrap').addEventListener('click',spin);
$('stop').addEventListener('click',stopNow);
$('again').addEventListener('click',reset);
document.querySelectorAll('.modes button').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
$('snd').addEventListener('click',()=>{soundOn=!soundOn;store.set('kakuritsu-sound',soundOn?'on':'off');draw();});
reset();

// テストから中身をのぞく入口
window.__app={ get mode(){return mode;}, get p(){return p;}, get busy(){return busy;}, get streak(){return streak;},
  get misses(){return misses;}, get bests(){return bests;}, get over(){return $('over').classList.contains('show');}, get parts(){return parts.length;} };

// オフラインでも開けるように (ネット優先)
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
