// Backfill humane usernames + displayNames for users whose existing username
// was derived from the Privy DID. Targets the pattern
//   /^didprivy[a-z0-9]+$/i  AND  email is present
// — i.e. people who would have had a perfectly good email-derived username
// if the auth middleware bug had been fixed earlier.
//
// Idempotent. Skips users with email already in use elsewhere to avoid the
// 11000 unique-index collision.
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const PRIVY_PATTERN = /^did?privy/i;

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db(process.env.MONGODB_DB ?? 'bonfire');
const col = db.collection('users');

const candidates = await col
  .find({ username: { $regex: PRIVY_PATTERN } })
  .toArray();

console.log(`found ${candidates.length} user(s) with privy-DID-style usernames\n`);

let fixed = 0, skipped = 0;
for (const u of candidates) {
  const emailLocal = (u.email ?? '').split('@')[0]?.trim().toLowerCase() ?? '';
  if (!emailLocal) {
    console.log(`  skip ${u._id.toHexString()}  no email`);
    skipped++;
    continue;
  }
  const newUsername = emailLocal.replace(/[^a-z0-9._-]/g, '').slice(0, 32);
  if (!newUsername) {
    console.log(`  skip ${u._id.toHexString()}  email yields empty username`);
    skipped++;
    continue;
  }
  // Check collision against unique index
  const clash = await col.findOne({ username: newUsername, _id: { $ne: u._id } });
  if (clash) {
    console.log(`  skip ${u._id.toHexString()}  username '${newUsername}' already in use by ${clash._id.toHexString()}`);
    skipped++;
    continue;
  }
  await col.updateOne(
    { _id: u._id },
    { $set: { username: newUsername, displayName: emailLocal, updatedAt: new Date() } },
  );
  console.log(`  ✓ ${u.username.padEnd(40)} → ${newUsername}`);
  fixed++;
}

console.log(`\nfixed=${fixed} skipped=${skipped} of ${candidates.length}`);
await c.close();
