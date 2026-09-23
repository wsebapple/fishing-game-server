/* ------------------------------------------------------
   사운드 엔진: 소리 파일 없이 코드로 직접 소리를 만들어요
   (오실레이터로 음을 연주하는 방식 - 저작권 걱정 없어요!)
------------------------------------------------------ */
Game.audio = { ctx: null, soundOn: true, musicTimer: null, musicStep: 0 };

function ensureAudio(){
  if(!Game.audio.ctx){
    Game.audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if(Game.audio.ctx.state === 'suspended') Game.audio.ctx.resume();
}

function playTone(freq, duration=0.15, type='sine', volume=0.2, when=0){
  if(!Game.audio.soundOn || !Game.audio.ctx) return;
  const t0 = Game.audio.ctx.currentTime + when;
  const osc = Game.audio.ctx.createOscillator();
  const gain = Game.audio.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain).connect(Game.audio.ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.03);
}

function playCatchSound(points, isTreasure, isMagnet, isTimeBonus){
  if(isTreasure){
    [880,1100,1320,1568].forEach((f,i)=>playTone(f,0.12,'triangle',0.18,i*0.07));
    return;
  }
  if(isMagnet){
    [660,880,660,880].forEach((f,i)=>playTone(f,0.1,'square',0.16,i*0.06));
    return;
  }
  if(isTimeBonus){
    [784,988].forEach((f,i)=>playTone(f,0.16,'sine',0.2,i*0.1));
    return;
  }
  if(points > 0){
    const base = 440 + Math.min(points,15) * 20;
    playTone(base, 0.14, 'triangle', 0.22);
    playTone(base*1.5, 0.1, 'triangle', 0.12, 0.05);
  } else if(points < 0){
    playTone(180, 0.25, 'sawtooth', 0.2);
    playTone(140, 0.25, 'sawtooth', 0.15, 0.08);
  } else {
    playTone(200, 0.1, 'square', 0.12);
    playTone(150, 0.15, 'square', 0.12, 0.1);
  }
}

function playStealSound(){
  playTone(300, 0.15, 'sawtooth', 0.15);
  playTone(220, 0.2, 'sawtooth', 0.15, 0.1);
  playTone(160, 0.25, 'sawtooth', 0.15, 0.2);
}

// 보스가 물고기를 꿀꺽 삼킬 때
function playEatSound(){
  playTone(140, 0.08, 'square', 0.14);
  playTone(90, 0.14, 'square', 0.14, 0.07);
}

function playLevelUpSound(){
  [523,659,784,1046].forEach((f,i)=>playTone(f,0.15,'square',0.2,i*0.09));
}

function playGameOverSound(isRecord){
  if(isRecord){
    [660,880,1108,1320].forEach((f,i)=>playTone(f,0.18,'triangle',0.22,i*0.12));
  } else {
    [440,392,349].forEach((f,i)=>playTone(f,0.22,'sine',0.2,i*0.15));
  }
}

// 배경음악: 짧은 멜로디를 계속 반복해서 연주해요 (0은 쉼표)
const bgMelody = [523,0,659,0,784,0,659,0, 587,0,698,0,880,0,698,0];

function startBgMusic(){
  stopBgMusic();
  if(!Game.audio.soundOn) return;
  Game.audio.musicStep = 0;
  Game.audio.musicTimer = setInterval(() => {
    const note = bgMelody[Game.audio.musicStep % bgMelody.length];
    if(note) playTone(note, 0.18, 'triangle', 0.05);
    Game.audio.musicStep++;
  }, 260);
}

function stopBgMusic(){
  if(Game.audio.musicTimer){ clearInterval(Game.audio.musicTimer); Game.audio.musicTimer = null; }
}

document.getElementById('soundToggle').addEventListener('click', () => {
  ensureAudio();
  Game.audio.soundOn = !Game.audio.soundOn;
  document.getElementById('soundToggle').innerHTML = Game.audio.soundOn ? '🔊' : '🔇';
  if(Game.audio.soundOn && (Game.state.running || Game.mp.active)) startBgMusic();
  else stopBgMusic();
});


function playThunderSound(){
  playTone(90, 0.5, 'sawtooth', 0.18);
  playTone(60, 0.6, 'sawtooth', 0.14, 0.1);
}

function playBossSound(){
  [220,277,330,415].forEach((f,i)=>playTone(f,0.22,'sawtooth',0.2,i*0.1));
}

function playBossEscapeSound(kind){
  if(kind === 'splash') [523,659,784].forEach((f,i)=>playTone(f,0.14,'triangle',0.18,i*0.05));
  else if(kind === 'wave') [98,73,55].forEach((f,i)=>playTone(f,0.32,'sine',0.22,i*0.09));
  else if(kind === 'shock') [880,220,660,165].forEach((f,i)=>playTone(f,0.1,'square',0.14,i*0.06));
  else if(kind === 'sand') [150,120].forEach((f,i)=>playTone(f,0.22,'triangle',0.12,i*0.08));
  else [180,140,100,70].forEach((f,i)=>playTone(f,0.18,'sawtooth',0.18,i*0.07)); // ink(기본값)
}

// 상어가 순간 돌진할 때: 쐐액 하고 빠르게 낮아지는 소리
function playDashSound(){
  playTone(1100, 0.05, 'sawtooth', 0.15);
  playTone(650, 0.07, 'sawtooth', 0.14, 0.04);
  playTone(320, 0.09, 'sawtooth', 0.12, 0.08);
}

// 고래·상어의 물보라/파도에 맞아 바늘과 물고기들이 확 밀려날 때
function playPushSound(){
  playTone(220, 0.1, 'sine', 0.2);
  playTone(130, 0.18, 'sine', 0.22, 0.05);
}

// 바다용에게 감전된 1초 동안 지지직 울리는 버즈
function playShockBuzzSound(){
  for(let i = 0; i < 7; i++) playTone(170 + Math.random() * 280, 0.05, 'square', 0.07, i * 0.13);
}

// 해적 배가 그물을 던져 물속에 텀벙 빠뜨릴 때
function playNetSplashSound(){
  playTone(520, 0.05, 'sine', 0.14);
  playTone(260, 0.12, 'sine', 0.16, 0.05);
}

// 대왕게가 쓰레기를 던지기 직전 경고음(삐빅삐빅)
function playTrashWarnSound(){
  playTone(700, 0.07, 'square', 0.12);
  playTone(700, 0.07, 'square', 0.12, 0.2);
}

// 대왕게가 쓰레기를 던지는 순간(휙 던지고 철퍽)
function playTrashThrowSound(){
  playTone(480, 0.06, 'sawtooth', 0.15);
  playTone(250, 0.12, 'sawtooth', 0.13, 0.05);
  playTone(130, 0.1, 'triangle', 0.1, 0.12);
}
