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

    try {
        const { message, images, mode } = req.body;
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        
        // Model configuration based on mode
        const modelConfig = {
            chat: [
                "gemini-2.5-pro-exp-03-25",
                "gemini-2.0-flash-exp", 
                "gemini-2.5-flash-exp",
                "gemini-2.0-flash-thinking",
            ],
            analyze: [
                "gemini-2.0-flash-exp", // Good for image analysis
                "gemini-2.5-pro-exp-03-25",
                "gemini-2.5-flash-exp",
            ],
            generate: [
                "gemini-2.0-flash-exp", // Supports image generation
                "gemini-2.5-flash-exp",
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
                        const mimeType = imgData.split(';')[0].split(':')[1]; // Extract MIME type
                        return base64ToGenerativePart(imgData, mimeType);
                    });

                    const prompt = message 
                        ? `Analyze this image and: ${message}`
                        : "Describe this image in detail, including objects, colors, scene, and any text present.";

                    const result = await model.generateContent([prompt, ...imageParts]);
                    const response = await result.response;
                    
                    return res.status(200).json({ 
                        text: response.text(),
                        modelUsed: modelName,
                        mode: 'analyze'
                    });

                } else if (mode === 'generate') {
                    // Image generation mode
                    if (!message) {
                        return res.status(400).json({ 
                            error: 'Please provide a description for image generation' 
                        });
                    }

                    // For Gemini 2.0 Flash that supports image generation
                    const prompt = `Generate an image based on this description: ${message}. 
                    Create a detailed, high-quality image that matches the description.`;
                    
                    const result = await model.generateContent(prompt);
                    const response = await result.response;
                    const text = response.text();

                    // Check if the response contains image data or is text-based
                    if (text.includes('![Image]') || text.includes('(image)')) {
                        // If model returns image reference, we'll handle it as text for now
                        // In production, you might want to use a dedicated image generation API
                        return res.status(200).json({ 
                            text: "I've generated an image based on your description. Currently I can describe what the image would look like. For actual image generation, you might want to use a dedicated image generation service.",
                            modelUsed: modelName,
                            mode: 'generate'
                        });
                    } else {
                        return res.status(200).json({ 
                            text: response.text(),
                            modelUsed: modelName,
                            mode: 'generate'
                        });
                    }

                } else {
                    // Regular chat mode
                    let finalMessage = message;
                    let contents = [];

                    if (images && images.length > 0) {
                        // If images are provided in chat mode, include them in the context
                        const imageParts = images.map(imgData => {
                            const mimeType = imgData.split(';')[0].split(':')[1];
                            return base64ToGenerativePart(imgData, mimeType);
                        });
                        
                        finalMessage = `Regarding these images: ${message || 'Please describe and analyze these images'}`;
                        contents = [finalMessage, ...imageParts];
                    } else {
                        contents = [finalMessage];
                    }

                    const result = await model.generateContent(contents);
                    const response = await result.response;
                    
                    return res.status(200).json({ 
                        text: response.text(),
                        modelUsed: modelName,
                        mode: 'chat'
                    });
                }

            } catch (error) {
                lastError = error;
                console.log(`Model ${modelName} failed:`, error.message);
                continue; // Try next model
            }
        }
        
        throw lastError;
    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ 
            error: error.message,
            suggestion: 'Please check your API key and model availability'
        });
    }
};
