const accountConfig = window.FRENCHFERAL_CONFIG || {};
const accountClient = accountConfig.url && accountConfig.publishableKey && window.supabase
  ? window.supabase.createClient(accountConfig.url, accountConfig.publishableKey, {
      auth: { storageKey:"frenchferal.auth", flowType:"pkce" }
    })
  : null;

let accountUser = null;
let remoteProgress = null;
let accountReady = !accountClient;
let accountMessage = "";
let syncJob = null;
let accountEpoch = 0;
let accountMode = "signin";
let accountBusy = false;
let reauthDelete = false;

function cleanProgress(raw){
  const result = blank();
  const count = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1000000000) : 0;
  const isDay = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
  result.total = count(raw?.total);
  result.passed = Math.min(result.total, count(raw?.passed));
  result.streak = count(raw?.streak);
  result.lastDay = isDay(raw?.lastDay) ? raw.lastDay : null;
  for(const lesson of lessons){
    const id = lesson.id;
    if([1,2].includes(raw?.mastery?.[id])) result.mastery[id] = raw.mastery[id];
    if(typeof raw?.items?.[id]?.weak === "boolean") result.items[id] = {weak:raw.items[id].weak};
  }
  if(Number.isInteger(raw?.daily?.id) && lessons[raw.daily.id] && isDay(raw.daily.day)){
    result.daily = {id:raw.daily.id, day:raw.daily.day, complete:raw.daily.complete === true};
  }
  return result;
}

function mergeProgress(remote, before, after, importing=false){
  const merged = cleanProgress(remote);
  const increases = field => Math.max(0, after[field] - before[field]);
  if(importing){
    merged.total = Math.max(merged.total, after.total);
    merged.passed = Math.max(merged.passed, after.passed);
  }else{
    merged.total += increases("total");
    merged.passed += increases("passed");
  }
  for(const {id} of lessons){
    if(after.mastery[id]) merged.mastery[id] = Math.max(merged.mastery[id] || 0, after.mastery[id]);
    const local = after.items[id]?.weak;
    if(local !== undefined && (importing ? !merged.items[id] : local !== before.items[id]?.weak)){
      merged.items[id] = {weak:local};
    }
  }
  if(after.lastDay && (!merged.lastDay || after.lastDay >= merged.lastDay)){
    const previousDay = new Date(after.lastDay + "T12:00:00");
    previousDay.setDate(previousDay.getDate()-1);
    const continuing = merged.lastDay === day(previousDay);
    const sameDay = merged.lastDay === after.lastDay;
    merged.streak = Math.max(after.streak, continuing ? merged.streak + 1 : sameDay ? merged.streak : 0);
    merged.lastDay = after.lastDay;
  }
  if(after.daily && (!merged.daily || after.daily.day > merged.daily.day)){
    merged.daily = {...after.daily};
  }else if(after.daily?.day === merged.daily?.day && after.daily?.id === merged.daily?.id && after.daily?.complete){
    merged.daily.complete = true;
  }
  return cleanProgress(merged);
}

const columns = "revision,generation,progress,imported_guest";
async function checkedResult(query){
  const result = await query;
  if(result.error) throw result.error;
  return result.data;
}
function progressRow(user){
  return accountClient.from("learner_progress").select(columns).eq("user_id",user.id).maybeSingle();
}
async function loadProgress(user){
  const found = await checkedResult(progressRow(user));
  if(found)return found;
  return await checkedResult(accountClient.from("learner_progress").upsert({
    user_id:user.id,progress:blank()
  },{onConflict:"user_id",ignoreDuplicates:true}).select(columns).maybeSingle())
    || await checkedResult(progressRow(user));
}
function updateProgress(user, row, changes){
  return checkedResult(accountClient.from("learner_progress").update({...changes,revision:row.revision+1})
    .eq("user_id",user.id).eq("revision",row.revision).eq("generation",row.generation).select(columns).maybeSingle());
}
function accountViewChanged(){
  if(page==="account" || page==="progress")render();
}
async function useAccount(user){
  if(user?.id===accountUser?.id && accountReady)return;
  const epoch = ++accountEpoch;
  accountUser = user;
  accountReady = false;
  remoteProgress = null;
  setPracticeData(user ? blank() : guestProgress);
  if(!user){accountReady=true;accountViewChanged();return;}
  try{
    const row = await loadProgress(user);
    if(epoch!==accountEpoch)return;
    remoteProgress = row;
    setPracticeData(cleanProgress(row.progress));
    accountReady = true;
    accountMessage = "";
  }catch{
    if(epoch!==accountEpoch)return;
    accountMessage = "Couldn’t load your progress. Use Retry connection.";
  }
  if(epoch===accountEpoch){
    if(page==="practice")go("progress");
    else if(page==="today" || page==="lessons" || page==="review")render();
    else accountViewChanged();
  }
}

function queueProgress(){
  if(!accountReady || !remoteProgress || !accountUser || syncJob)return;
  const epoch=accountEpoch;
  const user=accountUser;
  syncJob=(async()=>{
    let base=cleanProgress(remoteProgress.progress);
    for(let attempt=0;attempt<6;attempt++){
      if(epoch!==accountEpoch)return;
      const snapshot=cleanProgress(data);
      if(JSON.stringify(snapshot)===JSON.stringify(base))return;
      const current=await checkedResult(progressRow(user));
      if(epoch!==accountEpoch)return;
      if(!current || current.generation!==remoteProgress.generation){
        if(current){remoteProgress=current;setPracticeData(cleanProgress(current.progress));}
        throw Error("Progress was reset elsewhere. Your dashboard has been refreshed.");
      }
      const next=mergeProgress(current.progress,base,snapshot);
      const written=await updateProgress(user,current,{progress:next});
      if(epoch!==accountEpoch)return;
      if(!written)continue;
      setPracticeData(mergeProgress(next,snapshot,cleanProgress(data)));
      remoteProgress=written;
      base=next;
    }
    throw Error("Progress is waiting to sync. Select Retry sync.");
  })().then(()=>{
    if(epoch===accountEpoch)accountMessage="";
  }).catch(error=>{
    if(epoch===accountEpoch)accountMessage=error instanceof Error?error.message:"Progress is waiting to sync. Select Retry sync.";
  }).finally(()=>{
    syncJob=null;
    if(epoch===accountEpoch)accountViewChanged();
  });
}

function accountPanel(){
  const status=accountMessage ? '<p role="status" class="feedback">'+escaped(accountMessage)+'</p>' : "";
  const button=(action,label)=>'<button class="button" type="button" data-account="'+action+'"'+(accountBusy?' disabled':'')+'>'+label+'</button>';
  if(!accountClient)return intro("Account","Guest practice works on this device. Account sync needs to be configured for this deployment.");
  if(!accountReady && accountUser)return intro("Account","Loading your dashboard…")+status+button("retry","Retry connection");
  if(accountUser && accountMode!=="recovery" && !reauthDelete){
    return intro("Account",escaped(accountUser.email || "FrenchFeral learner"))+status+
      '<div class="card"><h3>Progress & privacy</h3><p>Syncs progress totals, streak, and current mastery and review status across devices.</p><div class="actions">'+
      (guestProgress.total && !remoteProgress?.imported_guest ? button("import","Import practice from this browser"):"")+
      button("retry","Retry sync")+button("signout","Sign out")+button("reset","Reset progress")+button("delete","Delete account")+'</div></div>';
  }
  const recovery=accountMode==="recovery";
  const signup=accountMode==="signup";
  const forgot=accountMode==="forgot";
  const title=reauthDelete?"Confirm account deletion":recovery?"Change password":forgot?"Reset password":signup?"Create account":"Sign in";
  return intro(title,"Practice in French and carry your progress across devices.")+status+
    '<section class="card practice"><form data-form="account">'+
    (recovery||reauthDelete?'':'<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required>')+
    (forgot?'':'<label for="password">'+(recovery?'New password':'Password')+'</label><input id="password" name="password" type="password" minlength="'+(signup||recovery?8:1)+'" autocomplete="'+(signup||recovery?'new-password':'current-password')+'" required>')+
    '<div class="actions"><button class="button"'+(accountBusy?' disabled':'')+'>'+ (forgot?'Send reset link':title)+'</button></div></form>'+
    '<div class="actions">'+(reauthDelete?button("cancel-delete","Cancel"):recovery?'':button(signup||forgot?'signin':'signup',signup||forgot?'Back to sign in':'Create account')+(forgot?'':button("forgot","Forgot password?")))+'</div></section>';
}

async function submitAccount(form){
  if(accountBusy || !accountClient)return;
  const input = new FormData(form);
  const email = input.get("email");
  const password = input.get("password");
  const redirect = new URL(location.pathname,location.origin).href;
  accountBusy=true;
  try{
    if(reauthDelete && accountUser){
      await checkedResult(accountClient.auth.signInWithPassword({email:accountUser.email,password}));
      await checkedResult(accountClient.rpc("delete_learner_account"));
      reauthDelete=false;
      await accountClient.auth.signOut({scope:"local"});
      await useAccount(null);
      accountMessage="Account and synced progress deleted.";
    }else if(accountMode==="recovery"){
      await checkedResult(accountClient.auth.updateUser({password}));
      accountMode="signin";
      accountMessage="Password updated.";
    }else if(accountMode==="forgot"){
      await checkedResult(accountClient.auth.resetPasswordForEmail(email,{redirectTo:redirect}));
      accountMessage="If an account exists, check your email for a reset link.";
    }else if(accountMode==="signup"){
      const result=await checkedResult(accountClient.auth.signUp({email,password,options:{emailRedirectTo:redirect}}));
      if(result.session)await useAccount(result.user);
      else accountMessage="Check your email to confirm your account, then sign in.";
    }else{
      const result=await checkedResult(accountClient.auth.signInWithPassword({email,password}));
      await useAccount(result.user);
    }
  }catch(error){
    accountMessage=error.message || "Account request failed. Please try again.";
  }finally{
    accountBusy=false;
    accountViewChanged();
  }
}

async function accountAction(action){
  if(accountBusy || !accountClient)return;
  if(["signin","signup","forgot","cancel-delete","delete"].includes(action)){
    reauthDelete=action==="delete";
    accountMode=reauthDelete || action==="cancel-delete" ? "signin" : action;
    accountMessage=reauthDelete ? "Enter your password to permanently delete this account and its synced progress." : "";
    accountViewChanged();
    return;
  }
  if(!accountUser)return;
  const user=accountUser;
  const epoch=accountEpoch;
  if(action==="retry"){
    if(accountReady)queueProgress();else await useAccount(accountUser);
    return;
  }
  if(action==="reset" && !window.confirm("Reset all synced FrenchFeral progress?"))return;
  accountBusy=true;
  try{
    await syncJob;
    if(epoch!==accountEpoch)return;
    if(action==="signout"){
      if(JSON.stringify(cleanProgress(data))!==JSON.stringify(cleanProgress(remoteProgress.progress))){
        throw Error("Some progress is waiting to sync. Select Retry sync before signing out.");
      }
      await checkedResult(accountClient.auth.signOut({scope:"local"}));
      await useAccount(null);
    }else{
      const row=await checkedResult(progressRow(user));
      if(epoch!==accountEpoch)return;
      if(!row)throw Error("Couldn’t load your progress. Try reconnecting.");
      if(action==="import" && row.imported_guest)throw Error("Guest progress has already been imported into this account.");
      const changes=action==="import" ? {
        progress:mergeProgress(row.progress,blank(),cleanProgress(guestProgress),true),imported_guest:true
      } : {progress:blank(),generation:crypto.randomUUID()};
      const written=await updateProgress(user,row,changes);
      if(epoch!==accountEpoch)return;
      if(!written)throw Error("Progress changed on another device. Try again.");
      if(action==="import"){
        guestProgress=blank();
        saveGuestProgress();
      }
      remoteProgress=written;setPracticeData(cleanProgress(written.progress));
      accountMessage=action==="import"?"Guest progress imported.":"Progress reset.";
    }
  }catch(error){accountMessage=error.message || "Account request failed. Please try again.";}
  finally{accountBusy=false;accountViewChanged();}
}
function initializeAccount(){
  if(!accountClient)return;
  accountClient.auth.onAuthStateChange((event,authSession)=>{
    if(event==="PASSWORD_RECOVERY"){accountMode="recovery";page="account";}
    if(event==="INITIAL_SESSION" || event==="SIGNED_OUT" || event==="SIGNED_IN" || event==="PASSWORD_RECOVERY"){
      setTimeout(()=>useAccount(authSession?.user ?? null),0);
    }
  });
}
