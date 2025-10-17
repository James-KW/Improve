const { GoogleGenerativeAI } = require('@google/generative-ai');

// Convert base64 to GoogleGenerativeAI.Part
function base64ToGenerativePart(base64String, mimeType) {
    return {
        inlineData: {
            data: base64String.split(',')[1], // Remove data:image/...;base64, prefix
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

    // Only handle POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { message, images, mode } = req.body;
        
        // Validate message
        if (!message && (!images || images.length === 0)) {
            return res.status(400).json({ error: 'Message or image is required' });
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        
        // Model configuration based on mode
        const modelConfig = {
            chat: [
                "gemini-1.5-flash",
                "gemini-1.5-pro",
                "gemini-2.0-flash",
            ],
            analyze: [
                "gemini-1.5-flash",
                "gemini-1.5-pro", 
            ],
            generate: [
                "gemini-1.5-flash",
                "gemini-1.5-pro",
            ]
        };

        const modelsToTry = modelConfig[mode] || modelConfig.chat;
        let lastError;

        for (const modelName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                
                if (mode === 'analyze' && images && images.length > 0) {
                    // Image analysis mode
                    const imageParts = images.map(imgData => {
                        const mimeType = imgData.split(';')[0].split(':')[1];
                        return base64ToGenerativePart(imgData, mimeType);
                    });

                    const prompt = message 
                        ? `Analyze this image and: ${message}`
                        : "Describe this image in detail.";

                    const result = await model.generateContent([prompt, ...imageParts]);
                    const response = await result.response;
                    
                    return res.status(200).json({ 
                        text: response.text(),
                        modelUsed: modelName,
                        mode: 'analyze'
                    });

                } else if (mode === 'generate') {
                    // Image generation mode (text to image description)
                    const prompt = `Create a detailed description for an image based on: ${message}. 
                    Describe the visual elements, colors, composition, and style.`;
                    
                    const result = await model.generateContent(prompt);
                    const response = await result.response;
                    
                    return res.status(200).json({ 
                        text: `🎨 Image Description: ${response.text()}\n\nNote: For actual image generation, consider using dedicated image AI services.`,
                        modelUsed: modelName,
                        mode: 'generate'
                    });

                } else {
                    // Regular chat mode
                    let finalMessage = message;
                    let contents = [];

                    if (images && images.length > 0) {
                        // If images are provided in chat mode, include them
                        const imageParts = images.map(imgData => {
                            const mimeType = imgData.split(';')[0].split(':')[1];
                            return base64ToGenerativePart(imgData, mimeType);
                        });
                        
                        finalMessage = message || 'Please describe and analyze these images';
                        contents = [finalMessage, ...imageParts];
                    } else {
                        contents = [finalMessage];
                    }

                    const result = await model.generateContent(contents);
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
        
        // If all models failed
        throw lastError || new Error('All models failed');

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ 
            error: error.message,
            suggestion: 'Please check your API key and try again'
        });
    }
};
