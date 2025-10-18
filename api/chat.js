// server.js (আপনার Own Server)
const express = require('express');
const mongoose = require('mongoose');
const app = express();

// Database connection
mongoose.connect('mongodb://localhost:27017/ai_api');

// User Schema
const userSchema = new mongoose.Schema({
  email: String,
  password: String,
  api_key: String,
  plan: { type: String, default: 'free' },
  daily_used: { type: Number, default: 0 },
  daily_limit: { type: Number, default: 50 },
  created_at: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// User Registration with Auto API Key
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  
  // Generate API Key
  const apiKey = 'ds_' + require('crypto').randomBytes(32).toString('hex');
  
  // Save to Database
  const user = new User({
    email: email,
    password: await bcrypt.hash(password, 10),
    api_key: apiKey,
    plan: 'free'
  });
  
  await user.save();
  
  res.json({
    success: true,
    api_key: apiKey, // User এই keyটি store করবে
    user: { email: email, plan: 'free' }
  });
});

// AI Service Endpoint
app.post('/api/generate', async (req, res) => {
  const { prompt, api_key } = req.body;
  
  // Verify API Key from Database
  const user = await User.findOne({ api_key: api_key });
  if (!user) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  // Check daily limit
  if (user.daily_used >= user.daily_limit) {
    return res.status(429).json({ error: 'Daily limit exceeded' });
  }
  
  // Process with Gemini (আপনার API keys আপনার server-এ safe)
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const result = await genAI.generateContent(prompt);
  
  // Update usage in database
  user.daily_used += 1;
  await user.save();
  
  res.json({
    response: result.response.text(),
    usage: {
      used: user.daily_used,
      limit: user.daily_limit,
      remaining: user.daily_limit - user.daily_used
    }
  });
});

app.listen(3000, () => {
  console.log('Your API server running on port 3000');
});
