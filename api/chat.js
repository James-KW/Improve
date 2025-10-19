const { GoogleGenerativeAI } = require('@google/generative-ai');

function base64ToGenerativePart(base64String, mimeType) {
  return {
    inlineData: {
      data: base64String.split(',')[1],
      mimeType: mimeType
    }
  };
}

// FLUX.1 Model - Better Quality Image Generation
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
            width: 768,
            height: 768,
            num_inference_steps: 20
          }
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`FLUX.1 error: ${errorText.substring(0, 100)}`);
    }

    const imageBlob = await response.blob();
    const arrayBuffer = await imageBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return `data:image/png;base64,${buffer.toString('base64')}`;
    
  } catch (error) {
    console.error("FLUX.1 Error:", error);
    // Fallback to Stable Diffusion if FLUX fails
    return await generateWithStableDiffusion(prompt);
  }
}

// Stable Diffusion - Backup Model
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
            height: 512
          }
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Stable Diffusion error: ${errorText.substring(0, 100)}`);
    }

    const imageBlob = await response.blob();
    const arrayBuffer = await imageBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return `data:image/png;base64,${buffer.toString('base64')}`;
    
  } catch (error) {
    console.error("Stable Diffusion Error:", error);
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
    const { message, images, mode, mediaType = 'image' } = req.body;
    
    console.log("Request:", { 
      mode, 
      mediaType,
      message: message?.substring(0, 50), 
      imageCount: images?.length 
    });

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ 
        error: 'Gemini API Key not configured' 
      });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

        const analysisModel = genAI.getGenerativeModel({ 
          model: "gemini-2.0-flash-exp"
        });

        let finalPrompt = message;
        
        // If user uploaded images, analyze them with Gemini
        if (images && images.length > 0) {
          console.log("Analyzing uploaded images with Gemini...");
          
          const imageParts = images.map(imgData => {
            const mimeType = imgData.split(';')[0].split(':')[1];
            return base64ToGenerativePart(imgData, mimeType);
          });
          
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
          
          const imageResult = await analysisModel.generateContent([imageAnalysisPrompt, ...imageParts]);
          const imageEnhancedPrompt = imageResult.response.text().trim();
          finalPrompt = imageEnhancedPrompt;
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
          
          const enhancementResult = await analysisModel.generateContent(enhancementPrompt);
          const enhancedPrompt = enhancementResult.response.text().trim();
          finalPrompt = enhancedPrompt;
          console.log("Enhanced prompt:", finalPrompt);
        }

        // Generate image with the AI-enhanced prompt
        console.log("Generating image with enhanced prompt...");
        const generatedImage = await generateWithFlux(finalPrompt);
        
        return res.status(200).json({ 
          text: `IMAGE_GENERATED:${generatedImage}`,
          message: `Image generated based on your request!`,
          mode: 'generate', 
          mediaType: 'image',
          success: true 
        });

      } catch (error) {
        console.error("AI-enhanced generation failed:", error);
        return res.status(200).json({ 
          text: `❌ Image generation failed: ${error.message}. Please try a different description.`,
          mode: 'generate', 
          success: false 
        });
      }
    }

    // Image Analysis with Gemini
    else if (images && images.length > 0) {
      try {
        const model = genAI.getGenerativeModel({ 
          model: "gemini-2.0-flash-exp"
        });

        const imageParts = images.map(imgData => {
          const mimeType = imgData.split(';')[0].split(':')[1];
          return base64ToGenerativePart(imgData, mimeType);
        });

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
        const result = await model.generateContent([prompt, ...imageParts]);
        const response = await result.response;
        
        console.log("Image analysis completed successfully");
        return res.status(200).json({ 
          text: response.text(), 
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
        const model = genAI.getGenerativeModel({ 
          model: "gemini-2.0-flash-exp"
        });

        console.log("Starting Gemini chat...");
        const result = await model.generateContent(message);
        const response = await result.response;
        
        console.log("Chat completed successfully");
        return res.status(200).json({ 
          text: response.text(), 
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
      return res.status(400).json({ 
        error: 'Message or image is required' 
      });
    }

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ 
      error: `Internal server error: ${error.message}` 
    });
  }
};
