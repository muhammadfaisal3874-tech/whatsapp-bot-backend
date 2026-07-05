const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const rateInquiries = [];

async function detectProductInquiry(message) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const prompt = `
    User ka message: "${message}"
    Agar user kisi product ka rate/price/cost pooch raha hai tou:
    - product_inquiry: true
    - product_name: product ka naam
    Agar rate nahi pooch raha tou:
    - product_inquiry: false
    - product_name: null
    Sirf JSON mein jawab do:
    {"product_inquiry": true/false, "product_name": "naam ya null"}
  `;
  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

async function generateBotReply(message, isProductInquiry) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  let prompt;
  if (isProductInquiry) {
    prompt = `Customer ne product ka rate pucha hai. Unhe politely batao ke hum rate check karke abhi batate hain. Urdu mein jawab do, 1-2 lines mein, friendly tone.`;
  } else {
    prompt = `Customer ka message: "${message}" Ek helpful shop assistant ki tarah Urdu mein jawab do. Short aur friendly rakho.`;
  }
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('Webhook Verified!');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

app.post('/webhook', async (req, res) => {
    console.log("Naya message aaya hai!");
    res.sendStatus(200);
    try {
        const entry = req.body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const messages = value?.messages;
        if (!messages || messages.length === 0) return;
        const userMessage = messages[0].text?.body || '';
        const userPhone = messages[0].from || '';
        const userName = value?.contacts?.[0]?.profile?.name || 'Customer';
        console.log(`Message from ${userName}: ${userMessage}`);
        const detection = await detectProductInquiry(userMessage);
        if (detection.product_inquiry) {
            rateInquiries.push({
                id: Date.now(),
                customer: userName,
                phone: userPhone,
                product: detection.product_name,
                message: userMessage,
                time: new Date().toLocaleTimeString(),
                answered: false
            });
            console.log(`RATE INQUIRY: ${detection.product_name} by ${userName}`);
        }
    } catch (error) {
        console.error('Error:', error);
    }
});

app.get('/inquiries', (req, res) => {
    res.json(rateInquiries);
});

app.post('/mark-done/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const inquiry = rateInquiries.find(r => r.id === id);
    if (inquiry) inquiry.answered = true;
    res.json({ success: true });
});

app.get('/dashboard', (req, res) => {
    const pending = rateInquiries.filter(r => !r.answered);
    const answered = rateInquiries.filter(r => r.answered);
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>WhatsApp Bot Dashboard</title>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial; background: #f0f2f5; padding: 20px; }
    h1 { color: #128C7E; }
    .card { background: white; border-radius: 10px; padding: 16px; margin-bottom: 12px; border-left: 4px solid #25D366; }
    .product { font-size: 18px; font-weight: bold; }
    .badge { background: #ff4444; color: white; padding: 3px 10px; border-radius: 999px; font-size: 12px; }
    button { background: #128C7E; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; margin-top: 10px; }
  </style>
</head>
<body>
  <h1>WhatsApp Bot Dashboard</h1>
  <h2>Pending <span class="badge">${pending.length}</span></h2>
  ${pending.length === 0 ? '<p>Koi pending inquiry nahi</p>' : pending.map(r => `
    <div class="card">
      <div class="product">📦 ${r.product}</div>
      <div>👤 ${r.customer} — ${r.phone}</div>
      <div>"${r.message}"</div>
      <div>🕐 ${r.time}</div>
      <button onclick="fetch('/mark-done/${r.id}',{method:'POST'}).then(()=>location.reload())">✅ Mark as Answered</button>
    </div>
  `).join('')}
  <h2>Answered (${answered.length})</h2>
  ${answered.map(r => `<div class="card" style="border-left-color:#ccc;opacity:0.7"><b>📦 ${r.product}</b> — ${r.customer}</div>`).join('')}
  <script>setTimeout(()=>location.reload(), 15000)</script>
</body>
</html>
    `);
});

app.listen(PORT, () => {
    console.log(`Server chal raha hai port ${PORT} par!`);
    console.log(`Dashboard: http://localhost:${PORT}/dashboard`);
});