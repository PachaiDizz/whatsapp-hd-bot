const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const admin = require('firebase-admin');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const http = require('http');

const MY_PHONE = '601116266163';

const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'warn' })
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n\n📱 SCAN THIS QR CODE WITH WHATSAPP:\n');
      qrcode.generate(qr, { small: true });
      console.log('\nOpen WhatsApp → Settings → Linked Devices → Link a Device\n');
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
        : true;
      console.log('Reconnecting...');
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ Bot connected! Waiting for uploads...');
    }
  });

  db.collection('uploads').where('status', '==', 'pending')
    .onSnapshot(async (snapshot) => {
      for (const doc of snapshot.docChanges()) {
        if (doc.type === 'added') {
          const data = doc.data();
          const targetJid = `${data.phone}@s.whatsapp.net`;
          console.log(`📤 Sending to ${targetJid}...`);

          try {
            await sock.sendMessage(targetJid, {
              video: { url: data.url },
              caption: '🎥 HD Video ready! Forward to Status.'
            });
            await doc.ref.update({ status: 'sent', sentAt: new Date() });
            console.log('✅ Sent!');
          } catch (err) {
            console.error('❌ Failed:', err.message);
            await doc.ref.update({ status: 'failed', error: err.message });
          }
        }
      }
    });

  sock.ev.on('creds.update', saveCreds);
}

startBot();

http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot running');
}).listen(process.env.PORT || 10000);
