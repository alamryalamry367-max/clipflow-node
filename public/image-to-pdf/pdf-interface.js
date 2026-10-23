/* UI only; balances and PDF rewards remain controlled by Supabase. */
(() => {
 const notice=document.getElementById('rewardNotice'),referral=document.getElementById('vxPdfReferralLink');
 async function action(share){
  if(!referral.dataset.url){const box=document.getElementById('vxPdfAuthBox');box.style.display='block';box.scrollIntoView({behavior:'smooth',block:'center'});document.getElementById('vxPdfEmail').focus();return;}
  try{if(share&&navigator.share)await navigator.share({title:'VOOXOR Rewards',text:'انضم إلى VOOXOR Rewards من رابط دعوتي',url:referral.dataset.url});else if(navigator.clipboard){await navigator.clipboard.writeText(referral.dataset.url);notice.textContent='تم نسخ رابط الإحالة';}else notice.textContent=referral.dataset.url;}
  catch(e){if(e.name!=='AbortError')notice.textContent='تعذر النسخ أو المشاركة. يمكنك نسخ الرابط من الحقل.';}
 }
 document.getElementById('vxPdfReferralCopy').addEventListener('click',()=>action(false));
 document.getElementById('vxPdfReferralShare').addEventListener('click',()=>action(true));
 // Advertising is disabled.
 const drop=document.getElementById('dropZone');
 ['dragenter','dragover'].forEach(t=>drop.addEventListener(t,()=>drop.classList.add('dragOver')));
 ['dragleave','drop'].forEach(t=>drop.addEventListener(t,()=>drop.classList.remove('dragOver')));
 const grid=document.getElementById('files');let count=0;
 new MutationObserver(()=>{const next=grid.children.length;if(!count&&next)document.getElementById('workspace').scrollIntoView({behavior:'smooth',block:'start'});count=next;}).observe(grid,{childList:true});
})();
