const { GoogleGenerativeAI } = require('@google/generative-ai');

function base64ToGenerativePart(base64String, mimeType) {
  return {
    inlineData: {
      data: base64String.split(',')[1],
      mimeType: mimeType
    }
  };
}

// Gemini Nano Banana Image Generation
async function generateWithNanoBanana(prompt) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "nano-banana" });
    
    console.log("Generating image with Nano Banana...");
    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    // Nano Banana returns base64 image data
    if (response.candidates && response.candidates[0] && response.candidates[0].content && response.candidates[0].content.parts) {
      const imagePart = response.candidates[0].content.parts.find(part => part.inlineData);
      if (imagePart && imagePart.inlineData) {
        return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
      }
    }
    
    // Alternative response format check
    if (response.text().includes('data:image')) {
      return response.text();
    }
    
    throw new Error('No image data received from Nano Banana');
  } catch (error) {
    console.error("Nano Banana Generation Error:", error);
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
    
    console.log("Request:", { 
      mode, 
      message: message?.substring(0, 50), 
      imageCount: images?.length 
    });

    // Check if Gemini API Key is available
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ 
        error: 'Gemini API Key not configured' 
      });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // Image Generation with Nano Banana
    if (mode === 'generate' && message) {
      try {
        console.log("Starting Nano Banana image generation...");

        let finalPrompt = message;
        
        // If user uploaded image + text, enhance prompt using Gemini 2.0 Flash
        if (images && images.length > 0) {
          const analysisModel = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash-exp"
          });
          
          const imageParts = images.map(imgData => {
            const mimeType = imgData.split(';')[0].split(':')[1];
            return base64ToGenerativePart(imgData, mimeType);
          });
          
          const analysisPrompt = `Analyze this image in detail and suggest how to create a new image based on it with this modification: ${message}`;
          const result = await analysisModel.generateContent([analysisPrompt, ...imageParts]);
          const analysis = result.response.text();
          finalPrompt = `${message}. Based on this analysis: ${analysis}`;
        }

        const generatedImage = await generateWithNanoBanana(finalPrompt);
        
        return res.status(200).json({ 
          text: `IMAGE_GENERATED:${generatedImage}`, 
          mode: 'generate', 
          success: true 
        });

      } catch (error) {
        console.error("Nano Banana generation failed:", error);
        return res.status(200).json({ 
          text: `❌ Image generation failed: ${error.message}. Please try again with a different prompt.`,
          mode: 'generate', 
          success: false 
        });
      }
    }

    // Image Analysis with Gemini 2.0 Flash
    else if (images && images.length > 0) {
      try {
        const model = genAI.getGenerativeModel({ 
          model: "gemini-2.0-flash-exp",
          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.4,
          }
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
5. Overall context and mood`;
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

    // Text Chat with Gemini 2.0 Flash
    else if (message) {
      try {
        const model = genAI.getGenerativeModel({ 
          model: "gemini-2.0-flash-exp",
          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.7,
          }
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

    // No message or images provided
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
