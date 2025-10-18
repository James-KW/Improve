const { GoogleGenerativeAI } = require('@google/generative-ai');

function base64ToGenerativePart(base64String, mimeType) {
  return {
    inlineData: {
      data: base64String.split(',')[1],
      mimeType: mimeType
    }
  };
}

// FREE Image Generation - Stable Diffusion
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
      const errorData = await response.json();
      throw new Error(`Stable Diffusion error: ${errorData.error || response.status}`);
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

// FREE Video Generation - Stable Video Diffusion
async function generateWithStableVideo(prompt) {
  try {
    const response = await fetch(
      "https://api-inference.huggingface.co/models/stabilityai/stable-video-diffusion-img2vid",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            num_frames: 25,
            fps: 6
          }
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Stable Video error: ${errorData.error || response.status}`);
    }

    const videoBlob = await response.blob();
    const arrayBuffer = await videoBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return `data:video/mp4;base64,${buffer.toString('base64')}`;
    
  } catch (error) {
    console.error("Stable Video Error:", error);
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
    
    console.log("Request:", { mode, mediaType, message: message?.substring(0, 50) });

    // FREE Image Generation
    if (mode === 'generate' && message && mediaType === 'image') {
      try {
        console.log("Starting FREE Image Generation...");
        
        const generatedImage = await generateWithStableDiffusion(message);
        
        return res.status(200).json({ 
          text: `IMAGE_GENERATED:${generatedImage}`,
          message: "Image generated successfully! (FREE Version)",
          mode: 'generate', 
          mediaType: 'image',
          success: true 
        });

      } catch (error) {
        console.error("FREE Image generation failed:", error);
        return res.status(200).json({ 
          text: `❌ FREE Image generation failed: ${error.message}. Try a different prompt.`,
          mode: 'generate', 
          success: false 
        });
      }
    }

    // FREE Video Generation
    if (mode === 'generate' && message && mediaType === 'video') {
      try {
        console.log("Starting FREE Video Generation...");
        
        const videoResult = await generateWithStableVideo(message);
        
        return res.status(200).json({ 
          text: `VIDEO_GENERATED:${videoResult}`,
          message: "Video generated successfully! (FREE Version)", 
          mode: 'generate', 
          mediaType: 'video',
          success: true 
        });

      } catch (error) {
        console.error("FREE Video generation failed:", error);
        return res.status(200).json({ 
          text: `❌ FREE Video generation failed: ${error.message}. Try again later.`,
          mode: 'generate', 
          success: false 
        });
      }
    }

    // Image Analysis with Gemini
    else if (images && images.length > 0) {
      try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

        const imageParts = images.map(imgData => {
          const mimeType = imgData.split(';')[0].split(':')[1];
          return base64ToGenerativePart(imgData, mimeType);
        });

        let prompt = message ? `Analyze this image: ${message}` : "Describe this image in detail.";
        const result = await model.generateContent([prompt, ...imageParts]);
        const response = await result.response;
        
        return res.status(200).json({ 
          text: response.text(), 
          mode: 'analyze', 
          success: true 
        });

      } catch (error) {
        console.error("Image analysis failed:", error);
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
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

        const result = await model.generateContent(message);
        const response = await result.response;
        
        return res.status(200).json({ 
          text: response.text(), 
          mode: 'chat', 
          success: true 
        });

      } catch (error) {
        console.error("Chat failed:", error);
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
    return res.status(500).json({ error: error.message });
  }
};
