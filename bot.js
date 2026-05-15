const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');

const ACCOUNT_SID = process.env.TWILIO_SID || 'ACe59ae2cb5e351127addc181fd1447a7d';
const AUTH_TOKEN = process.env.TWILIO_TOKEN || '9f5fcebb6ac7ac2c279da965b3ca6d38';
const FROM_NUMBER = 'whatsapp:+14155238886';
const TO_NUMBER = process.env.TO_NUMBER || '601116266163';
const PORT = process.env.PORT || 10000;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const UPLOAD_DIR = '/tmp/uploads';

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

console.log('🤖 Bot started (Twilio Direct API)!');
console.log('🔑 SID:', ACCOUNT_SID.substring(0, 8) + '...');

fs.readdir(UPLOAD_DIR, (err, files) => {
  if (!err) {
    files.forEach(f => fs.unlinkSync(path.join(UPLOAD_DIR, f)));
    console.log('🧹 Cleaned old uploads');
  }
});

function sendTwilioMessage(fileUrl) {
  return new Promise((resolve, reject) => {
    // Text-only test first
    const body = new URLSearchParams({
      From: FROM_NUMBER,
      To: `whatsapp:+${TO_NUMBER}`,
      Body: '🧪 Test message from bot - text works!'
    }).toString();

    const options = {
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64'),
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

      file.on('data', (data) => {
        fileSize += data.length;
        if (fileSize > MAX_FILE_SIZE) {
          file.destroy();
          return;
        }
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

        console.log(`📤 Uploaded (${(fileSize/1048576).toFixed(2)} MB)`);
        console.log(`🧪 Sending test message...`);

        const result = await sendTwilioMessage();

        console.log('📨 Twilio raw response:', JSON.stringify(result));

        if (!result.sid) {
          const errMsg = result.message || result.error_message || JSON.stringify(result);
          console.error('❌ Twilio error - Status:', result.status, 'Code:', result.code, 'Message:', errMsg);
          res.writeHead(500);
          res.end(JSON.stringify({ status: 'error', error: errMsg }));
        } else {
          console.log('✅ Text sent! SID:', result.sid);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'sent', sid: result.sid }));

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
