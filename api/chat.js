const { GoogleGenerativeAI } = require('@google/generative-ai');

function base64ToGenerativePart(base64String, mimeType) {
  return {
    inlineData: {
      data: base64String.split(',')[1],
      mimeType: mimeType
    }
  };
}

// Smart Model Rotation System - ALL MODELS INCLUDED
class ModelManager {
  constructor() {
    this.models = [
      // ALL Text Models (For Chat & Image Analysis)
      { name: "gemini-2.0-flash-lite", type: "text", priority: 1 },
      { name: "gemini-2.0-flash", type: "text", priority: 2 },
      { name: "gemini-2.5-flash", type: "text", priority: 3 },
      { name: "gemini-2.0-flash-exp", type: "text", priority: 4 },
      { name: "gemini-2.5-pro", type: "text", priority: 5 },
      { name: "gemini-2.5-flash-lite", type: "text", priority: 6 },
      { name: "learnlm-2.0-flash-experimental", type: "text", priority: 7 },
      
      // ALL Image Generation Models
      { name: "imagen-3.0-generate", type: "image_generate", priority: 1 },
      { name: "gemini-2.0-flash-preview-image-generation", type: "image_generate", priority: 2 },
      
      // ALL Live Models (Unlimited Quota)
      { name: "gemini-2.0-flash-live", type: "text", priority: 8 },
      { name: "gemini-2.5-flash-live", type: "text", priority: 9 },
      { name: "gemini-2.5-flash-native-audio-dialog", type: "text", priority: 10 },
      
      // ALL Gemma Models (Backup)
      { name: "gemma-3-27b", type: "text", priority: 11 },
      { name: "gemma-3-12b", type: "text", priority: 12 },
      { name: "gemma-3-4b", type: "text", priority: 13 },
      { name: "gemma-3-2b", type: "text", priority: 14 },
      { name: "gemma-3-1b", type: "text", priority: 15 },
      
      // Other Models
      { name: "gemini-robotics-er-1.5-preview", type: "text", priority: 16 }
    ];
    
    this.failedModels = new Set();
    this.modelUsage = new Map();
  }

  getBestModel(type = "text") {
    const availableModels = this.models
      .filter(model => model.type === type && !this.failedModels.has(model.name))
      .sort((a, b) => a.priority - b.priority);

    if (availableModels.length === 0) {
      this.failedModels.clear();
      return this.models.find(model => model.type === type);
    }

    return availableModels[0];
  }

  markModelFailed(modelName) {
    this.failedModels.add(modelName);
    console.log(`Model ${modelName} marked as failed. Available: ${this.models.length - this.failedModels.size}`);
  }

  markModelSuccess(modelName) {
    this.failedModels.delete(modelName);
  }
}

const modelManager = new ModelManager();

// Generate message in USER'S LANGUAGE
async function generateImageMessage(userPrompt, actionType, source) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

    let messagePrompt;
    
    if (actionType === 'editing') {
      messagePrompt = `
User requested image editing in their own language: "${userPrompt}"

FIRST: Detect which language the user is using.

THEN: Generate a SHORT, friendly success message in THE SAME LANGUAGE as the user's request.
The message should:
- Confirm the edit was successful  
- Be warm and engaging
- Use emoji if appropriate
- Be 1 line maximum
- Sound natural in the detected language

Respond ONLY in the detected language.
`;
    } else {
      messagePrompt = `
User requested image generation in their own language: "${userPrompt}"

FIRST: Detect which language the user is using.

THEN: Generate a SHORT, friendly success message in THE SAME LANGUAGE as the user's request.
The message should:
- Celebrate the created image
- Be exciting and positive
- Use emoji if appropriate
- Be 1 line maximum  
- Sound natural in the detected language

Respond ONLY in the detected language.
`;
    }

    const result = await model.generateContent(messagePrompt);
    let message = result.response.text().trim();
    
    return message;
    
  } catch (error) {
    console.error("Message generation failed, using universal message");
    return actionType === 'editing' 
      ? "✅ Edit successful!" 
      : "🎨 Image created successfully!";
  }
}

// Safety Check Function - Multilingual
async function checkPromptSafety(prompt) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
    
    const safetyCheckPrompt = `
Analyze this image generation prompt in any language: "${prompt}"

Respond ONLY with "SAFE" or "UNSAFE". No explanations.
`;
    
    const result = await model.generateContent(safetyCheckPrompt);
    const response = result.response.text().trim().toUpperCase();
    
    return response === "SAFE";
  } catch (error) {
    return false;
  }
}

// Hugging Face Image Generation (Fallback)
async function generateWithHuggingFace(prompt) {
  try {
    if (!process.env.HUGGINGFACE_API_KEY) {
      throw new Error("Hugging Face API Key not configured");
    }

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
          parameters: { width: 768, height: 768, num_inference_steps: 20 }
        }),
      }
    );

    if (!response.ok) throw new Error(`HuggingFace error: ${response.status}`);

    const imageBlob = await response.blob();
    const arrayBuffer = await imageBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (error) {
    throw error;
  }
}

// Gemini Image Generation (Primary)
async function generateWithGeminiModel(prompt, modelName) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: modelName });
    
    const result = await model.generateContent(prompt);
    
    if (result.response?.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
      const imageData = result.response.candidates[0].content.parts[0].inlineData.data;
      return `data:image/png;base64,${imageData}`;
    }
    
    const responseText = result.response.text();
    if (responseText.includes('base64') || responseText.startsWith('data:image')) {
      return responseText;
    }
    
    throw new Error("No image data received from Gemini");
  } catch (error) {
    throw error;
  }
}

// SMART ROTATION SYSTEM - Gemini First, Hugging Face Fallback
async function generateImageSmart(prompt) {
  const isSafeForGemini = await checkPromptSafety(prompt);
  
  if (isSafeForGemini) {
    const geminiModels = ["imagen-3.0-generate", "gemini-2.0-flash-preview-image-generation"];
    
    for (const modelName of geminiModels) {
      try {
        const image = await generateWithGeminiModel(prompt, modelName);
        if (image) {
          return { 
            image, 
            source: 'gemini', 
            model: modelName
          };
        }
      } catch (error) {
        console.log(`Gemini ${modelName} failed:`, error.message);
      }
    }
  }
  
  try {
    const image = await generateWithHuggingFace(prompt);
    return { 
      image, 
      source: 'huggingface', 
      model: 'FLUX.1-schnell'
    };
  } catch (error) {
    throw new Error(`All image generation failed: ${error.message}`);
  }
}

// MULTILINGUAL Image Editing Function 
async function editImageWithGemini(originalImage, editInstruction) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash-exp"
    });

    // MULTILINGUAL PROMPT - understands any language
    const prompt = `
ORIGINAL IMAGE: [the uploaded image]
USER EDITING REQUEST (in any language): "${editInstruction}"

INSTRUCTIONS (understand any language):
1. EDIT THE ORIGINAL IMAGE - do not create new image from text
2. Keep MAIN SUBJECT completely UNCHANGED (face, person, objects)
3. Only modify what user specifically requested
4. Maintain original image quality and style
5. Understand the user's request in ANY language

COMMON REQUESTS IN ANY LANGUAGE:
- Background change / পরিবর্তন / changement d'arrière-plan / 背景変更
- Add filter / ফিল্টার যোগ / agregar filtro / フィルター追加  
- Enhance quality / গুণমান উন্নত / mejorar calidad / 品質向上
- Change color / রঙ পরিবর্তন / cambiar color / 色変更
- Remove object / বস্তু সরান / eliminar objeto / オブジェクト削除

EDIT THE IMAGE AS REQUESTED:
RETURN ONLY THE EDITED IMAGE DATA - no text.
`;

    const imagePart = {
      inlineData: {
        data: originalImage.split(',')[1],
        mimeType: "image/png"
      }
    };

    const result = await model.generateContent([prompt, imagePart]);
    const response = result.response;

    if (response.candidates && response.candidates[0].content.parts[0].inlineData) {
      const editedImageData = response.candidates[0].content.parts[0].inlineData.data;
      return `data:image/png;base64,${editedImageData}`;
    } else {
      throw new Error("Editing failed - no image returned");
    }

  } catch (error) {
    console.error("Gemini image editing failed:", error);
    throw error;
  }
}

// MULTILINGUAL Prompt Enhancement
async function enhancePromptMultilingual(userPrompt) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

    const enhancementPrompt = `
User wants to generate an image. Their description in their own language: "${userPrompt}"

INSTRUCTIONS:
1. Understand the user's request in ANY language
2. Create an improved, detailed prompt for image generation in ENGLISH
3. Keep the original meaning and intent
4. Make it suitable for AI image generation with good results
5. Add specific details about appearance, style, setting, lighting, mood

Return ONLY the improved English prompt, nothing else.
`;

    const result = await model.generateContent(enhancementPrompt);
    const enhancedPrompt = result.response.text().trim();
    return enhancedPrompt;
    
  } catch (error) {
    console.error("Prompt enhancement failed, using original");
    return userPrompt;
  }
}

// MULTILINGUAL Image Analysis
async function analyzeImageMultilingual(images, userMessage = "") {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    let prompt;
    if (userMessage) {
      prompt = `
User request in their language: "${userMessage}"

Analyze the image and respond to the user's request.
Respond in THE SAME LANGUAGE as the user's request.
`;
    } else {
      prompt = `
Describe this image in comprehensive detail.
Respond in English unless you detect another language from context.
Include:
- Main subjects and objects
- Colors and visual style  
- Composition and setting
- Overall context and mood
`;
    }

    const imageParts = images.map(imgData => {
      const mimeType = imgData.split(';')[0].split(':')[1];
      return base64ToGenerativePart(imgData, mimeType);
    });

    const result = await model.generateContent([prompt, ...imageParts]);
    const response = result.response.text();
    return response;
    
  } catch (error) {
    throw error;
  }
}

// Smart Gemini API Call with Model Rotation
async function callGeminiAPI(prompt, images = null, mode = "chat", mediaType = "image") {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  let lastError = null;
  
  let modelType = "text";
  if (mode === "generate" && mediaType === "image") {
    modelType = "image_generate";
  } else {
    modelType = "text";
  }
  
  for (let attempt = 0; attempt < 5; attempt++) {
    const modelInfo = modelManager.getBestModel(modelType);
    if (!modelInfo) throw new Error("No available models");
    
    const modelName = modelInfo.name;
    
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      
      let result;
      if (images && images.length > 0 && modelType === "text") {
        const imageParts = images.map(imgData => {
          const mimeType = imgData.split(';')[0].split(':')[1];
          return base64ToGenerativePart(imgData, mimeType);
        });
        result = await model.generateContent([prompt, ...imageParts]);
      } else {
        result = await model.generateContent(prompt);
      }
      
      const response = await result.response;
      modelManager.markModelSuccess(modelName);
      return response.text();
      
    } catch (error) {
      modelManager.markModelFailed(modelName);
      lastError = error;
      
      if (!error.message.includes('429') && !error.message.includes('quota') && !error.message.includes('Quota')) {
        throw error;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  throw lastError || new Error("All models failed");
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { message, images, mode, mediaType = 'image' } = req.body;
    console.log("Request:", { mode, mediaType, message: message?.substring(0, 50), imageCount: images?.length });

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Gemini API Key not configured' });
    }

    // Video Generation - Temporarily Disabled
    if (mode === 'generate' && message && mediaType === 'video') {
      return res.status(200).json({
        text: "🎥 Video generation is temporarily unavailable. Please use image generation for now.",
        mode: 'generate',
        success: false
      });
    }

    // IMAGE EDITING MODE - When user uploads image + gives editing instruction
    if (mode === 'generate' && message && images && images.length > 0) {
      try {
        console.log("🖼️ Starting IMAGE EDITING mode...");
        
        // Use first uploaded image for editing
        const originalImage = images[0];
        
        console.log("Editing image with instruction:", message);
        const editedImage = await editImageWithGemini(originalImage, message);
        const successMessage = await generateImageMessage(message, 'editing', 'gemini');
        
        return res.status(200).json({
          text: `IMAGE_GENERATED:${editedImage}`,
          message: successMessage,
          source: 'gemini_edit',
          mode: 'generate',
          mediaType: 'image',
          success: true
        });
        
      } catch (error) {
        console.error("Image editing failed:", error);
        const errorMessage = await generateImageMessage(message, 'editing', 'error');
        return res.status(200).json({
          text: `❌ Image editing failed: ${error.message}`,
          message: errorMessage,
          mode: 'generate',
          success: false
        });
      }
    }

    // IMAGE GENERATION MODE - When user only gives text (no image upload)
    else if (mode === 'generate' && message && mediaType === 'image') {
      try {
        console.log("🎨 Starting IMAGE GENERATION mode...");
        
        // Enhance prompt in multilingual way
        console.log("Enhancing multilingual prompt...");
        const finalPrompt = await enhancePromptMultilingual(message);
        console.log("Enhanced prompt:", finalPrompt);

        // Generate image with SMART ROTATION SYSTEM
        console.log("Generating image...");
        const generationResult = await generateImageSmart(finalPrompt);
        const successMessage = await generateImageMessage(message, 'generation', generationResult.source);
        
        return res.status(200).json({
          text: `IMAGE_GENERATED:${generationResult.image}`,
          message: successMessage,
          source: generationResult.source,
          model: generationResult.model,
          mode: 'generate',
          mediaType: 'image',
          success: true
        });
        
      } catch (error) {
        console.error("Image generation failed:", error);
        const errorMessage = await generateImageMessage(message, 'generation', 'error');
        return res.status(200).json({
          text: `❌ Image generation failed: ${error.message}`,
          message: errorMessage,
          mode: 'generate',
          success: false
        });
      }
    }

    // MULTILINGUAL IMAGE ANALYSIS
    else if (images && images.length > 0) {
      try {
        console.log("Starting MULTILINGUAL image analysis...");
        const analysis = await analyzeImageMultilingual(images, message);
        
        return res.status(200).json({
          text: analysis,
          mode: 'analyze',
          success: true
        });
        
      } catch (error) {
        console.error("Image Analysis Error:", error);
        return res.status(200).json({
          text: `❌ Image analysis failed: ${error.message}`,
          mode: 'analyze', 
          success: false
        });
      }
    }

    // MULTILINGUAL TEXT CHAT
    else if (message) {
      try {
        console.log("Starting MULTILINGUAL chat...");
        
        // Use Gemini to respond in user's language
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
        
        const chatPrompt = `
User message in their language: "${message}"

Respond to the user in THE SAME LANGUAGE as their message.
Be helpful, friendly, and natural in the detected language.
`;
        
        const result = await model.generateContent(chatPrompt);
        const response = result.response.text();
        
        return res.status(200).json({
          text: response,
          mode: 'chat',
          success: true
        });
        
      } catch (error) {
        console.error("Chat Error:", error);
        return res.status(200).json({
          text: `❌ Chat failed: ${error.message}`,
          mode: 'chat',
          success: false
        });
      }
    }

    else {
      return res.status(400).json({ error: 'Message or image is required' });
    }
    
  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: `Internal server error: ${error.message}` });
  }
};
