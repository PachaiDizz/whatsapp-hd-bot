const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');

// Multiple Twilio accounts (20/day)
const ACCOUNTS = [
  { sid: 'ACe59ae2cb5e351127addc181fd1447a7d', token: process.env.TWILIO_TOKEN_1 || '', from: 'whatsapp:+14155238886' },
  { sid: 'AC1171ed8c0b982bf93f1abaece8bedb06', token: process.env.TWILIO_TOKEN_2 || '', from: 'whatsapp:+14155238886' },
  { sid: 'AC52a45e18747ad646fcbf4d68ab692f92', token: process.env.TWILIO_TOKEN_3 || '', from: 'whatsapp:+14155238886' },
  { sid: 'ACdbf642024a8a0304a808a63cd9f16998', token: process.env.TWILIO_TOKEN_4 || '', from: 'whatsapp:+14155238886' },
];

let accountIndex = 0;
const PORT = process.env.PORT || 10000;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const UPLOAD_DIR = '/tmp/uploads';

// { sessionId -> phoneNumber }
const userPhones = {};

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

console.log('🤖 Bot started (4-Account Twilio + Session Verification)!');
console.log('🔑 Accounts loaded:', ACCOUNTS.length);
console.log('📊 Max messages/day:', ACCOUNTS.length * 5);

fs.readdir(UPLOAD_DIR, (err, files) => {
  if (!err) {
    files.forEach(f => fs.unlinkSync(path.join(UPLOAD_DIR, f)));
    console.log('🧹 Cleaned old uploads');
  }
});

function sendTwilioMedia(fileUrl, isVideo, account, toNumber) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      From: account.from,
      To: `whatsapp:+${toNumber}`,
      MediaUrl: fileUrl,
      Body: isVideo ? '🎥 HD Video ready! Forward to your Status.' : '📸 HD Photo ready! Forward to your Status.'
    }).toString();

    const options = {
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${account.sid}/Messages.json`,
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${account.sid}:${account.token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // ── Serve uploaded files ────────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/files/')) {
    const fileName = path.basename(req.url.replace('/files/', ''));
    const filePath = path.join(UPLOAD_DIR, fileName);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      const ext = path.extname(fileName).toLowerCase();
      const mime = ext === '.mp4' ? 'video/mp4' : ext === '.jpg' ? 'image/jpeg' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('File not found');
    }
    return;
  }

  // ── Phone lookup by session ID ──────────────────────────
  // Flutter app calls GET /phone/<sessionId> after user sends WhatsApp message
  if (req.method === 'GET' && req.url.startsWith('/phone/')) {
    const sessionId = req.url.replace('/phone/', '').split('?')[0].trim().toLowerCase();
    const phone = userPhones[sessionId] || '';
    console.log('🔍 Phone lookup:', sessionId, '→', phone || 'not found');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ phone }));
    return;
  }

  // ── Health check ────────────────────────────────────────
  if (req.method === 'GET') {
    res.writeHead(200);
    res.end('Bot running');
    return;
  }

  // ── Twilio Webhook ──────────────────────────────────────
  // Receives incoming WhatsApp messages
  // User sends: "verify <sessionId>" e.g. "verify k7x9mq"
  // Bot stores: userPhones["k7x9mq"] = "601116266163"
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const fromNumber = params.get('From') || '';
      const msgBody = (params.get('Body') || '').trim().toLowerCase();
      const phone = fromNumber.replace('whatsapp:+', '').trim();

      console.log('📨 Incoming message:', msgBody, '| From:', phone);

      if (phone) {
        // Match "verify <sessionId>"
        if (msgBody.startsWith('verify ')) {
          const sessionId = msgBody.split(' ')[1]?.trim();
          if (sessionId) {
            userPhones[sessionId] = phone;
            console.log(`✅ Session verified: [${sessionId}] → ${phone}`);
          } else {
            console.log('⚠️ verify message missing session ID');
          }
        } else {
          // Any other message — log it but don't store
          console.log('ℹ️ Unrecognized message (ignored):', msgBody);
        }
      } else {
        console.log('⚠️ No phone number in webhook payload');
      }

      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end('<Response></Response>');
    });
    return;
  }

  // ── Upload endpoint ─────────────────────────────────────
  if (req.method === 'POST' && req.url === '/upload') {
    let phone = '';
    let fileName = '';
    let fileSize = 0;
    let isVideo = true;
    const chunks = [];

    const busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_FILE_SIZE } });

    busboy.on('field', (name, val) => {
      if (name === 'phone') phone = val.replace(/[+\s]/g, '');
    });

    busboy.on('file', (name, file, info) => {
      const { filename, mimeType } = info;
      fileName = filename;
      const isMedia = mimeType.includes('video') || mimeType.includes('image') ||
                      filename.endsWith('.mp4') || filename.endsWith('.jpg') ||
                      filename.endsWith('.jpeg') || filename.endsWith('.png');
      if (!isMedia) { file.resume(); return; }
      if (mimeType.includes('image') || filename.endsWith('.jpg') ||
          filename.endsWith('.jpeg') || filename.endsWith('.png')) {
        isVideo = false;
      }
      file.on('data', (data) => {
        fileSize += data.length;
        if (fileSize > MAX_FILE_SIZE) { file.destroy(); return; }
        chunks.push(data);
      });
    });

    busboy.on('finish', async () => {
      if (chunks.length === 0) {
        res.writeHead(400);
        res.end(JSON.stringify({ status: 'error', error: 'No valid media file' }));
        return;
      }

      // Reject upload if no phone number provided
      if (!phone) {
        console.log('❌ Upload rejected: no phone number');
        res.writeHead(400);
        res.end(JSON.stringify({ status: 'error', error: 'Phone number required' }));
        return;
      }

      try {
        const videoData = Buffer.concat(chunks);
        const uniqueName = `${Date.now()}_${path.basename(fileName)}`;
        const filePath = path.join(UPLOAD_DIR, uniqueName);
        fs.writeFileSync(filePath, videoData);

        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers.host;
        const fileUrl = `${protocol}://${host}/files/${uniqueName}`;

        const account = ACCOUNTS[accountIndex % ACCOUNTS.length];
        accountIndex++;

        console.log(`📤 Account ${((accountIndex - 1) % ACCOUNTS.length) + 1} → ${phone}`);
        console.log(`📤 Sending (${(fileSize / 1048576).toFixed(2)} MB)...`);

        const result = await sendTwilioMedia(fileUrl, isVideo, account, phone);

        if (!result.sid) {
          console.log('⚠️ First account failed, retrying with next...');
          const nextAccount = ACCOUNTS[accountIndex % ACCOUNTS.length];
          accountIndex++;
          const retryResult = await sendTwilioMedia(fileUrl, isVideo, nextAccount, phone);
          if (!retryResult.sid) {
            console.log('❌ All retry accounts failed');
            res.writeHead(500);
            res.end(JSON.stringify({ status: 'error', error: 'All accounts exhausted' }));
          } else {
            console.log('✅ Sent on retry!');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'sent' }));
          }
        } else {
          console.log('✅ Sent! SID:', result.sid);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'sent' }));
          setTimeout(() => { try { fs.unlinkSync(filePath); } catch (_) {} }, 5 * 60 * 1000);
        }
      } catch (err) {
        console.error('❌ Error:', err.message);
        res.writeHead(500);
        res.end(JSON.stringify({ status: 'error', error: err.message }));
      }
    });

    req.pipe(busboy);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

