const { GoogleGenerativeAI } = require('@google/generative-ai');

function base64ToGenerativePart(base64String, mimeType) {
    return {
        inlineData: {
            data: base64String.split(',')[1],
            mimeType: mimeType
        }
    };
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { message, images, mode } = req.body;
        
        if (!message || !images || images.length === 0) {
            return res.status(400).json({ error: 'Both message and image are required for editing' });
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        
        const modelsToTry = [
            "gemini-2.0-flash-exp",
            "gemini-2.5-flash-exp", 
            "gemini-2.0-flash",
            "gemini-1.5-flash"
        ];

        let lastError;

        for (const modelName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                
                const imageParts = images.map(imgData => {
                    const mimeType = imgData.split(';')[0].split(':')[1];
                    return base64ToGenerativePart(imgData, mimeType);
                });

                // Enhanced prompt for image editing instructions
                const prompt = `
                IMAGE EDITING REQUEST: ${message}
                
                Please analyze the uploaded image and provide detailed, step-by-step instructions on how to edit/modify the image according to the request. Include:
                
                1. WHAT needs to be changed specifically
                2. HOW to make the changes (technical steps)
                3. TOOLS or software that could be used
                4. Expected RESULT after editing
                
                Be very specific and practical in your instructions.
                `;

                const result = await model.generateContent([prompt, ...imageParts]);
                const response = await result.response;
                
                return res.status(200).json({ 
                    text: `📝 IMAGE EDITING INSTRUCTIONS:\n\n${response.text()}`,
                    modelUsed: modelName,
                    mode: 'edit'
                });

            } catch (error) {
                console.log(`Model ${modelName} failed:`, error.message);
                lastError = error;
                continue;
            }
        }
        
        throw lastError;

    } catch (error) {
        return res.status(500).json({ 
            error: error.message
        });
    }
};
