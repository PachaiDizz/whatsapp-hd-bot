const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');

// Multiple Twilio accounts
const ACCOUNTS = [
  { sid: 'ACe59ae2cb5e351127addc181fd1447a7d', token: process.env.TWILIO_TOKEN_1 || '', from: 'whatsapp:+14155238886', label: 'Account 1' },
  { sid: 'AC1171ed8c0b982bf93f1abaece8bedb06', token: process.env.TWILIO_TOKEN_2 || '', from: 'whatsapp:+14155238886', label: 'Account 2' },
  { sid: 'AC52a45e18747ad646fcbf4d68ab692f92', token: process.env.TWILIO_TOKEN_3 || '', from: 'whatsapp:+14155238886', label: 'Account 3' },
  { sid: 'ACdbf642024a8a0304a808a63cd9f16998', token: process.env.TWILIO_TOKEN_4 || '', from: 'whatsapp:+14155238886', label: 'Account 4' },
];

const DAILY_LIMIT_PER_ACCOUNT = 5;
const TOTAL_DAILY_LIMIT = ACCOUNTS.length * DAILY_LIMIT_PER_ACCOUNT;

let accountIndex = 0;
const PORT = process.env.PORT || 10000;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const UPLOAD_DIR = '/tmp/uploads';

// Verification storage
const verifications = [];

// Lifetime usage tracking (survives app reinstalls)
const phoneLifetimeUsage = {};
const MAX_LIFETIME_USES = 3;
const DEVELOPER_NUMBER = '601116266163';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'dev-secret-key-2024';

// Daily usage per account
const usageTracker = {};

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

function getUsage(label) {
  const today = getTodayDate();
  if (!usageTracker[label] || usageTracker[label].date !== today) {
    usageTracker[label] = { count: 0, date: today };
  }
  return usageTracker[label];
}

function incrementUsage(label) {
  const usage = getUsage(label);
  usage.count++;
}

function getRemainingForAccount(label) {
  const usage = getUsage(label);
  return Math.max(0, DAILY_LIMIT_PER_ACCOUNT - usage.count);
}

function getTotalRemaining() {
  return ACCOUNTS.reduce((sum, acc) => sum + getRemainingForAccount(acc.label), 0);
}

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

console.log('🤖 Bot started (4-Account Twilio + Lifetime Tracking)!');
console.log('🔑 Accounts loaded:', ACCOUNTS.length);
console.log('📊 Total daily limit:', TOTAL_DAILY_LIMIT, 'messages');
console.log('👑 Developer:', DEVELOPER_NUMBER, '(unlimited)');
console.log('🔒 Admin key:', ADMIN_API_KEY ? 'SET' : 'NOT SET');

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

  // ── Serve uploaded files ──
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

  // ── Phone lookup by timestamp ──
  if (req.method === 'GET' && req.url.startsWith('/phone-by-time/')) {
    const timestamp = parseInt(req.url.replace('/phone-by-time/', '').split('?')[0]);
    let bestPhone = '';
    let bestDiff = Infinity;
    for (const v of verifications) {
      const diff = Math.abs(v.timestamp - timestamp);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestPhone = v.phone;
      }
    }
    console.log('🔍 Phone by time →', bestPhone || 'not found');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ phone: bestPhone }));
    return;
  }

  // ── Admin: Check user usage ──
  if (req.method === 'GET' && req.url.startsWith('/admin/usage/')) {
    const phone = req.url.replace('/admin/usage/', '').split('?')[0];
    const used = phoneLifetimeUsage[phone] || 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ phone, used, remaining: MAX_LIFETIME_USES - used, isDeveloper: phone === DEVELOPER_NUMBER }));
    return;
  }

  if (req.method === 'GET') {
    res.writeHead(200);
    res.end('Bot running');
    return;
  }

  // ── Twilio Webhook ──
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const fromNumber = params.get('From') || '';
      const phone = fromNumber.replace('whatsapp:+', '');
      if (phone) {
        verifications.push({ phone, timestamp: Date.now() });
        console.log('📱 Verified phone:', phone);
      }
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end('<Response></Response>');
    });
    return;
  }

  // ── Admin: Reset user's lifetime usage ──
  if (req.method === 'POST' && req.url === '/admin/reset') {
    const authKey = req.headers['x-api-key'] || '';
    if (authKey !== ADMIN_API_KEY) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { phone } = JSON.parse(body);
        phoneLifetimeUsage[phone] = 0;
        console.log('🔄 Admin reset:', phone);
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'reset', phone, remaining: MAX_LIFETIME_USES }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // ── Upload endpoint ──
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

        const toNumber = phone || '601116266163';

        // ── Lifetime usage check (skip developer) ──
        if (toNumber !== DEVELOPER_NUMBER) {
          const used = phoneLifetimeUsage[toNumber] || 0;
          if (used >= MAX_LIFETIME_USES) {
            console.log('🚫 Blocked:', toNumber, '(used', used, 'times)');
            res.writeHead(403);
            res.end(JSON.stringify({ status: 'blocked', error: 'Trial ended (3/3 uses). Contact developer.' }));
            return;
          }
        }

        // Find account with remaining daily quota
        let account = null;
        for (let i = 0; i < ACCOUNTS.length; i++) {
          const acc = ACCOUNTS[(accountIndex + i) % ACCOUNTS.length];
          if (getRemainingForAccount(acc.label) > 0) {
            account = acc;
            accountIndex = (accountIndex + i + 1) % ACCOUNTS.length;
            break;
          }
        }

        if (!account) {
          res.writeHead(429);
          res.end(JSON.stringify({ status: 'error', error: 'Daily limit reached. Try again tomorrow.' }));
          return;
        }

        console.log(`📤 ${account.label} → ${toNumber} (${(fileSize/1048576).toFixed(2)} MB)...`);

        const result = await sendTwilioMedia(fileUrl, isVideo, account, toNumber);

        if (result.sid) {
          incrementUsage(account.label);
          
          // Record lifetime usage (skip developer)
          if (toNumber !== DEVELOPER_NUMBER) {
            phoneLifetimeUsage[toNumber] = (phoneLifetimeUsage[toNumber] || 0) + 1;
            console.log('📊 Lifetime:', toNumber, '→', phoneLifetimeUsage[toNumber], '/', MAX_LIFETIME_USES);
          }
          
          console.log('✅ Sent! SID:', result.sid);
          console.log('📊 Remaining today:', getTotalRemaining(), '/', TOTAL_DAILY_LIMIT);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'sent' }));
          setTimeout(() => { try { fs.unlinkSync(filePath); } catch (_) {} }, 5 * 60 * 1000);
        } else {
          // Try next account
          let sent = false;
          for (let i = 1; i < ACCOUNTS.length; i++) {
            const nextAcc = ACCOUNTS[(accountIndex + i) % ACCOUNTS.length];
            if (getRemainingForAccount(nextAcc.label) > 0) {
              const retryResult = await sendTwilioMedia(fileUrl, isVideo, nextAcc, toNumber);
              if (retryResult.sid) {
                incrementUsage(nextAcc.label);
                if (toNumber !== DEVELOPER_NUMBER) {
                  phoneLifetimeUsage[toNumber] = (phoneLifetimeUsage[toNumber] || 0) + 1;
                  console.log('📊 Lifetime:', toNumber, '→', phoneLifetimeUsage[toNumber], '/', MAX_LIFETIME_USES);
                }
                console.log('✅ Sent on retry!');
                res.writeHead(200);
                res.end(JSON.stringify({ status: 'sent' }));
                sent = true;
                break;
              }
            }
          }
          if (!sent) {
            res.writeHead(500);
            res.end(JSON.stringify({ status: 'error', error: 'All accounts failed or exhausted' }));
          }
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

