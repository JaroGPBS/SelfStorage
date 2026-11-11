import {handleFrenchMobile} from '../lib/fr-mobile-d1.js';

// French action API now runs on Cloudflare D1 only.
export async function onRequestPost({request,env}) {return handleFrenchMobile(request,env);}
export function onRequestGet(){return Response.json({ok:true,service:'GPBS Storage FR D1 API',apiVersion:6});}
