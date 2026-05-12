const admin = require('firebase-admin');
const http = require('http');
const twilio = require('twilio');

// Twilio credentials
const ACCOUNT_SID = 'AC52a45e18747ad646fcbf4d68ab692f92';
const AUTH_TOKEN = '2ede88d87bba9b92ebf1f1cb86218714';
const FROM_NUMBER = 'whatsapp:+14155238886';

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

// Firebase config
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// Listen for new uploads
db.collection('uploads').where('status', '==', 'pending')
  .onSnapshot(async (snapshot) => {
    for (const change of snapshot.docChanges()) {
      if (change.type === 'added') {
        const data = change.doc.data();
        const toNumber = `whatsapp:+${data.phone}`;

        console.log(`📤 Sending video to ${toNumber}...`);

        try {
          const msg = await client.messages.create({
            from: FROM_NUMBER,
            to: toNumber,
            body: '🎥 HD Video ready! Forward this to your Status.',
            mediaUrl: [data.url]
          });

          await change.doc.ref.update({
            status: 'sent',
            messageSid: msg.sid
          });
          console.log('✅ Sent! SID:', msg.sid);
        } catch (err) {
          console.error('❌ Failed:', err.message);
          await change.doc.ref.update({
            status: 'failed',
            error: err.message
          });
        }
      }
    }
  });

console.log('🤖 Bot started! Waiting for uploads...\n');

// Fake server
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot running');
}).listen(process.env.PORT || 10000);

