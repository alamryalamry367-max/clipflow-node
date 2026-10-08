export function signupReferralOptions(){
 let code=new URLSearchParams(location.search).get('ref');
 try{code=code||localStorage.getItem('vooxor_referral_code')}catch{}
 return {data: /^[A-Za-z0-9]{8}$/.test(code||'')?{vooxor_referral_code:code.toUpperCase()}: {}};
}
export async function settleReferral(client){
 try{const {error}=await client.rpc('complete_vooxor_referral');if(error)console.warn('VOOXOR referral:',error.message);}catch(error){console.warn('VOOXOR referral:',error.message)}
}
