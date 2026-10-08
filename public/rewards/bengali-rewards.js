import {signupReferralOptions,settleReferral} from '/rewards/referral-client.js?v=referral50';
/* VOOXOR Arabic homepage. Existing downloader and installation handlers remain intact. */
import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const client=createClient('https://eiyvhdgcsgawxdphtvqx.supabase.co','sb_publishable__hZCyLkEo_zc4absaCd2Kg_EDEWel_N');
const el=id=>document.getElementById(id);
const auth=el('homeAuth'),status=el('homeRewardStatus'),balance=el('homeBalance');
let currentSession=null,referral='',version=0,adQueue=Promise.resolve();
const pendingKey='vooxor.pendingRewards.v1';
const pending=()=>{try{return JSON.parse(sessionStorage.getItem(pendingKey)||'{}')}catch{return {}}};
function setPending(on){const p=pending();if(on)p.install_app=true;else delete p.install_app;try{sessionStorage.setItem(pendingKey,JSON.stringify(p))}catch{}}
function message(text){status.textContent=text;if(el('homeInstallFeedback'))el('homeInstallFeedback').textContent=text;el('homeRewardRetry').hidden=!(pending().install_app&&text.startsWith('করা যায়নি'));}
function showAuth(){auth.hidden=false;el('homeEmail').focus();auth.scrollIntoView({block:'nearest',behavior:'smooth'});}
function renderHomeLevel(value){
 const box=el('homeLevel');box.hidden=value==null;if(value==null)return;
 const total=Math.max(0,Number(value)||0),levels=[['🌱 নতুন',0],['🥉 ব্রোঞ্জ',100],['🥈 সিলভার',500],['🥇 গোল্ড',1500],['👑 এলিট',5000]];
 let n=0;while(n+1<levels.length&&total>=levels[n+1][1])n++;
 const next=levels[n+1],percent=next?Math.min(100,Math.floor((total-levels[n][1])/(next[1]-levels[n][1])*100)):100;
 el('homeLevelName').textContent=levels[n][0];
 const hint=next?'বাকি '+(next[1]-total)+' VX পর্যন্ত '+next[0]:'সর্বোচ্চ স্তর';
 el('homeLevelHint').textContent=hint;el('homeLevelFill').style.width=percent+'%';el('homeLevelBar').setAttribute('aria-valuenow',String(percent));el('homeLevelBar').setAttribute('aria-valuetext',hint);
}
async function refresh(session){
 renderHomeLevel(null);
 currentSession=session;const token=++version;referral='';balance.textContent='— VX';el('homeReferralLink').textContent='আপনার লিংক দেখতে লগ ইন করুন';el('homeLogout').hidden=!session?.user;
 if(!session?.user)return;
 try{
  await settleReferral(client);
  const {data,error}=await client.from('vooxor_profiles').select('vx_balance,lifetime_vx,referral_code').eq('user_id',session.user.id).maybeSingle();
  if(token!==version)return;if(error)throw error;if(!data)throw new Error('পুরস্কারের অ্যাকাউন্ট পাওয়া যায়নি।');
  balance.textContent=(data.vx_balance??0)+' VX';
  renderHomeLevel(data.lifetime_vx??0);
  if(data.referral_code){referral='https://vooxor.com/bd/tiktok-video-downloader/?ref='+encodeURIComponent(data.referral_code);el('homeReferralLink').textContent=referral;}else el('homeReferralLink').textContent='আপনার আমন্ত্রণের লিংক পাওয়া যাচ্ছে না';
  auth.hidden=true;
 }catch(error){if(token===version){balance.textContent='ব্যালেন্স লোড করা যায়নি';message('অ্যাকাউন্ট লোড করা যায়নি: '+error.message)}}
}
let installRequest=null;
async function claim(type){
 try{
  const {data:{session},error:sessionError}=await client.auth.getSession();if(sessionError)throw sessionError;
  if(!session){showAuth();message('ব্যালেন্সে পুরস্কার যোগ করতে লগ ইন করুন।');return;}
  const {data,error}=await client.rpc('claim_vooxor_reward',{p_reward_type:type});
  if(error){if(/Reward already claimed/i.test(error.message||'')){if(type==='install_app')setPending(false);await refresh(session);message('এই পুরস্কার আগেই নেওয়া হয়েছে।');return;}throw error;}
  if(type==='install_app')setPending(false);
  const {data:{session:latest}}=await client.auth.getSession();
  if(latest?.user?.id===session.user.id){await refresh(latest);if(Number.isInteger(data))balance.textContent=data+' VX';message('আপনার ব্যালেন্সে +'+(type==='install_app'?10:4)+' VX যোগ হয়েছে।');}
 }catch(error){message('পুরস্কার যোগ করা যায়নি: '+(error.message||'সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।'));}
}
async function claimInstall(){if(installRequest)return installRequest;installRequest=claim('install_app');try{await installRequest}finally{installRequest=null}}
async function flush(){if(currentSession?.user&&pending().install_app)await claimInstall();}
el('homeAccountBtn').addEventListener('click',()=>{if(currentSession?.user)location.href='/rewards/';else showAuth();});
el('homeAuthClose').addEventListener('click',()=>{auth.hidden=true});
el('homeLogout').addEventListener('click',async()=>{try{const {error}=await client.auth.signOut();if(error)throw error;await refresh(null);auth.hidden=true;message('লগ আউট হয়েছে।')}catch(e){message('লগ আউট করা যায়নি: '+e.message)}});
async function authenticate(signup){
 const email=el('homeEmail'),password=el('homePassword');if(!email.checkValidity()||password.value.length<6){el('homeAuthStatus').textContent='সঠিক ইমেইল ও অন্তত 6 অক্ষরের পাসওয়ার্ড লিখুন।';return;}
 const buttons=auth.querySelectorAll('.homeAuthActions button');buttons.forEach(b=>b.disabled=true);el('homeAuthStatus').textContent='লগ ইন হচ্ছে...';
 try{
  const method=signup?'signUp':'signInWithPassword';const {data,error}=await client.auth[method]({email:email.value.trim(),password:password.value,...(signup?{options:signupReferralOptions()}:{})});if(error)throw error;
  if(data.session){password.value='';await refresh(data.session);await flush();el('homeAuthStatus').textContent='লগ ইন হয়েছে।';}else el('homeAuthStatus').textContent='অ্যাকাউন্ট নিশ্চিত করতে ইমেইল দেখুন, তারপর লগ ইন করুন।';
 }catch(error){el('homeAuthStatus').textContent=error.message||'লগ ইন করা যায়নি।'}finally{buttons.forEach(b=>b.disabled=false)}
}
el('homeLoginForm').addEventListener('submit',e=>{e.preventDefault();void authenticate(false)});
el('homeSignup').addEventListener('click',()=>void authenticate(true));
async function copyReferral(){if(!referral){showAuth();message('আমন্ত্রণের লিংক দেখতে লগ ইন করুন।');return;}try{await navigator.clipboard.writeText(referral);message('আমন্ত্রণের লিংক কপি হয়েছে।')}catch{el('homeReferralLink').textContent=referral;message('দেখানো লিংকটি নিজে কপি করুন।')}}
el('homeReferralCopy').addEventListener('click',()=>void copyReferral());
el('homeReferralShare').addEventListener('click',async()=>{if(!referral){showAuth();return;}try{if(navigator.share)await navigator.share({title:'VOOXOR',text:'VOOXOR টুল ব্যবহার করে পুরস্কার সংগ্রহ করুন।',url:referral});else await copyReferral();}catch(e){if(e.name!=='AbortError')message('শেয়ার করা যায়নি; লিংকটি কপি করতে পারেন।')}});
function adURL(){
 const url=new URL('https://spendsdetachment.com/qpad1xzw4');const params={key:'e6542ff4b88b27acc240eedbf8d07660',scrWidth:screen.width,scrHeight:screen.height,tz:-new Date().getTimezoneOffset()/60,ship:1,v:'2026.10.6_9153',refer:location.href,kw:'[]',sub3:'invoke_layer',ifid:crypto.randomUUID?.()||String(Date.now()),ibid:'01a117da-7d9e-7482-87cf-7600af955012'};Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));return url.href;
}
el('homeAdOpen').addEventListener('click',()=>{
 const url=adURL();const popup=window.open(url,'_blank');if(popup){try{popup.opener=null}catch{}}
 // Each deliberate button click receives +4 VX, using the existing server RPC.
 adQueue=adQueue.then(()=>claim('watch_ad')).then(()=>{if(!popup){const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=' বিজ্ঞাপন খুলতে এখানে চাপুন';status.append(link);}}).catch(e=>message('পুরস্কার যোগ করা যায়নি: '+e.message));
});
const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
let homeInstallPrompt=null;
const installEvidence='vooxor.installAccepted.v1';
function rememberInstall(){try{localStorage.setItem(installEvidence,'1')}catch{}setPending(true);void claimInstall();}
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();homeInstallPrompt=event});
window.addEventListener('appinstalled',()=>{homeInstallPrompt=null;rememberInstall()});
const feedback=document.createElement('p');feedback.id='homeInstallFeedback';feedback.className='homeInstallFeedback';feedback.setAttribute('role','status');document.querySelector('.homeInstall').append(feedback);
document.querySelectorAll('[data-vr-install],[data-vu-install]').forEach(button=>button.addEventListener('click',async event=>{
 event.preventDefault();event.stopImmediatePropagation();
 if(standalone()){rememberInstall();return;}
 if(homeInstallPrompt){
  const prompt=homeInstallPrompt;homeInstallPrompt=null;
  try{await prompt.prompt();const choice=await prompt.userChoice;if(choice.outcome==='accepted'){rememberInstall()}else message('ইনস্টল বাতিল হয়েছে; পুরস্কারের অনুরোধ করা হয়নি।');}
  catch(error){message('ইনস্টল খোলা যায়নি: '+error.message)}
  return;
 }
 let accepted=false;try{accepted=localStorage.getItem(installEvidence)==='1'}catch{}
 if(accepted){setPending(true);await claimInstall();return;}
 message('Chrome-এ সাইট খুলে মেনু থেকে অ্যাপ ইনস্টল করুন। তারপর VOOXOR আইকন দিয়ে অ্যাপ খুলে +10 VX পান। এই পুরস্কার একবারই পাওয়া যায়।');
},true));
el('homeRewardRetry').addEventListener('click',()=>void flush());
try{
 const code=new URL(location.href).searchParams.get('ref');if(code&&/^[A-Za-z0-9]{8}$/.test(code))localStorage.setItem('vooxor_referral_code',code);
 if(standalone())setPending(true);
 const {data:{session},error}=await client.auth.getSession();if(error)throw error;await refresh(session);await flush();
 client.auth.onAuthStateChange((_event,session)=>{setTimeout(async()=>{await refresh(session);await flush()},0)});
}catch(error){message('অ্যাকাউন্ট লোড করা যায়নি: '+error.message);}

// Existing watch_ad credit logic, guarded daily per platform by the server.
document.querySelectorAll('.vr-platform').forEach(link=>link.addEventListener('click',async event=>{
 if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button!==0)return;
 event.preventDefault();if(link.getAttribute('aria-busy')==='true')return;
 link.setAttribute('aria-busy','true');
 const target=link.getAttribute('href'),platform=target.split('/')[1].replace('-video-downloader','');
 try{
  const {data:{session},error:sessionError}=await client.auth.getSession();if(sessionError)throw sessionError;
  if(session){
   const {data,error}=await client.rpc('claim_vooxor_reward',{p_reward_type:'watch_ad',p_platform:platform});
   if(error)throw error;
   if(Number.isInteger(data))balance.textContent=data+' VX';
  }
  location.assign(target);
 }catch(error){
  message('প্ল্যাটফর্মের পুরস্কার যোগ করা যায়নি: '+(error.message||'সংযোগ পরীক্ষা করুন।'));
  const next=document.createElement('a');next.href=target;next.textContent=' প্ল্যাটফর্মে যান';status.append(next);status.scrollIntoView({block:'center',behavior:'smooth'});
 }finally{link.removeAttribute('aria-busy')}
}));
