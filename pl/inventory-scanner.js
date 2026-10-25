// GPBS Storage PL: QR / Code128 camera opened for one deliberate scan at a time.
// Does not touch the main French scanner or its #reader element.
(() => {
  'use strict';
  const SRC='https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
  let loader=null;
  let scanner=null;
  let active=false;
  let locked=false;
  let starting=false;
  let generation=0;

  function loadLibrary() {
    if(window.Html5Qrcode)return Promise.resolve();
    if(loader)return loader;
    loader=new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-pl-inventory-scanner]');
      if(existing){
        existing.addEventListener('load',resolve,{once:true});
        existing.addEventListener('error',()=>reject(Error('Nie można pobrać modułu skanera.')),{once:true});
        return;
      }
      const tag=document.createElement('script');
      tag.src=SRC;
      tag.async=true;
      tag.dataset.plInventoryScanner='true';
      tag.onload=resolve;
      tag.onerror=()=>reject(Error('Nie można pobrać modułu skanera.'));
      document.head.append(tag);
    }).catch(error=>{loader=null;throw error;});
    return loader;
  }

  function beep() {
    try {
      const Audio=window.AudioContext||window.webkitAudioContext;
      if(!Audio)return;
      const ctx=new Audio();
      ctx.resume().catch(()=>{});
      const tone=ctx.createOscillator();
      const gain=ctx.createGain();
      tone.frequency.value=1000;
      gain.gain.setValueAtTime(0.045,ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+0.11);
      tone.connect(gain);
      gain.connect(ctx.destination);
      tone.start();
      tone.stop(ctx.currentTime+0.11);
      tone.onended=()=>ctx.close().catch(()=>{});
      navigator.vibrate?.(35);
    }catch{}
  }

  async function start(onCode) {
    if(active||starting)return;
    starting=true;
    const local=++generation;
    try {
      await loadLibrary();
      if(local!==generation)return;
      const formats=window.Html5QrcodeSupportedFormats;
      const reader=new window.Html5Qrcode('inventoryReader',formats?{
        formatsToSupport:[formats.QR_CODE,formats.CODE_128],verbose:false
      }:{verbose:false});
      scanner=reader;
      locked=false;
      await reader.start({facingMode:'environment'},{
        fps:12,
        qrbox:(width,height)=>{
          const edge=Math.max(170,Math.floor(Math.min(width,height)*0.72));
          return {width:edge,height:edge};
        },
        disableFlip:false
      },async decoded=>{
        if(locked||local!==generation)return;
        const code=String(decoded||'').replace(/\u0000/g,'').trim();
        if(!code)return;
        locked=true;
        try{scanner?.pause(true);}catch{}
        beep();
        try{await onCode(code);}catch(error){
          // Bad reads are handled by the parent UI, not as fatal camera faults.
          try{scanner?.resume();}catch{}
          locked=false;
        }
      },()=>{});
      if(local!==generation){
        try{if(reader.isScanning)await reader.stop();}catch{}
        try{reader.clear();}catch{}
        if(scanner===reader)scanner=null;
      }else active=true;
    }finally{starting=false;}
  }

  function resume() {
    if(!scanner||!active)return false;
    try{
      scanner.resume();
      locked=false;
      return true;
    }catch {
      locked=false;
      return false;
    }
  }

  function pause() {
    if(!scanner||!active)return;
    locked=true;
    try{scanner.pause(true);}catch{}
  }

  async function stop() {
    generation++;
    locked=true;
    const current=scanner;
    scanner=null;
    active=false;
    if(!current)return;
    try{if(current.isScanning)await current.stop();}catch{}
    try{current.clear();}catch{}
  }

  window.GPBSInventoryCamera={start,pause,resume,stop,isActive:()=>active};
})();
