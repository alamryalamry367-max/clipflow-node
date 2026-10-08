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
function message(text){status.textContent=text;if(el('homeInstallFeedback'))el('homeInstallFeedback').textContent=text;el('homeRewardRetry').hidden=!(pending().install_app&&text.startsWith('تعذر'));}
function showAuth(){auth.hidden=false;el('homeEmail').focus();auth.scrollIntoView({block:'nearest',behavior:'smooth'});}
function renderHomeLevel(value){
 const box=el('homeLevel');box.hidden=value==null;if(value==null)return;
 const total=Math.max(0,Number(value)||0),levels=[['🌱 مبتدئ',0],['🥉 برونزي',100],['🥈 فضي',500],['🥇 ذهبي',1500],['👑 نخبة',5000]];
 let n=0;while(n+1<levels.length&&total>=levels[n+1][1])n++;
 const next=levels[n+1],percent=next?Math.min(100,Math.floor((total-levels[n][1])/(next[1]-levels[n][1])*100)):100;
 el('homeLevelName').textContent=levels[n][0];
 const hint=next?'باقي '+(next[1]-total)+' VX إلى '+next[0]:'أعلى مستوى';
 el('homeLevelHint').textContent=hint;el('homeLevelFill').style.width=percent+'%';el('homeLevelBar').setAttribute('aria-valuenow',String(percent));el('homeLevelBar').setAttribute('aria-valuetext',hint);
}
async function refresh(session){
 renderHomeLevel(null);
 currentSession=session;const token=++version;referral='';balance.textContent='— VX';el('homeReferralLink').textContent='سجّل الدخول لعرض رابطك';el('homeLogout').hidden=!session?.user;
 if(!session?.user)return;
 try{
  await settleReferral(client);
  const {data,error}=await client.from('vooxor_profiles').select('vx_balance,lifetime_vx,referral_code').eq('user_id',session.user.id).maybeSingle();
  if(token!==version)return;if(error)throw error;if(!data)throw new Error('لم يتم العثور على حساب المكافآت.');
  balance.textContent=(data.vx_balance??0)+' VX';
  renderHomeLevel(data.lifetime_vx??0);
  if(data.referral_code){referral='https://vooxor.com/ar/?ref='+encodeURIComponent(data.referral_code);el('homeReferralLink').textContent=referral;}else el('homeReferralLink').textContent='رابط الإحالة غير متاح لحسابك';
  auth.hidden=true;
 }catch(error){if(token===version){balance.textContent='تعذر تحميل الرصيد';message('تعذر تحميل الحساب: '+error.message)}}
}
let installRequest=null;
async function claim(type){
 try{
  const {data:{session},error:sessionError}=await client.auth.getSession();if(sessionError)throw sessionError;
  if(!session){showAuth();message('سجّل الدخول لإضافة المكافأة إلى رصيدك.');return;}
  const {data,error}=await client.rpc('claim_vooxor_reward',{p_reward_type:type});
  if(error){if(/Reward already claimed/i.test(error.message||'')){if(type==='install_app')setPending(false);await refresh(session);message('تم استلام هذه المكافأة سابقًا.');return;}throw error;}
  if(type==='install_app')setPending(false);
  const {data:{session:latest}}=await client.auth.getSession();
  if(latest?.user?.id===session.user.id){await refresh(latest);if(Number.isInteger(data))balance.textContent=data+' VX';message('تمت إضافة +'+(type==='install_app'?10:4)+' VX إلى رصيدك.');}
 }catch(error){message('تعذر إضافة المكافأة: '+(error.message||'تحقق من الاتصال وأعد المحاولة.'));}
}
async function claimInstall(){if(installRequest)return installRequest;installRequest=claim('install_app');try{await installRequest}finally{installRequest=null}}
async function flush(){if(currentSession?.user&&pending().install_app)await claimInstall();}
el('homeAccountBtn').addEventListener('click',()=>{if(currentSession?.user)location.href='/rewards/';else showAuth();});
el('homeAuthClose').addEventListener('click',()=>{auth.hidden=true});
el('homeLogout').addEventListener('click',async()=>{try{const {error}=await client.auth.signOut();if(error)throw error;await refresh(null);auth.hidden=true;message('تم تسجيل الخروج.')}catch(e){message('تعذر تسجيل الخروج: '+e.message)}});
async function authenticate(signup){
 const email=el('homeEmail'),password=el('homePassword');if(!email.checkValidity()||password.value.length<6){el('homeAuthStatus').textContent='أدخل بريدًا صحيحًا وكلمة مرور من 6 أحرف على الأقل.';return;}
 const buttons=auth.querySelectorAll('.homeAuthActions button');buttons.forEach(b=>b.disabled=true);el('homeAuthStatus').textContent='جاري تسجيل الدخول...';
 try{
  const method=signup?'signUp':'signInWithPassword';const {data,error}=await client.auth[method]({email:email.value.trim(),password:password.value,...(signup?{options:signupReferralOptions()}:{})});if(error)throw error;
  if(data.session){password.value='';await refresh(data.session);await flush();el('homeAuthStatus').textContent='تم تسجيل الدخول.';}else el('homeAuthStatus').textContent='تحقق من بريدك لتأكيد الحساب ثم سجّل الدخول.';
 }catch(error){el('homeAuthStatus').textContent=error.message||'تعذر تسجيل الدخول.'}finally{buttons.forEach(b=>b.disabled=false)}
}
el('homeLoginForm').addEventListener('submit',e=>{e.preventDefault();void authenticate(false)});
el('homeSignup').addEventListener('click',()=>void authenticate(true));
async function copyReferral(){if(!referral){showAuth();message('سجّل الدخول لعرض رابط الإحالة.');return;}try{await navigator.clipboard.writeText(referral);message('تم نسخ رابط الإحالة.')}catch{el('homeReferralLink').textContent=referral;message('انسخ رابطك الظاهر يدويًا.')}}
el('homeReferralCopy').addEventListener('click',()=>void copyReferral());
el('homeReferralShare').addEventListener('click',async()=>{if(!referral){showAuth();return;}try{if(navigator.share)await navigator.share({title:'VOOXOR',text:'جرّب أدوات VOOXOR وانضم إلى عائلة المكافآت.',url:referral});else await copyReferral();}catch(e){if(e.name!=='AbortError')message('تعذر فتح المشاركة؛ يمكنك نسخ الرابط.')}});
function adURL(){
 const url=new URL('https://spendsdetachment.com/qpad1xzw4');const params={key:'e6542ff4b88b27acc240eedbf8d07660',scrWidth:screen.width,scrHeight:screen.height,tz:-new Date().getTimezoneOffset()/60,ship:1,v:'2026.10.6_9153',refer:location.href,kw:'[]',sub3:'invoke_layer',ifid:crypto.randomUUID?.()||String(Date.now()),ibid:'01a117da-7d9e-7482-87cf-7600af955012'};Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));return url.href;
}
el('homeAdOpen').addEventListener('click',()=>{
 const url=adURL();const popup=window.open(url,'_blank');if(popup){try{popup.opener=null}catch{}}
 // Each deliberate button click receives +4 VX, using the existing server RPC.
 adQueue=adQueue.then(()=>claim('watch_ad')).then(()=>{if(!popup){const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=' اضغط هنا لفتح الإعلان';status.append(link);}}).catch(e=>message('تعذر إضافة المكافأة: '+e.message));
});
const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
let homeInstallPrompt=null;
const installEvidence='vooxor.installAccepted.v1';
function rememberInstall(){try{localStorage.setItem(installEvidence,'1')}catch{}setPending(true);void claimInstall();}
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();homeInstallPrompt=event});
window.addEventListener('appinstalled',()=>{homeInstallPrompt=null;rememberInstall()});
const feedback=document.createElement('p');feedback.id='homeInstallFeedback';feedback.className='homeInstallFeedback';feedback.setAttribute('role','status');document.querySelector('.homeInstall').append(feedback);
document.querySelectorAll('[data-vr-install],[data-ig-install]').forEach(button=>button.addEventListener('click',async event=>{
 event.preventDefault();event.stopImmediatePropagation();
 if(standalone()){rememberInstall();return;}
 if(homeInstallPrompt){
  const prompt=homeInstallPrompt;homeInstallPrompt=null;
  try{await prompt.prompt();const choice=await prompt.userChoice;if(choice.outcome==='accepted'){rememberInstall()}else message('تم إلغاء التثبيت؛ لم تُطلب مكافأة.');}
  catch(error){message('تعذر فتح التثبيت: '+error.message)}
  return;
 }
 let accepted=false;try{accepted=localStorage.getItem(installEvidence)==='1'}catch{}
 if(accepted){setPending(true);await claimInstall();return;}
 message('افتح الموقع في Chrome واختر تثبيت التطبيق من قائمته، ثم افتح VOOXOR من أيقونته لإضافة +10 VX. إذا استلمتها سابقًا فلن تتكرر.');
},true));
el('homeRewardRetry').addEventListener('click',()=>void flush());
try{
 const code=new URL(location.href).searchParams.get('ref');if(code&&/^[A-Za-z0-9]{8}$/.test(code))localStorage.setItem('vooxor_referral_code',code);
 if(standalone())setPending(true);
 const {data:{session},error}=await client.auth.getSession();if(error)throw error;await refresh(session);await flush();
 client.auth.onAuthStateChange((_event,session)=>{setTimeout(async()=>{await refresh(session);await flush()},0)});
}catch(error){message('تعذر تحميل الحساب: '+error.message);}

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
  message('تعذر إضافة مكافأة المنصة: '+(error.message||'تحقق من الاتصال.'));
  const next=document.createElement('a');next.href=target;next.textContent=' متابعة إلى المنصة';status.append(next);status.scrollIntoView({block:'center',behavior:'smooth'});
 }finally{link.removeAttribute('aria-busy')}
}));

const spotlightMenu=document.querySelector('.ig-menu');const spotlightNav=document.getElementById('ig-nav');spotlightMenu?.addEventListener('click',()=>{spotlightNav.hidden=!spotlightNav.hidden;spotlightMenu.setAttribute('aria-expanded',String(!spotlightNav.hidden));});
