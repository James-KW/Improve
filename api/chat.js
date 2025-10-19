const { GoogleGenerativeAI } = require('@google/generative-ai');

function base64ToGenerativePart(base64String, mimeType) {
    return {
        inlineData: {
            data: base64String.split(',')[1],
            mimeType: mimeType
        }
    };
}

// Gemini Models
const GEMINI_MODELS = [
    "gemini-2.0-flash-exp",
    "gemini-1.5-flash",
    "gemini-1.5-pro"
];

// Grok API for Backup
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
                    messages: [{ role: "user", content: message }],
                    model: "grok-beta",
                    stream: false,
                    temperature: 0.7
                }),
            }
        );

        if (!response.ok) throw new Error(`Grok API error: ${response.status}`);
        const data = await response.json();
        return { text: data.choices[0].message.content, modelUsed: 'grok-beta' };
    } catch (error) {
        console.error("Grok Error:", error);
        throw error;
    }
}

// Gemini for Chat & Image Analysis
async function chatWithGemini(message, images = []) {
    for (const modelName of GEMINI_MODELS) {
        try {
            console.log(`🔄 Trying Gemini model: ${modelName}`);
            
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ 
                model: modelName,
                generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                }
            });

            let contents = [];
            
            if (images.length > 0) {
                const imageParts = images.map(imgData => {
                    const mimeType = imgData.split(';')[0].split(':')[1];
                    return base64ToGenerativePart(imgData, mimeType);
                });
                contents = [message, ...imageParts];
            } else {
                contents = [message];
            }

            const result = await model.generateContent(contents);
            const response = await result.response;
            
            return { text: response.text(), modelUsed: modelName };
            
        } catch (error) {
            console.error(`❌ Gemini ${modelName} failed:`, error.message);
            if (error.message.includes('MODEL_NOT_FOUND') || 
                error.message.includes('not found') ||
                error.message.includes('404') ||
                error.message.includes('quota') || 
                error.message.includes('limit') || 
                error.message.includes('429')) {
                continue;
            }
            throw error;
        }
    }
    throw new Error('ALL_GEMINI_MODELS_FAILED');
}

// Improved Hugging Face Image Generation with Better Quality
async function generateWithHuggingFace(prompt) {
    try {
        console.log("🎨 Starting HIGH QUALITY image generation...");
        
        // Better models for quality
        const models = [
            {
                name: "black-forest-labs/FLUX.1-schnell",
                params: {
                    guidance_scale: 7.5,
                    num_inference_steps: 28,
                    width: 768,
                    height: 768
                }
            },
            {
                name: "stabilityai/stable-diffusion-xl-base-1.0", 
                params: {
                    guidance_scale: 7.5,
                    num_inference_steps: 30,
                    width: 1024,
                    height: 1024
                }
            },
            {
                name: "runwayml/stable-diffusion-v1-5",
                params: {
                    guidance_scale: 7.5,
                    num_inference_steps: 25,
                    width: 512,
                    height: 512
                }
            }
        ];

        for (let modelConfig of models) {
            try {
                console.log(`🎯 Trying model: ${modelConfig.name} with high quality settings`);
                
                const response = await fetch(
                    `https://api-inference.huggingface.co/models/${modelConfig.name}`,
                    {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({ 
                            inputs: prompt,
                            parameters: modelConfig.params
                        }),
                    }
                );

                console.log(`📊 Response status: ${response.status}`);

                if (response.status === 503) {
                    console.log(`⏳ Model loading, trying next...`);
                    continue;
                }

                if (!response.ok) {
                    console.log(`❌ Model failed: ${response.status}`);
                    continue;
                }

                const imageBlob = await response.blob();
                console.log(`✅ High quality image generated: ${imageBlob.size} bytes`);
                
                const arrayBuffer = await imageBlob.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const base64Image = `data:image/jpeg;base64,${buffer.toString('base64')}`;
                
                return base64Image;
            } catch (error) {
                console.log(`❌ Model ${modelConfig.name} error:`, error.message);
                continue;
            }
        }
        throw new Error("All image generation models failed");
    } catch (error) {
        console.error("❌ Image generation failed:", error);
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
        
        console.log("📨 Request:", { mode, message: message?.substring(0, 50), hasImages: images?.length > 0 });

        // IMAGE GENERATION
        if (mode === 'generate' && message) {
            try {
                console.log("🚀 Starting image generation...");
                const generatedImage = await generateWithHuggingFace(message);
                
                return res.status(200).json({
                    text: `IMAGE_GENERATED:${generatedImage}`,
                    message: "High quality image generated successfully!",
                    mode: 'generate',
                    success: true
                });
            } catch (error) {
                console.error("❌ Image generation failed:", error);
                return res.status(200).json({
                    text: `❌ Image generation failed: ${error.message}`,
                    mode: 'generate',
                    success: false
                });
            }
        }

        // IMAGE ANALYSIS
        else if (mode === 'analyze' && images && images.length > 0) {
            try {
                console.log("Starting image analysis...");
                const prompt = message 
                    ? `Analyze this image and: ${message}`
                    : "Describe this image in detail.";
                
                const result = await chatWithGemini(prompt, images);
                
                return res.status(200).json({ 
                    success: true,
                    text: result.text,
                    mode: 'analyze',
                    modelUsed: result.modelUsed
                });
            } catch (error) {
                if (error.message === 'ALL_GEMINI_MODELS_FAILED') {
                    try {
                        const grokResult = await chatWithGrok(
                            `Analyze this image request: "${message}". Provide helpful guidance.`
                        );
                        return res.status(200).json({ 
                            success: true,
                            text: `⚠️ Using Grok:\n\n${grokResult.text}`,
                            mode: 'analyze',
                            modelUsed: grokResult.modelUsed
                        });
                    } catch (grokError) {
                        return res.status(200).json({
                            success: false,
                            text: `❌ Analysis failed. Please try again.`
                        });
                    }
                }
                return res.status(200).json({
                    success: false,
                    text: `❌ Analysis failed: ${error.message}`
                });
            }
        }
        
        // TEXT CHAT
        else if (message) {
            try {
                console.log("Starting chat...");
                const result = await chatWithGemini(message);
                
                return res.status(200).json({ 
                    success: true,
                    text: result.text,
                    mode: 'chat',
                    modelUsed: result.modelUsed
                });
            } catch (error) {
                if (error.message === 'ALL_GEMINI_MODELS_FAILED') {
                    try {
                        const grokResult = await chatWithGrok(message);
                        return res.status(200).json({ 
                            success: true,
                            text: `⚠️ Using Grok:\n\n${grokResult.text}`,
                            mode: 'chat',
                            modelUsed: grokResult.modelUsed
                        });
                    } catch (grokError) {
                        return res.status(200).json({
                            success: false,
                            text: `❌ Chat failed. Please try again.`
                        });
                    }
                }
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
        console.error("💥 API Error:", error);
        return res.status(500).json({ 
            success: false,
            error: error.message
        });
    }
};
