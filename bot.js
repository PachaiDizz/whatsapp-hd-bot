const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const admin = require('firebase-admin');
const { Boom } = require('@hapi/boom');
const fs = require('fs');

// ============================================
// CONFIGURE YOUR PHONE NUMBER HERE
// ============================================
const MY_PHONE = '601116266163@s.whatsapp.net';

// Initialize Firebase Admin
// IMPORTANT: You'll add your Firebase config in the next step
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// Track processed uploads
const processedUrls = new Set();

// Listen for new uploads in Firestore
db.collection('uploads').where('status', '==', 'pending')
  .onSnapshot(async (snapshot) => {
    for (const doc of snapshot.docChanges()) {
      if (doc.type === 'added') {
        const data = doc.data();
        const { url, phone } = data;
        const targetJid = phone.includes('@s.whatsapp.net') 
          ? phone 
          : `${phone}@s.whatsapp.net`;
        
        console.log(`New upload detected: ${url}`);
        
        // Send video to the user
        try {
          await sock.sendMessage(targetJid, {
            video: { url },
            caption: '🎥 Here is your HD video. Forward this to your Status!'
          });
          
          // Mark as sent
          await doc.ref.update({ status: 'sent', sentAt: admin.firestore.FieldValue.serverTimestamp() });
          console.log(`Sent to ${targetJid}`);
        } catch (err) {
          console.error('Send failed:', err);
          await doc.ref.update({ status: 'failed', error: err.message });
        }
      }
    }
  });

// WhatsApp connection
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true, // Scan QR code to connect
    logger: require('pino')({ level: 'silent' })
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error instanceof Boom 
        ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
        : true;
      console.log('Connection closed. Reconnecting...', shouldReconnect);
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      console.log('Bot connected! Waiting for uploads...');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  return sock;
}

let sock;
connectToWhatsApp().then(s => sock = s);
