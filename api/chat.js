const { GoogleGenerativeAI } = require('@google/generative-ai');

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { message } = req.body;
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // Use Gemini 2.5 model names:
    const modelsToTry = [
      "gemini-2.5-pro-exp-03-25",    // Gemini 2.5 Pro
      "gemini-2.0-flash-exp",        // Gemini 2.0 Flash  
      "gemini-2.5-flash-exp",        // Gemini 2.5 Flash
      "gemini-2.0-flash-thinking",   // Alternative
    ];

    let lastError;
    
    for (const modelName of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(message);
        const response = await result.response;
        
        return res.status(200).json({ 
          text: response.text(), 
          modelUsed: modelName 
        });
      } catch (error) {
        lastError = error;
        continue; // Try next model
      }
    }
    
    throw lastError;
  } catch (error) {
    return res.status(500).json({ 
      error: error.message, 
      suggestion: 'Gemini 2.5 requires specific model names' 
    });
  }
};
