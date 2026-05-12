const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@adiwajshing/baileys');
const admin = require('firebase-admin');
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
    logger: pino({ level: 'warn' }),
    printQRInTerminal: true
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 SCAN THIS QR CODE:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
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
          try {
            await sock.sendMessage(`${data.phone}@s.whatsapp.net`, {
              video: { url: data.url },
              caption: '🎥 HD Video ready! Forward to Status.'
            });
            await doc.ref.update({ status: 'sent' });
            console.log('✅ Sent!');
          } catch (err) {
            console.error('❌ Failed:', err.message);
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
