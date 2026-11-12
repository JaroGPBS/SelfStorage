// Compatibility only: accounts created in the removed test mode may still
// exist in D1. The Admin delete action uses this to clean their old records.
// New users are normal users; mobile operations never use test tables.
export async function isFrTestAccount(db,userId){
  const exists=await db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='fr_test_accounts'"
  ).first();
  if(!exists)return false;
  return Boolean(await db.prepare(
    'SELECT 1 FROM fr_test_accounts WHERE user_id=?'
  ).bind(userId).first());
}
