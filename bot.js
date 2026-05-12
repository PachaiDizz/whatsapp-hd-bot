const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const admin = require('firebase-admin');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const http = require('http');

const MY_PHONE = '601116266163';

const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG || '{}');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'info' })
  });

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n\n📱 SCAN THIS QR CODE:\n');
      qrcode.generate(qr, { small: true });
      console.log('\nWhatsApp → Linked Devices → Link a Device\n');
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error instanceof Boom 
        ? lastDisconnect.error.output.statusCode 
        : 0;
      if (code !== DisconnectReason.loggedOut) {
        console.log('Reconnecting...');
        startBot();
      } else {
        console.log('Logged out!');
      }
    } else if (connection === 'open') {
      console.log('✅ Connected!');
    }
  });

  db.collection('uploads').where('status', '==', 'pending')
    .onSnapshot(async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'added') {
          const data = change.doc.data();
          try {
            await sock.sendMessage(`${data.phone}@s.whatsapp.net`, {
              video: { url: data.url },
              caption: '🎥 HD Video ready! Forward to Status.'
            });
            await change.doc.ref.update({ status: 'sent' });
            console.log('✅ Sent!');
          } catch (e) {
            console.error('❌', e.message);
          }
        }
      }
    });

  sock.ev.on('creds.update', saveCreds);
}

startBot().catch(err => {
  console.error('FATAL:', err.message);
});

http.createServer((req, res) => {
  res.writeHead(200);
  res.end('OK');
}).listen(process.env.PORT || 10000);
