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

// Stability AI Image Generation
async function generateWithStabilityAI(prompt) {
    try {
        const response = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.STABILITY_API_KEY}`,
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                prompt: prompt,
                output_format: 'png',
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Stability AI error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        return `data:image/png;base64,${data.image}`;
        
    } catch (error) {
        throw error;
    }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { message, images, mode } = req.body;
        
        console.log("Request:", { mode, message: message?.substring(0, 50), imageCount: images?.length });

        // Real Image Generation with Stability AI
        if (mode === 'generate' && message) {
            try {
                console.log("Starting Stability AI image generation...");
                
                let finalPrompt = message;
                
                // If user uploaded image + text, enhance the prompt
                if (images && images.length > 0) {
                    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                    
                    const imageParts = images.map(imgData => {
                        const mimeType = imgData.split(';')[0].split(':')[1];
                        return base64ToGenerativePart(imgData, mimeType);
                    });

                    const analysisPrompt = `Describe this image in detail, then create a modified version with: ${message}. Be very specific about the changes.`;
                    const result = await model.generateContent([analysisPrompt, ...imageParts]);
                    const analysis = result.response.text();
                    
                    finalPrompt = `Create an image based on: ${analysis}. Modification requested: ${message}`;
                }

                const generatedImage = await generateWithStabilityAI(finalPrompt);
                
                return res.status(200).json({
                    success: true,
                    text: `IMAGE_GENERATED:${generatedImage}`,
                    mode: 'generate'
                });
                
            } catch (error) {
                console.error("Stability AI generation failed:", error);
                return res.status(200).json({
                    success: false,
                    text: `❌ Image generation failed: ${error.message}. Please check your Stability AI API key.`,
                    mode: 'generate'
                });
            }
        }
        
        // Image Analysis with Gemini
        else if (images && images.length > 0) {
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
                success: true,
                text: response.text(),
                mode: 'analyze'
            });
        }
        
        // Text Chat with Gemini
        else if (message) {
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            
            const result = await model.generateContent(message);
            const response = await result.response;
            
            return res.status(200).json({ 
                success: true,
                text: response.text(),
                mode: 'chat'
            });
        }
        
        else {
            return res.status(400).json({ 
                success: false,
                error: 'Message or image is required'
            });
        }

    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({ 
            success: false,
            error: error.message
        });
    }
};
