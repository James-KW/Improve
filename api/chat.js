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

// Safety Check Function
async function checkPromptSafety(prompt) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
    
    const safetyCheckPrompt = `
Analyze this image generation prompt for safety:
"${prompt}"

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
      "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
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
            model: modelName,
            message: "Image generated with Gemini 🎨"
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
      model: 'FLUX.1-schnell',
      message: "Image generated with Hugging Face 🔄"
    };
  } catch (error) {
    throw new Error(`All image generation failed: ${error.message}`);
  }
}

// Gemini Image Editing Function - MULTILANGUAGE SUPPORT
async function editImageWithGemini(originalImage, editInstruction) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash-exp"
    });

    // MULTILANGUAGE PROMPT - understands any language
    const prompt = `
USER'S EDITING REQUEST (in any language): "${editInstruction}"

ORIGINAL IMAGE: [the uploaded image]

INSTRUCTIONS:
1. Understand the user's request in ANY language (English, Bengali, Hindi, etc.)
2. Edit the ORIGINAL image according to the request
3. Keep the main subject UNCHANGED (face, person, object)
4. Only modify what the user specifically requested
5. Return ONLY the edited image, no text

Common requests in different languages:
- "background change" / "background poriborton" / "पृष्ठभूमि बदलें"
- "add filter" / "filter add koro" / "फिल्टर जोड़ें" 
- "enhance quality" / "quality bariye deo" / "गुणवत्ता बढ़ाएं"
- "change color" / "color change koro" / "रंग बदलें"
- "remove object" / "object remove koro" / "वस्तु हटाएं"

EDIT THE IMAGE AS REQUESTED:
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
      throw new Error("Gemini did not return edited image");
    }

  } catch (error) {
    console.error("Gemini image editing failed:", error);
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
        
        return res.status(200).json({
          text: `IMAGE_GENERATED:${editedImage}`,
          message: "Image edited successfully! ✨",
          source: 'gemini_edit',
          mode: 'generate',
          mediaType: 'image',
          success: true
        });
        
      } catch (error) {
        console.error("Image editing failed:", error);
        return res.status(200).json({
          text: `❌ Image editing failed: ${error.message}. Please try different instruction.`,
          mode: 'generate',
          success: false
        });
      }
    }

    // IMAGE GENERATION MODE - When user only gives text (no image upload)
    else if (mode === 'generate' && message && mediaType === 'image') {
      try {
        console.log("🎨 Starting IMAGE GENERATION mode...");
        
        let finalPrompt = message;
        
        // Enhance prompt with Gemini (only for generation, not editing)
        console.log("Enhancing text prompt with Gemini...");
        const enhancementPrompt = `
User wants to generate an image with this description: "${message}"

Create an improved, detailed prompt for image generation.

Return ONLY the improved prompt, nothing else.
`;
        const enhancedPrompt = await callGeminiAPI(enhancementPrompt, null, "chat", "image");
        finalPrompt = enhancedPrompt.trim();
        console.log("Enhanced prompt:", finalPrompt);

        // Generate image with SMART ROTATION SYSTEM
        console.log("Generating image...");
        const generationResult = await generateImageSmart(finalPrompt);
        
        return res.status(200).json({
          text: `IMAGE_GENERATED:${generationResult.image}`,
          message: generationResult.message,
          source: generationResult.source,
          model: generationResult.model,
          mode: 'generate',
          mediaType: 'image',
          success: true
        });
        
      } catch (error) {
        console.error("Image generation failed:", error);
        return res.status(200).json({
          text: `❌ Image generation failed: ${error.message}`,
          mode: 'generate',
          success: false
        });
      }
    }

    // Image Analysis with Gemini
    else if (images && images.length > 0) {
      try {
        let prompt;
        if (message) {
          prompt = `Analyze this image: ${message}`;
        } else {
          prompt = `Describe this image in detail`;
        }
        
        console.log("Starting Gemini image analysis...");
        const analysis = await callGeminiAPI(prompt, images, "analyze", "image");
        
        return res.status(200).json({
          text: analysis,
          mode: 'analyze',
          success: true
        });
        
      } catch (error) {
        console.error("Gemini Image Analysis Error:", error);
        return res.status(200).json({
          text: `❌ Image analysis failed: ${error.message}`,
          mode: 'analyze', 
          success: false
        });
      }
    }

    // Text Chat with Gemini
    else if (message) {
      try {
        console.log("Starting Gemini chat...");
        const response = await callGeminiAPI(message, null, "chat", "text");
        
        return res.status(200).json({
          text: response,
          mode: 'chat',
          success: true
        });
        
      } catch (error) {
        console.error("Gemini Chat Error:", error);
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
