const { GoogleGenerativeAI } = require('@google/generative-ai');

function base64ToGenerativePart(base64String, mimeType) {
    return {
        inlineData: {
            data: base64String.split(',')[1],
            mimeType: mimeType
        }
    };
}

// Available Gemini Models (Priority Order)
const GEMINI_MODELS = [
    "gemini-2.5-flash-exp",    // Highest priority - Fast & Efficient
    "gemini-2.5-pro-exp",      // Second priority - High Quality
    "gemini-2.0-flash-exp",    // Fallback 1
    "gemini-1.5-flash"         // Fallback 2
];

// Grok API for Backup when all Gemini models fail
async function chatWithGrok(message) {
    try {
        const response = await fetch(
            "https://api.x.ai/v1/chat/completions",
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.GROK_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    messages: [
                        {
                            role: "user",
                            content: message
                        }
                    ],
                    model: "grok-beta",
                    stream: false,
                    temperature: 0.7
                }),
            }
        );

        if (!response.ok) {
            throw new Error(`Grok API error: ${response.status}`);
        }

        const data = await response.json();
        return {
            text: data.choices[0].message.content,
            modelUsed: 'grok-beta'
        };
    } catch (error) {
        console.error("Grok Error:", error);
        throw error;
    }
}

// Gemini with Multiple Model Fallback
async function chatWithGemini(message, images = []) {
    let lastError = null;
    
    // Try all Gemini models in order
    for (const modelName of GEMINI_MODELS) {
        try {
            console.log(`Trying Gemini model: ${modelName}`);
            
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ 
                model: modelName
            });

            let contents = [];
            
            if (images.length > 0) {
                // Image analysis mode
                const imageParts = images.map(imgData => {
                    const mimeType = imgData.split(';')[0].split(':')[1];
                    return base64ToGenerativePart(imgData, mimeType);
                });
                contents = [message, ...imageParts];
            } else {
                // Text chat mode
                contents = [message];
            }

            const result = await model.generateContent(contents);
            const response = await result.response;
            
            console.log(`Success with model: ${modelName}`);
            return {
                text: response.text(),
                modelUsed: modelName
            };
            
        } catch (error) {
            console.error(`Gemini model ${modelName} failed:`, error.message);
            lastError = error;
            
            // Check if it's a quota exceeded or model not found error - try next model
            if (error.message.includes('quota') || error.message.includes('limit') || 
                error.message.includes('429') || error.message.includes('not found') ||
                error.message.includes('unavailable')) {
                console.log(`Model ${modelName} unavailable, trying next...`);
                continue; // Try next model
            }
            
            // For other errors, throw immediately
            throw error;
        }
    }
    
    // All Gemini models failed
    throw new Error('ALL_GEMINI_MODELS_FAILED');
}

// Hugging Face - Stable Diffusion (Image Generation)
async function generateWithStableDiffusion(prompt) {
    try {
        const response = await fetch(
            "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0",
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ 
                    inputs: prompt,
                    parameters: { 
                        width: 512, 
                        height: 512,
                        num_inference_steps: 20
                    }
                }),
            }
        );

        if (response.status === 503) {
            throw new Error("Model is loading, please try again in 20-30 seconds");
        }

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Hugging Face API error: ${response.status}`);
        }

        const imageBlob = await response.blob();
        const arrayBuffer = await imageBlob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        return `data:image/jpeg;base64,${buffer.toString('base64')}`;
    } catch (error) {
        console.error("Stable Diffusion Error:", error);
        throw error;
    }
}

// Hugging Face - FLUX.1 (Better Quality)
async function generateWithFlux(prompt) {
    try {
        const response = await fetch(
            "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell",
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ 
                    inputs: prompt,
                    parameters: { 
                        width: 512, 
                        height: 512,
                        guidance_scale: 7.5
                    }
                }),
            }
        );

        if (response.status === 503) {
            throw new Error("FLUX model is loading, please try again in 30 seconds");
        }

        if (!response.ok) {
            throw new Error(`FLUX.1 error: ${response.status}`);
        }

        const imageBlob = await response.blob();
        const arrayBuffer = await imageBlob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        return `data:image/jpeg;base64,${buffer.toString('base64')}`;
    } catch (error) {
        console.error("FLUX.1 Error:", error);
        throw error;
    }
}

// Simple & Fast Model (Fallback)
async function generateWithSimpleModel(prompt) {
    try {
        const response = await fetch(
            "https://api-inference.huggingface.co/models/runwayml/stable-diffusion-v1-5",
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ 
                    inputs: prompt
                }),
            }
        );

        if (response.status === 503) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            return generateWithSimpleModel(prompt);
        }

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const imageBlob = await response.blob();
        const arrayBuffer = await imageBlob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        return `data:image/png;base64,${buffer.toString('base64')}`;
    } catch (error) {
        console.error("Simple Model Error:", error);
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
        const { message, images, mode, mediaType = 'image', imageModel = 'flux' } = req.body;
        
        console.log("Request:", { mode, mediaType, imageModel, message: message?.substring(0, 50) });

        // Image Generation with Hugging Face
        if (mode === 'generate' && message && mediaType === 'image') {
            try {
                console.log(`Starting ${imageModel} image generation with Hugging Face...`);
                let generatedImage;

                // Try multiple models with fallback
                try {
                    if (imageModel === 'flux') {
                        generatedImage = await generateWithFlux(message);
                    } else if (imageModel === 'stable') {
                        generatedImage = await generateWithStableDiffusion(message);
                    } else {
                        generatedImage = await generateWithSimpleModel(message);
                    }
                } catch (primaryError) {
                    console.log("Primary model failed, trying fallback...");
                    generatedImage = await generateWithSimpleModel(message);
                }

                return res.status(200).json({
                    text: `IMAGE_GENERATED:${generatedImage}`,
                    message: `Image generated with ${imageModel.toUpperCase()}! (Hugging Face)`,
                    mode: 'generate',
                    mediaType: 'image',
                    modelUsed: imageModel,
                    success: true
                });
            } catch (error) {
                console.error("Image generation failed:", error);
                return res.status(200).json({
                    text: `❌ Image generation failed: ${error.message}. Try again later.`,
                    mode: 'generate',
                    success: false
                });
            }
        }

        // Image Analysis with Gemini 2.5 Models (Primary) -> Grok (Backup)
        else if (images && images.length > 0) {
            try {
                console.log("Starting image analysis with Gemini 2.5 models...");
                const prompt = message 
                    ? `Analyze this image and: ${message}`
                    : "Describe this image in detail including subjects, background, colors, lighting, and overall impression.";
                
                const result = await chatWithGemini(prompt, images);
                
                return res.status(200).json({ 
                    success: true,
                    text: result.text,
                    mode: 'analyze',
                    modelUsed: result.modelUsed
                });
            } catch (error) {
                if (error.message === 'ALL_GEMINI_MODELS_FAILED') {
                    console.log("All Gemini models failed, switching to Grok for image analysis...");
                    try {
                        const grokResult = await chatWithGrok(
                            `Analyze this image description request: "${message}". I cannot see the image but based on the user's request, provide helpful analysis guidance.`
                        );
                        return res.status(200).json({ 
                            success: true,
                            text: `⚠️ All Gemini models unavailable. Using Grok instead:\n\n${grokResult.text}`,
                            mode: 'analyze',
                            modelUsed: grokResult.modelUsed
                        });
                    } catch (grokError) {
                        return res.status(200).json({
                            success: false,
                            text: `❌ All AI models failed for image analysis. Please try again later.`
                        });
                    }
                }
                
                console.error("Image analysis failed:", error);
                return res.status(200).json({
                    success: false,
                    text: `❌ Image analysis failed: ${error.message}`
                });
            }
        }
        
        // Text Chat - Gemini 2.5 Models (Primary) -> Grok (Backup)
        else if (message) {
            try {
                console.log("Starting chat with Gemini 2.5 models...");
                const result = await chatWithGemini(message);
                
                return res.status(200).json({ 
                    success: true,
                    text: result.text,
                    mode: 'chat',
                    modelUsed: result.modelUsed
                });
            } catch (error) {
                if (error.message === 'ALL_GEMINI_MODELS_FAILED') {
                    console.log("All Gemini models failed, switching to Grok for chat...");
                    try {
                        const grokResult = await chatWithGrok(message);
                        return res.status(200).json({ 
                            success: true,
                            text: `⚠️ All Gemini models unavailable. Using Grok instead:\n\n${grokResult.text}`,
                            mode: 'chat',
                            modelUsed: grokResult.modelUsed
                        });
                    } catch (grokError) {
                        return res.status(200).json({
                            success: false,
                            text: `❌ All AI models failed. Please try again later.`
                        });
                    }
                }
                
                console.error("Chat failed:", error);
                return res.status(200).json({
                    success: false,
                    text: `❌ Chat failed: ${error.message}`
                });
            }
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
