const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');

// Multiple Twilio accounts for more daily messages
const ACCOUNTS = [
  {
    sid: 'ACe59ae2cb5e351127addc181fd1447a7d',
    token: process.env.TWILIO_TOKEN_1 || '',
    from: 'whatsapp:+14155238886'
  },
  {
    sid: 'AC1171ed8c0b982bf93f1abaece8bedb06',
    token: process.env.TWILIO_TOKEN_2 || '',
    from: 'whatsapp:+14155238886' // Update if different
  }
];

let accountIndex = 0;
const TO_NUMBER = process.env.TO_NUMBER || '601116266163';
const PORT = process.env.PORT || 10000;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const UPLOAD_DIR = '/tmp/uploads';

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

console.log('🤖 Bot started (Multi-Account Twilio)!');
console.log('🔑 Accounts loaded:', ACCOUNTS.length);
console.log('📊 Max messages/day:', ACCOUNTS.length * 5);

fs.readdir(UPLOAD_DIR, (err, files) => {
  if (!err) {
    files.forEach(f => fs.unlinkSync(path.join(UPLOAD_DIR, f)));
    console.log('🧹 Cleaned old uploads');
  }
});

function sendTwilioMedia(fileUrl, isVideo, account) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      From: account.from,
      To: `whatsapp:+${TO_NUMBER}`,
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

  if (req.method === 'GET' && req.url.startsWith('/files/')) {
    const fileName = path.basename(req.url.replace('/files/', ''));
    const filePath = path.join(UPLOAD_DIR, fileName);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': stat.size });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('File not found');
    }
    return;
  }

  if (req.method === 'GET') {
    res.writeHead(200);
    res.end('Bot running');
    return;
  }

  if (req.method === 'POST' && req.url === '/upload') {
    let fileName = '';
    let fileSize = 0;
    let isVideo = true;
    const chunks = [];

    const busboy = Busboy({ 
      headers: req.headers,
      limits: { fileSize: MAX_FILE_SIZE }
    });

    busboy.on('file', (name, file, info) => {
      const { filename, mimeType } = info;
      fileName = filename;
      
      const isMedia = mimeType.includes('video') || 
                      mimeType.includes('image') ||
                      filename.endsWith('.mp4') || 
                      filename.endsWith('.jpg') ||
                      filename.endsWith('.jpeg') ||
                      filename.endsWith('.png');

      if (!isMedia) {
        file.resume();
        return;
      }

      if (mimeType.includes('image') || filename.endsWith('.jpg') || filename.endsWith('.jpeg') || filename.endsWith('.png')) {
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

      try {
        const videoData = Buffer.concat(chunks);
        const uniqueName = `${Date.now()}_${path.basename(fileName)}`;
        const filePath = path.join(UPLOAD_DIR, uniqueName);
        fs.writeFileSync(filePath, videoData);

        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers.host;
        const fileUrl = `${protocol}://${host}/files/${uniqueName}`;

        // Rotate accounts
        const account = ACCOUNTS[accountIndex % ACCOUNTS.length];
        accountIndex++;

        console.log(`📤 Using account ${accountIndex}: ${account.from} (SID: ${account.sid.substring(0, 8)}...)`);
        console.log(`📤 Sending (${(fileSize/1048576).toFixed(2)} MB)...`);

        const result = await sendTwilioMedia(fileUrl, isVideo, account);

        if (!result.sid) {
          const errMsg = result.message || 'Unknown error';
          console.error('❌ Failed:', errMsg);
          
          // Try next account
          const nextAccount = ACCOUNTS[accountIndex % ACCOUNTS.length];
          accountIndex++;
          console.log(`🔄 Trying account ${accountIndex}: ${nextAccount.from}...`);
          
          const retryResult = await sendTwilioMedia(fileUrl, isVideo, nextAccount);
          
          if (!retryResult.sid) {
            res.writeHead(500);
            res.end(JSON.stringify({ status: 'error', error: 'All accounts exhausted' }));
          } else {
            console.log('✅ Sent on retry! SID:', retryResult.sid);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'sent' }));
          }
        } else {
          console.log('✅ Sent! SID:', result.sid);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'sent' }));

          setTimeout(() => {
            try { fs.unlinkSync(filePath); } catch (_) {}
          }, 5 * 60 * 1000);
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

