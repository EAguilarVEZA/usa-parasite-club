/* Parasite Club USA — marketing tech foundation
 * Consent Mode v2 cookie banner + GA4 / Meta / TikTok / Google Ads pixels (consent-gated)
 * + first-touch UTM/click-id attribution + MK.track() funnel events.
 * Fill in the IDs below, then it's live. No IDs = that pixel simply stays off.
 */
(function () {
  var CFG = {
    ga4:      '',   // 'G-XXXXXXX'        Google Analytics 4
    googleAds:'',   // 'AW-XXXXXXXXX'     Google Ads
    metaPixel:'',   // '1234567890'       Meta (Facebook/Instagram) Pixel
    tiktok:   '',   // 'XXXXXXXXXXXX'     TikTok Pixel
    privacyUrl:'/privacy.html'
  };

  // ---------- dataLayer + Consent Mode v2 (default: deny until opt-in) ----------
  window.dataLayer = window.dataLayer || [];
  function gtag(){ dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  gtag('consent', 'default', {
    ad_storage:'denied', analytics_storage:'denied',
    ad_user_data:'denied', ad_personalization:'denied',
    functionality_storage:'granted', security_storage:'granted',
    wait_for_update: 500
  });

  // ---------- first-touch attribution capture ----------
  var KEYS=['utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_funnel','utm_placement',
            'fbclid','ttclid','gclid','msclkid'];
  function captureAttr(){
    try{
      var q=new URLSearchParams(location.search), got={};
      KEYS.forEach(function(k){ if(q.get(k)) got[k]=q.get(k); });
      if(Object.keys(got).length){
        got.landing=location.pathname; got.referrer=document.referrer||''; got.ts=Date.now();
        if(!localStorage.getItem('upc_attr')) localStorage.setItem('upc_attr', JSON.stringify(got)); // first-touch (sticky)
        localStorage.setItem('upc_attr_last', JSON.stringify(got));                                   // last-touch
      }
    }catch(e){}
  }
  function attr(){ try{ return JSON.parse(localStorage.getItem('upc_attr')||'{}'); }catch(e){ return {}; } }

  // ---------- pixel loaders (only run after consent + only if an ID is set) ----------
  var loaded=false;
  function loadScript(src){ var s=document.createElement('script'); s.async=true; s.src=src; document.head.appendChild(s); }
  function loadPixels(){
    if(loaded) return; loaded=true;
    // GA4 + Google Ads (shared gtag.js)
    var gid = CFG.ga4 || CFG.googleAds;
    if(gid){
      loadScript('https://www.googletagmanager.com/gtag/js?id='+gid);
      gtag('js', new Date());
      if(CFG.ga4) gtag('config', CFG.ga4, { anonymize_ip:true });
      if(CFG.googleAds) gtag('config', CFG.googleAds);
    }
    // Meta Pixel
    if(CFG.metaPixel){
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
      if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('init', CFG.metaPixel); window.fbq('track','PageView');
    }
    // TikTok Pixel
    if(CFG.tiktok){
      !function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=['page','track','identify','instances','debug','on','off','once','ready','alias','group','enableCookie','disableCookie'];
      ttq.setAndDefer=function(o,m){o[m]=function(){o.push([m].concat(Array.prototype.slice.call(arguments,0)))}};
      for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
      ttq.load=function(e){var n='https://analytics.tiktok.com/i18n/pixel/events.js';ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=n;ttq._t=ttq._t||{};ttq._t[e]=+new Date;
      var o=d.createElement('script');o.async=!0;o.src=n+'?sdkid='+e+'&lib='+t;var a=d.getElementsByTagName('script')[0];a.parentNode.insertBefore(o,a)};
      ttq.load(CFG.tiktok);ttq.page()}(window,document,'ttq');
    }
  }

  // ---------- consent banner ----------
  function showBanner(){
    if(document.getElementById('mk-consent')) return;
    var css='#mk-consent{position:fixed;left:14px;right:14px;bottom:14px;z-index:9999;max-width:680px;margin:0 auto;background:#0c0d11;color:#F2EEE4;border:1px solid #C8FF00;border-radius:14px;padding:16px 18px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 8px 30px #000a}'
      +'#mk-consent p{font-size:12.5px;line-height:1.6;margin:0 0 12px}#mk-consent a{color:#C8FF00}'
      +'#mk-consent .row{display:flex;gap:10px;flex-wrap:wrap}#mk-consent button{border:none;border-radius:30px;padding:11px 18px;font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;cursor:pointer;font-family:inherit}'
      +'#mk-acc{background:#C8FF00;color:#0a0a0c}#mk-dec{background:transparent;color:#F2EEE4;border:1px solid #ffffff40}';
    var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
    var b=document.createElement('div');b.id='mk-consent';
    b.innerHTML='<p>We use cookies to run analytics and personalize ads on Meta, Instagram, TikTok and Google so we can show you frames you’ll love. You can accept or decline non-essential cookies. See our <a href="'+CFG.privacyUrl+'">Privacy &amp; Cookie Policy</a>.</p>'
      +'<div class="row"><button id="mk-acc">Accept all</button><button id="mk-dec">Decline non-essential</button></div>';
    document.body.appendChild(b);
    document.getElementById('mk-acc').onclick=function(){ grant(true); };
    document.getElementById('mk-dec').onclick=function(){ grant(false); };
  }
  function grant(yes){
    try{ localStorage.setItem('upc_consent', yes?'granted':'denied'); }catch(e){}
    var b=document.getElementById('mk-consent'); if(b) b.remove();
    if(yes){
      gtag('consent','update',{ ad_storage:'granted', analytics_storage:'granted', ad_user_data:'granted', ad_personalization:'granted' });
      loadPixels(); MK.track('PageView');
    }
  }

  // ---------- public event helper (maps one call to all platforms) ----------
  var MAP={ PageView:{fb:'PageView',tt:'Pageview'}, ViewContent:{fb:'ViewContent',tt:'ViewContent'},
            AddToCart:{fb:'AddToCart',tt:'AddToCart'}, InitiateCheckout:{fb:'InitiateCheckout',tt:'InitiateCheckout'},
            Lead:{fb:'Lead',tt:'SubmitForm'}, TryOn:{fb:'CustomizeProduct',tt:'ClickButton'} };
  var MK={
    attr: attr,
    consent: function(){ try{ return localStorage.getItem('upc_consent')||'unset'; }catch(e){ return 'unset'; } },
    track: function(name, params){
      params=params||{};
      try{ dataLayer.push(Object.assign({event:name}, params)); }catch(e){}
      if((MK.consent())!=='granted') return;            // only hit ad/analytics pixels with consent
      var m=MAP[name];
      try{ if(window.gtag&&CFG.ga4) gtag('event', name, params); }catch(e){}
      try{ if(window.fbq) fbq('track', (m&&m.fb)||name, params); }catch(e){}
      try{ if(window.ttq) ttq.track((m&&m.tt)||name, params); }catch(e){}
    }
  };
  window.MK=MK;

  // ---------- boot ----------
  captureAttr();
  function start(){
    var c; try{ c=localStorage.getItem('upc_consent'); }catch(e){}
    if(c==='granted'){ grant(true); }            // returning, opted-in
    else if(c==='denied'){ /* stay denied */ }
    else { showBanner(); }                         // first visit
  }
  if(document.readyState!=='loading') start(); else document.addEventListener('DOMContentLoaded', start);
})();
