const express = require('express');
const { MongoClient } = require('mongodb');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || 'thayyil_petroleum';

let db;
async function connect() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  await db.collection('kv_store').createIndex({ updatedAt: 1 });
  console.log('✅ Connected to MongoDB Atlas');
}

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/data', async (_req, res) => {
  try {
    const docs = await db.collection('kv_store').find({}).toArray();
    const out = {};
    docs.forEach(d => { out[d._id] = d.value; });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/data/:key', async (req, res) => {
  try {
    const doc = await db.collection('kv_store').findOne({ _id: req.params.key });
    if (!doc) return res.status(404).json({ error: 'not found' });
    res.json(doc.value);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/data/:key', async (req, res) => {
  try {
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'value required' });
    await db.collection('kv_store').updateOne(
      { _id: req.params.key },
      { $set: { value, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

connect()
  .then(() => app.listen(PORT, () => console.log(`🚀 Server on ${PORT}`)))
  .catch(err => { console.error('MongoDB connect failed:', err); process.exit(1); });
