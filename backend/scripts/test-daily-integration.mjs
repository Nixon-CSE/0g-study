// Integration test against the LIVE Daily.co API + our DailyClient wrapper.
// Creates a room, mints a meeting token, deletes the room. Verifies the
// VoiceManager's transport layer end-to-end against the real API.
//
// Requires: DAILY_API_KEY in env (loaded from backend/.env via dotenv).
import 'dotenv/config';
import { createDailyClient } from '../src/voice/daily-client.js';

const log = (...a) => console.log('[daily-e2e]', ...a);

const apiKey = process.env.DAILY_API_KEY;
if (!apiKey) { log('FAIL: DAILY_API_KEY not set'); process.exit(1); }
log('using DAILY_API_KEY:', apiKey.slice(0, 8) + '…');

const client = createDailyClient();

log('1. creating room (exp=now+120)...');
const room = await client.createRoom({ expSeconds: 120, maxParticipants: 4 });
log(`   ✓ room: ${room.name}  url: ${room.url}  expiresAt: ${new Date(room.expiresAtUnix*1000).toISOString()}`);

log('2. minting meeting token for user "TestUser"...');
const userToken = await client.mintMeetingToken({
  roomName: room.name,
  userName: 'TestUser',
  isOwner: false,
  expSeconds: 120,
});
log(`   ✓ user token: ${userToken.slice(0, 40)}…`);

log('3. minting meeting token for bot (isOwner=true)...');
const botToken = await client.mintMeetingToken({
  roomName: room.name,
  userName: 'BonFire Bot',
  isOwner: true,
  expSeconds: 120,
});
log(`   ✓ bot token:  ${botToken.slice(0, 40)}…`);

log('4. deleting room...');
await client.deleteRoom(room.name);
log('   ✓ deleted');

log('5. delete again (should be idempotent — 404 tolerated)...');
await client.deleteRoom(room.name);
log('   ✓ idempotent delete OK');

log('\n✅ DAILY.CO INTEGRATION TEST PASSED');
