const { GoogleGenerativeAI } = require('@google/generative-ai');

function base64ToGenerativePart(base64String, mimeType) {
    return {
        inlineData: {
            data: base64String.split(',')[1],
            mimeType: mimeType
        }
    };
}

// Available Gemini Models
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

// Gemini with Multiple Model Fallback
async function chatWithGemini(message, images = []) {
    for (const modelName of GEMINI_MODELS) {
        try {
            console.log(`Trying Gemini model: ${modelName}`);
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: modelName });

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
            console.error(`Gemini ${modelName} failed:`, error.message);
            if (error.message.includes('quota') || error.message.includes('limit') || error.message.includes('429')) continue;
            throw error;
        }
    }
    throw new Error('ALL_GEMINI_MODELS_FAILED');
}

// Hugging Face Image Generation
async function generateWithHuggingFace(prompt) {
    try {
        console.log("🔄 Starting Hugging Face image generation...");
        
        const models = [
            "runwayml/stable-diffusion-v1-5",
            "stabilityai/stable-diffusion-xl-base-1.0"
        ];

        for (let model of models) {
            try {
                console.log(`🎯 Trying model: ${model}`);
                
                const response = await fetch(
                    `https://api-inference.huggingface.co/models/${model}`,
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
                console.log(`✅ Image generated: ${imageBlob.size} bytes`);
                
                const arrayBuffer = await imageBlob.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const base64Image = `data:image/jpeg;base64,${buffer.toString('base64')}`;
                
                return base64Image;
            } catch (error) {
                console.log(`❌ Model ${model} error:`, error.message);
                continue;
            }
        }
        throw new Error("All Hugging Face models failed");
    } catch (error) {
        console.error("❌ Hugging Face generation failed:", error);
        throw error;
    }
}

// Image Recreation based on uploaded image
async function recreateImageFromReference(message, referenceImages) {
    try {
        // First, analyze the reference image with Gemini
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const imageParts = referenceImages.map(imgData => {
            const mimeType = imgData.split(';')[0].split(':')[1];
            return base64ToGenerativePart(imgData, mimeType);
        });

        const analysisPrompt = `Analyze this image and describe it in detail including: 
        - Main subjects and objects
        - Colors and color scheme
        - Style and composition
        - Lighting and mood
        - Any distinctive features
        
        Be very descriptive for image generation purposes.`;

        const result = await model.generateContent([analysisPrompt, ...imageParts]);
        const analysis = await result.response;
        
        console.log("📝 Image analysis:", analysis.text());
        
        // Create enhanced prompt for generation
        const enhancedPrompt = `${message}. Based on this reference image: ${analysis.text()}`;
        
        // Generate new image using Hugging Face
        const generatedImage = await generateWithHuggingFace(enhancedPrompt);
        
        return {
            image: generatedImage,
            analysis: analysis.text(),
            promptUsed: enhancedPrompt
        };
    } catch (error) {
        console.error("Image recreation failed:", error);
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

        // ✅ IMAGE GENERATION - With or without reference images
        if (mode === 'generate' && message) {
            try {
                console.log("🚀 Starting image generation...");
                
                let result;
                
                if (images && images.length > 0) {
                    // Image recreation based on uploaded reference
                    console.log("🎨 Generating image with reference...");
                    const recreationResult = await recreateImageFromReference(message, images);
                    result = {
                        text: `IMAGE_GENERATED:${recreationResult.image}`,
                        message: "Image recreated based on reference!",
                        analysis: recreationResult.analysis,
                        success: true
                    };
                } else {
                    // Direct image generation from text
                    console.log("🎨 Generating image from text...");
                    const generatedImage = await generateWithHuggingFace(message);
                    result = {
                        text: `IMAGE_GENERATED:${generatedImage}`,
                        message: "Image generated successfully!",
                        success: true
                    };
                }
                
                return res.status(200).json({
                    ...result,
                    mode: 'generate',
                    hadReference: images && images.length > 0
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

        // ✅ IMAGE ANALYSIS - Gemini
        else if (mode === 'analyze' && images && images.length > 0) {
            try {
                console.log("Starting image analysis with Gemini...");
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
                            `Analyze this image request: "${message}". Provide helpful analysis guidance.`
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
        
        // ✅ TEXT CHAT - Gemini
        else if (message) {
            try {
                console.log("Starting chat with Gemini...");
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
