const { GoogleGenerativeAI } = require('@google/generative-ai');

// Convert base64 to GoogleGenerativeAI.Part
function base64ToGenerativePart(base64String, mimeType) {
    return {
        inlineData: {
            data: base64String.split(',')[1],
            mimeType: mimeType
        }
    };
}

module.exports = async (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { message, images, mode } = req.body;
        
        if (!message && (!images || images.length === 0)) {
            return res.status(400).json({ error: 'Message or image is required' });
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        
        // Use ONLY Gemini 2.5 Flash models that work with your API key
        const modelsToTry = [
            "gemini-2.0-flash-exp",      // Primary - should work
            "gemini-2.5-flash-exp",      // Alternative
            "gemini-2.0-flash",          // Fallback
            "gemini-1.5-flash"           // Last resort
        ];

        let lastError;

        for (const modelName of modelsToTry) {
            try {
                console.log(`Trying model: ${modelName}`);
                const model = genAI.getGenerativeModel({ model: modelName });
                
                if (images && images.length > 0) {
                    // Handle images (both analyze and chat modes)
                    const imageParts = images.map(imgData => {
                        const mimeType = imgData.split(';')[0].split(':')[1];
                        return base64ToGenerativePart(imgData, mimeType);
                    });

                    const prompt = message 
                        ? `${message} - Please analyze the uploaded image and respond.`
                        : "Please analyze and describe this image in detail.";

                    const result = await model.generateContent([prompt, ...imageParts]);
                    const response = await result.response;
                    
                    return res.status(200).json({ 
                        text: response.text(),
                        modelUsed: modelName,
                        mode: mode || 'analyze'
                    });

                } else {
                    // Text-only mode
                    const result = await model.generateContent(message);
                    const response = await result.response;
                    
                    return res.status(200).json({ 
                        text: response.text(),
                        modelUsed: modelName,
                        mode: mode || 'chat'
                    });
                }

            } catch (error) {
                console.log(`Model ${modelName} failed:`, error.message);
                lastError = error;
                continue;
            }
        }
        
        throw lastError || new Error('All models failed');

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ 
            error: error.message,
            suggestion: 'Please check your API key supports Gemini 2.0/2.5 models'
        });
    }
};
