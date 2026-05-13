const http = require('http');
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');

const TELEGRAM_TOKEN = '8782072387:AAE0EluWwXJUBL8g2IvNcsXZXNvoDOnqKZw';
const CHAT_ID = '6209105794';
const PORT = process.env.PORT || 10000;

if (!fs.existsSync('/tmp/uploads')) fs.mkdirSync('/tmp/uploads');

console.log('🤖 Bot started!\n');

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
    const fileName = req.url.replace('/files/', '');
    const filePath = path.join('/tmp/uploads', fileName);
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
    let phone = '';
    let fileName = '';
    const chunks = [];

    const busboy = Busboy({ headers: req.headers });

    busboy.on('field', (name, val) => {
      if (name === 'phone') phone = val;
    });

    busboy.on('file', (name, file, info) => {
      fileName = info.filename;
      file.on('data', (data) => chunks.push(data));
    });

    busboy.on('finish', async () => {
      const videoData = Buffer.concat(chunks);
      const uniqueName = `${Date.now()}_${fileName}`;
      const filePath = path.join('/tmp/uploads', uniqueName);
      fs.writeFileSync(filePath, videoData);

      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host;
      const fileUrl = `${protocol}://${host}/files/${uniqueName}`;

      console.log(`📤 Saved: ${uniqueName} (${videoData.length} bytes)`);

      // Send via Telegram
      const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendVideo`;
      const telegramBody = JSON.stringify({
        chat_id: CHAT_ID,
        video: fileUrl,
        caption: '🎥 HD Video ready! Save this and share to WhatsApp Status.'
      });

      try {
        const tgRes = await fetch(telegramUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: telegramBody
        });
        const tgJson = await tgRes.json();
        console.log('✅ Telegram response:', JSON.stringify(tgJson));
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'sent', telegram: tgJson }));
      } catch (err) {
        console.error('❌ Telegram error:', err.message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
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



