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
function message(text){status.textContent=text;if(el('homeInstallFeedback'))el('homeInstallFeedback').textContent=text;el('homeRewardRetry').hidden=!(pending().install_app&&text.startsWith('Gagal'));}
function showAuth(){auth.hidden=false;el('homeEmail').focus();auth.scrollIntoView({block:'nearest',behavior:'smooth'});}
function renderHomeLevel(value){
 const box=el('homeLevel');box.hidden=value==null;if(value==null)return;
 const total=Math.max(0,Number(value)||0),levels=[['🌱 Pemula',0],['🥉 Perunggu',100],['🥈 Perak',500],['🥇 Emas',1500],['👑 Elite',5000]];
 let n=0;while(n+1<levels.length&&total>=levels[n+1][1])n++;
 const next=levels[n+1],percent=next?Math.min(100,Math.floor((total-levels[n][1])/(next[1]-levels[n][1])*100)):100;
 el('homeLevelName').textContent=levels[n][0];
 const hint=next?'Sisa '+(next[1]-total)+' VX menuju '+next[0]:'Level tertinggi';
 el('homeLevelHint').textContent=hint;el('homeLevelFill').style.width=percent+'%';el('homeLevelBar').setAttribute('aria-valuenow',String(percent));el('homeLevelBar').setAttribute('aria-valuetext',hint);
}
async function refresh(session){
 renderHomeLevel(null);
 currentSession=session;const token=++version;referral='';balance.textContent='— VX';el('homeReferralLink').textContent='Masuk untuk melihat tautan Anda';el('homeLogout').hidden=!session?.user;
 if(!session?.user)return;
 try{
  await settleReferral(client);
  const {data,error}=await client.from('vooxor_profiles').select('vx_balance,lifetime_vx,referral_code').eq('user_id',session.user.id).maybeSingle();
  if(token!==version)return;if(error)throw error;if(!data)throw new Error('Akun hadiah tidak ditemukan.');
  balance.textContent=(data.vx_balance??0)+' VX';
  renderHomeLevel(data.lifetime_vx??0);
  if(data.referral_code){referral='https://vooxor.com/id/tiktok-video-downloader/?ref='+encodeURIComponent(data.referral_code);el('homeReferralLink').textContent=referral;}else el('homeReferralLink').textContent='Tautan undangan belum tersedia';
  auth.hidden=true;
 }catch(error){if(token===version){balance.textContent='Saldo gagal dimuat';message('Gagal memuat akun: '+error.message)}}
}
let installRequest=null;
async function claim(type){
 try{
  const {data:{session},error:sessionError}=await client.auth.getSession();if(sessionError)throw sessionError;
  if(!session){showAuth();message('Masuk untuk menambahkan hadiah ke saldo Anda.');return;}
  const {data,error}=await client.rpc('claim_vooxor_reward',{p_reward_type:type});
  if(error){if(/Reward already claimed/i.test(error.message||'')){if(type==='install_app')setPending(false);await refresh(session);message('Hadiah ini sudah diterima sebelumnya.');return;}throw error;}
  if(type==='install_app')setPending(false);
  const {data:{session:latest}}=await client.auth.getSession();
  if(latest?.user?.id===session.user.id){await refresh(latest);if(Number.isInteger(data))balance.textContent=data+' VX';message('Saldo Anda bertambah +'+(type==='install_app'?10:4)+' VX.');}
 }catch(error){message('Gagal menambahkan hadiah: '+(error.message||'Periksa koneksi dan coba lagi.'));}
}
async function claimInstall(){if(installRequest)return installRequest;installRequest=claim('install_app');try{await installRequest}finally{installRequest=null}}
async function flush(){if(currentSession?.user&&pending().install_app)await claimInstall();}
el('homeAccountBtn').addEventListener('click',()=>{if(currentSession?.user)location.href='/rewards/';else showAuth();});
el('homeAuthClose').addEventListener('click',()=>{auth.hidden=true});
el('homeLogout').addEventListener('click',async()=>{try{const {error}=await client.auth.signOut();if(error)throw error;await refresh(null);auth.hidden=true;message('Anda telah keluar.')}catch(e){message('Gagal keluar: '+e.message)}});
async function authenticate(signup){
 const email=el('homeEmail'),password=el('homePassword');if(!email.checkValidity()||password.value.length<6){el('homeAuthStatus').textContent='Masukkan email yang valid dan kata sandi minimal 6 karakter.';return;}
 const buttons=auth.querySelectorAll('.homeAuthActions button');buttons.forEach(b=>b.disabled=true);el('homeAuthStatus').textContent='Sedang masuk...';
 try{
  const method=signup?'signUp':'signInWithPassword';const {data,error}=await client.auth[method]({email:email.value.trim(),password:password.value,...(signup?{options:signupReferralOptions()}:{})});if(error)throw error;
  if(data.session){password.value='';await refresh(data.session);await flush();el('homeAuthStatus').textContent='Berhasil masuk.';}else el('homeAuthStatus').textContent='Periksa email untuk mengonfirmasi akun, lalu masuk.';
 }catch(error){el('homeAuthStatus').textContent=error.message||'Gagal masuk.'}finally{buttons.forEach(b=>b.disabled=false)}
}
el('homeLoginForm').addEventListener('submit',e=>{e.preventDefault();void authenticate(false)});
el('homeSignup').addEventListener('click',()=>void authenticate(true));
async function copyReferral(){if(!referral){showAuth();message('Masuk untuk melihat tautan undangan.');return;}try{await navigator.clipboard.writeText(referral);message('Tautan undangan berhasil disalin.')}catch{el('homeReferralLink').textContent=referral;message('Salin tautan yang ditampilkan secara manual.')}}
el('homeReferralCopy').addEventListener('click',()=>void copyReferral());
el('homeReferralShare').addEventListener('click',async()=>{if(!referral){showAuth();return;}try{if(navigator.share)await navigator.share({title:'VOOXOR',text:'Coba alat VOOXOR dan kumpulkan hadiah.',url:referral});else await copyReferral();}catch(e){if(e.name!=='AbortError')message('Gagal membuka menu berbagi; Anda dapat menyalin tautan.')}});
// Advertising is disabled. Other rewards remain available.
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
  try{await prompt.prompt();const choice=await prompt.userChoice;if(choice.outcome==='accepted'){rememberInstall()}else message('Instalasi dibatalkan; hadiah tidak diminta.');}
  catch(error){message('Gagal membuka instalasi: '+error.message)}
  return;
 }
 let accepted=false;try{accepted=localStorage.getItem(installEvidence)==='1'}catch{}
 if(accepted){setPending(true);await claimInstall();return;}
 message('Buka situs di Chrome dan pilih Instal aplikasi dari menu. Lalu buka VOOXOR melalui ikonnya untuk mendapatkan +10 VX. Hadiah ini hanya diberikan sekali.');
},true));
el('homeRewardRetry').addEventListener('click',()=>void flush());
try{
 const code=new URL(location.href).searchParams.get('ref');if(code&&/^[A-Za-z0-9]{8}$/.test(code))localStorage.setItem('vooxor_referral_code',code);
 if(standalone())setPending(true);
 const {data:{session},error}=await client.auth.getSession();if(error)throw error;await refresh(session);await flush();
 client.auth.onAuthStateChange((_event,session)=>{setTimeout(async()=>{await refresh(session);await flush()},0)});
}catch(error){message('Gagal memuat akun: '+error.message);}

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
  message('Gagal menambahkan hadiah platform: '+(error.message||'Periksa koneksi.'));
  const next=document.createElement('a');next.href=target;next.textContent=' Lanjutkan ke platform';status.append(next);status.scrollIntoView({block:'center',behavior:'smooth'});
 }finally{link.removeAttribute('aria-busy')}
}));
