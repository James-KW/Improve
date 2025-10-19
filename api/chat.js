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
      { name: "veo-2.0-generate-001", type: "image_generate", priority: 3 },
      
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
    // Filter by type and availability
    const availableModels = this.models
      .filter(model => model.type === type && !this.failedModels.has(model.name))
      .sort((a, b) => a.priority - b.priority);

    if (availableModels.length === 0) {
      // Reset failed models if all are down
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

// Gemini Native Image Generation Function
async function generateWithGemini(prompt) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  // Try different Gemini image models in order
  const imageModels = [
    "imagen-3.0-generate",
    "gemini-2.0-flash-preview-image-generation", 
    "veo-2.0-generate-001"
  ];
  
  for (const modelName of imageModels) {
    try {
      console.log(`Trying image generation with: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
      
      const result = await model.generateContent(prompt);
      
      // CORRECT way to get image from Gemini - handle different response formats
      if (result.response) {
        // Method 1: Check for inlineData in response
        if (result.response.candidates && 
            result.response.candidates[0] && 
            result.response.candidates[0].content && 
            result.response.candidates[0].content.parts && 
            result.response.candidates[0].content.parts[0] && 
            result.response.candidates[0].content.parts[0].inlineData) {
          
          const imageData = result.response.candidates[0].content.parts[0].inlineData.data;
          console.log(`✅ Image generated successfully with ${modelName}`);
          return `data:image/png;base64,${imageData}`;
        }
        
        // Method 2: Check if response has direct image data
        const responseText = result.response.text();
        if (responseText.includes('base64') || responseText.startsWith('data:image')) {
          console.log(`✅ Image generated successfully with ${modelName}`);
          return responseText;
        }
        
        // Method 3: If we get text but no image, maybe it's a description
        console.log(`Model ${modelName} returned text instead of image:`, responseText.substring(0, 100));
      }
      
    } catch (error) {
      console.log(`❌ ${modelName} failed:`, error.message);
      // Continue to next model
    }
  }
  
  throw new Error("All Gemini image models failed. Please try a different prompt or try again later.");
}

// Smart Gemini API Call with Model Rotation
async function callGeminiAPI(prompt, images = null, mode = "chat", mediaType = "image") {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  let lastError = null;
  
  // CORRECT Model Type Selection
  let modelType = "text";
  if (mode === "generate" && mediaType === "image") {
    modelType = "image_generate";  // ONLY for image generation
  } else {
    modelType = "text";  // Image analysis & chat use TEXT models
  }
  
  console.log(`Selected model type: ${modelType} for mode: ${mode}, mediaType: ${mediaType}`);
  
  // Try up to 5 different models
  for (let attempt = 0; attempt < 5; attempt++) {
    const modelInfo = modelManager.getBestModel(modelType);
    if (!modelInfo) {
      throw new Error("No available models for this task type");
    }
    
    const modelName = modelInfo.name;
    console.log(`Attempt ${attempt + 1}: Using model ${modelName} for ${modelType}`);
    
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      
      let result;
      if (images && images.length > 0 && modelType === "text") {
        // Image analysis with text models
        const imageParts = images.map(imgData => {
          const mimeType = imgData.split(';')[0].split(':')[1];
          return base64ToGenerativePart(imgData, mimeType);
        });
        result = await model.generateContent([prompt, ...imageParts]);
      } else {
        // Text generation or image generation
        result = await model.generateContent(prompt);
      }
      
      const response = await result.response;
      modelManager.markModelSuccess(modelName);
      console.log(`✅ Success with model: ${modelName}`);
      
      return response.text();
      
    } catch (error) {
      console.error(`❌ Model ${modelName} failed:`, error.message);
      modelManager.markModelFailed(modelName);
      lastError = error;
      
      // If it's not a quota error, stop retrying
      if (!error.message.includes('429') && !error.message.includes('quota') && !error.message.includes('Quota')) {
        throw error;
      }
      
      // Wait before retrying with next model
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
        text: "🎥 Video generation is temporarily unavailable. We're working on adding reliable free video generation soon! Please use image generation for now.",
        mode: 'generate',
        success: false
      });
    }

    // AI-Enhanced Image Generation with Gemini
    if (mode === 'generate' && message && mediaType === 'image') {
      try {
        console.log("Starting AI-enhanced image generation...");
        
        let finalPrompt = message;
        
        // If user uploaded images, analyze them with Gemini
        if (images && images.length > 0) {
          console.log("Analyzing uploaded images with Gemini...");
          const imageAnalysisPrompt = `
Analyze this reference image and understand what the user wants.
User's request: "${message}"

Create a detailed, enhanced prompt for image generation that:
1. Understands the visual style, person, or object in the reference image
2. Incorporates the user's modification request
3. Creates a detailed visual description suitable for AI image generation
4. Maintains the essence but creates something new and unique
5. Avoids copyright issues by being descriptive rather than using specific names

Return ONLY the enhanced prompt for image generation, nothing else.
`;
          const imageEnhancedPrompt = await callGeminiAPI(imageAnalysisPrompt, images, "analyze", "image");
          finalPrompt = imageEnhancedPrompt.trim();
          console.log("Image-enhanced prompt:", finalPrompt);
        } else {
          // No images - just enhance the text prompt
          console.log("Enhancing text prompt with Gemini...");
          const enhancementPrompt = `
User wants to generate an image with this description: "${message}"

Create an improved, detailed prompt for image generation that:
1. Understands the user's intent (even if they mention celebrities or specific styles)
2. Creates a detailed visual description without using copyrighted names
3. Includes specific details about appearance, style, setting, lighting, and mood
4. Makes it suitable for AI image generation with good results
5. If it's a person, describe their features, hair, eyes, clothing, expression
6. If it's a place/scene, describe the environment, colors, atmosphere

Return ONLY the improved prompt, nothing else.
`;
          const enhancedPrompt = await callGeminiAPI(enhancementPrompt, null, "chat", "image");
          finalPrompt = enhancedPrompt.trim();
          console.log("Enhanced prompt:", finalPrompt);
        }

        // Generate image with Gemini native models
        console.log("Generating image with Gemini native models...");
        const generatedImage = await generateWithGemini(finalPrompt);
        
        return res.status(200).json({
          text: `IMAGE_GENERATED:${generatedImage}`,
          message: `Image generated successfully using Gemini!`,
          mode: 'generate',
          mediaType: 'image',
          success: true
        });
        
      } catch (error) {
        console.error("AI-enhanced generation failed:", error);
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
          prompt = `Analyze this image carefully and: ${message}\n\nPlease provide detailed, accurate analysis.`;
        } else {
          prompt = `Describe this image in comprehensive detail. Include:
1. Main subjects and objects
2. Colors and visual style  
3. Composition and setting
4. Any text or symbols visible
5. Overall context and mood
6. Technical aspects like lighting and quality`;
        }
        
        console.log("Starting Gemini image analysis...");
        const analysis = await callGeminiAPI(prompt, images, "analyze", "image");
        console.log("Image analysis completed successfully");
        
        return res.status(200).json({
          text: analysis,
          mode: 'analyze',
          success: true
        });
        
      } catch (error) {
        console.error("Gemini Image Analysis Error:", error);
        return res.status(200).json({
          text: `❌ Image analysis failed: ${error.message}. Please try again with a clearer image.`,
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
        console.log("Chat completed successfully");
        
        return res.status(200).json({
          text: response,
          mode: 'chat',
          success: true
        });
        
      } catch (error) {
        console.error("Gemini Chat Error:", error);
        return res.status(200).json({
          text: `❌ Chat failed: ${error.message}. Please try again.`,
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
