// Read existing recipient settings without Microsoft authorization or tokens.
import {verifyWorkerSession,workerJson} from '../../lib/pl-worker-auth.js';
import {verifyRememberSession} from '../../lib/pl-office-remember.js';
import {ownerContext} from '../../lib/super-admin-security.js';
import {readDocumentRecipients} from '../../lib/belleville-document-mail-settings.js';
export async function onRequestGet({request,env}){
 try{
  const user=await verifyWorkerSession(request,env)||await verifyRememberSession(request,env);
  if(!user?.apps?.office||!user.markets?.FR||user.role!=='ADMIN')return workerJson({ok:false,error:'Brak uprawnień.'},403);
  const owner=await ownerContext(env);
  if(!owner||owner.owner.id!==user.id)return workerJson({ok:false,error:'Brak uprawnień.'},403);
  return workerJson({ok:true,recipients:await readDocumentRecipients(env.DB)});
 }catch(e){return workerJson({ok:false,error:'Nie udało się pobrać odbiorców.'},503);}
}
