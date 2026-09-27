const express = require('express');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const app = express();
app.use(express.json({limit:'1mb'}));
app.use(express.static(__dirname));

function requireAdmin(req, res, next){
  const password = process.env.ADMIN_PASSWORD;
  if(!password) return res.status(503).json({error:'ADMIN_PASSWORD is not configured'});
  const auth = String(req.headers.authorization || '');
  if(!auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Faravoj Admin"');
    return res.status(401).json({error:'admin authentication required'});
  }
  let decoded = '';
  try { decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8'); } catch {}
  const supplied = decoded.split(':').slice(1).join(':');
  if(supplied !== password) return res.status(403).json({error:'invalid admin password'});
  next();
}

const DATA = path.join(__dirname, 'conversations.json');
let conversations = {};
try { conversations = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch {}
function save(){ fs.writeFileSync(DATA, JSON.stringify(conversations, null, 2)); }
function getConv(id){
  if(!conversations[id]) conversations[id] = {id, name:'مراجعه‌کننده', messages:[], createdAt:Date.now(), lastTime:0, lastText:'', unread:false, status:'open'};
  return conversations[id];
}
function pushMessage(c, text, sender){
  const m={id:(sender==='support'?'s':'u')+Date.now()+Math.random().toString(36).slice(2,6),text,sender,time:Date.now()};
  c.messages.push(m); c.lastTime=m.time; c.lastText=text; return m;
}

app.get('/api/conversations', requireAdmin, (req,res)=>{
  res.json(Object.values(conversations).sort((a,b)=>b.lastTime-a.lastTime).slice(0,100));
});
app.get('/api/conversations/:id', requireAdmin, (req,res)=>res.json(getConv(req.params.id)));
app.post('/api/conversations/:id/read', requireAdmin, (req,res)=>{const c=getConv(req.params.id);c.unread=false;save();res.json(c);});
app.post('/api/conversations/:id/message', requireAdmin, (req,res)=>{const c=getConv(req.params.id);const text=String(req.body.text||'').trim();if(!text)return res.status(400).json({error:'text required'});const m=pushMessage(c,text,'support');c.unread=false;save();res.json({message:m,conversation:c});});

app.post('/api/chat', async (req,res)=>{
  const conversationId=String(req.body.conversationId||'').trim();
  const userText=String(req.body.message||'').trim();
  if(!conversationId || !userText)return res.status(400).json({error:'conversationId and message are required'});
  const c=getConv(conversationId); pushMessage(c,userText,'user'); c.unread=true; save();
  if(!process.env.OPENAI_API_KEY){
    return res.status(503).json({error:'OPENAI_API_KEY is not configured'});
  }
  try{
    const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
    const history=c.messages.slice(-16).map(m=>({role:m.sender==='support'?'assistant':'user',content:m.text}));
    const response=await client.responses.create({
      model:process.env.OPENAI_MODEL || 'gpt-5.6-luna',
      instructions:`تو دستیار پشتیبانی شرکت فراوج و گروه یخچال‌سازی صنعتی به سفارش ایران ناسیونال هستی. فارسی روان، محترمانه و کوتاه پاسخ بده. درباره محصولات، یخچال‌های صنعتی و ویترینی، استعلام قیمت، فروش، خدمات فنی و گارانتی راهنمایی کن. اگر اطلاعات دقیق قیمت یا مشخصات در پیام‌ها وجود ندارد، حدس نزن و بگو کارشناس باید بررسی کند. شماره‌های تماس فقط وقتی لازم است از اطلاعات موجود در سایت استفاده کن. از ادعای اطلاعاتی که نداری خودداری کن.`,
      input: history
    });
    const text=response.output_text || 'لطفاً چند لحظه بعد دوباره پیام بدهید.';
    const m=pushMessage(c,text,'support'); c.unread=false; save(); res.json({message:m});
  }catch(err){
    console.error(err);
    res.status(500).json({error:'OpenAI request failed'});
  }
});

const port=process.env.PORT || 3000;
app.listen(port,()=>console.log(`Faravoj chat running on http://localhost:${port}`));