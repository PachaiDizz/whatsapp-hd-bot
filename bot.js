const http = require('http');
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');

const ACCOUNT_SID = process.env.TWILIO_SID || 'ACe59ae2cb5e351127addc181fd1447a7d';
const AUTH_TOKEN = process.env.TWILIO_TOKEN || '4d4eb664210553dbe04cc6408bfaa7c1';
const FROM_NUMBER = 'whatsapp:+14155238886';
const TO_NUMBER = process.env.TO_NUMBER || '601116266163';
const PORT = process.env.PORT || 10000;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const UPLOAD_DIR = '/tmp/uploads';

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

console.log('🤖 Bot started (Twilio WhatsApp)!\n');

fs.readdir(UPLOAD_DIR, (err, files) => {
  if (!err) {
    files.forEach(f => fs.unlinkSync(path.join(UPLOAD_DIR, f)));
    console.log('🧹 Cleaned old uploads');
  }
});

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

        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers.host;
        const fileUrl = `${protocol}://${host}/files/${uniqueName}`;

        console.log(`📤 Sending (${(fileSize/1048576).toFixed(2)} MB)...`);

        const msg = await client.messages.create({
          from: FROM_NUMBER,
          to: `whatsapp:+${TO_NUMBER}`,
          mediaUrl: [fileUrl],
          body: '🎥 HD Media ready! Forward to your Status.'
        });

        console.log('✅ Sent! SID:', msg.sid);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'sent' }));

        setTimeout(() => {
          try { fs.unlinkSync(filePath); } catch (_) {}
        }, 5 * 60 * 1000);

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
