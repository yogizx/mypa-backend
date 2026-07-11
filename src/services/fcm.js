'use strict';

let admin = null;
let _inited = false;

function _init() {
  if (_inited) return;
  _inited = true;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    console.warn('[FCM] Missing Firebase service-account env vars — push notifications disabled');
    return;
  }

  try {
    admin = require('firebase-admin');
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n'),
      }),
    });
    console.log('[FCM] Firebase Admin initialized');
  } catch (err) {
    console.error('[FCM] Init failed:', err.message);
    admin = null;
  }
}

async function sendPush(userId, fcmTokens, title, body, data = {}) {
  _init();
  if (!admin) return;

  const tokens = [];
  if (fcmTokens?.android) tokens.push(fcmTokens.android);
  if (fcmTokens?.ios) tokens.push(fcmTokens.ios);
  if (!tokens.length) return;

  const message = {
    notification: { title, body },
    data: Object.fromEntries(
      Object.entries({ type: 'meeting_reminder', ...data }).map(([k, v]) => [k, String(v)])
    ),
    tokens,
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`[FCM] Sent: ${response.successCount} success, ${response.failureCount} failure`);
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        console.error(`[FCM] Token ${idx} error:`, resp.error?.message);
      }
    });
  } catch (err) {
    console.error('[FCM] sendEachForMulticast failed:', err.message);
  }
}

module.exports = { sendPush };
