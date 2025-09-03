const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');
const { optimizedGroqCall, optimizedFetch } = require('../middleware/optimizationManager');

// Initialize GROQ client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

/**
 * Generate AI commentary for an article
 * POST /api/generate-commentary
 */
router.post('/generate-commentary', async (req, res) => {
  try {
    const { title, content, category } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        error: 'Title and content are required'
      });
    }

    // Create cache key for this specific commentary request
    const cacheKey = `commentary:${Buffer.from(title + content).toString('base64').substring(0, 32)}`;
    
    // Use optimized cache and Groq API call
    const commentary = await optimizedFetch(
      cacheKey,
      async () => {
        // Create the prompt for GROQ
        const prompt = `As an expert analyst, provide a brief but insightful commentary (2-3 paragraphs) on the following ${category || 'news'} article:

Title: ${title}
Content: ${content}

Focus on:
1. Key implications and potential impacts
2. Expert analysis of the situation
3. Historical context or similar cases if relevant
4. Potential future developments

Keep the tone professional and analytical. Provide only the commentary without any prefacing text.`;

        // Use optimized Groq API call with rate limiting
        const completion = await optimizedGroqCall(async () => {
          return await groq.chat.completions.create({
            messages: [
              {
                role: "system",
                content: "You are an expert news analyst who provides insightful commentary on current events. Your analysis should be professional, balanced, and informative."
              },
              {
                role: "user",
                content: prompt
              }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.7,
            max_tokens: 500
          });
        }, 'high'); // High priority for user-facing requests

        return completion.choices[0]?.message?.content || 'Unable to generate commentary at this time.';
      },
      'commentary' // Use commentary caching strategy
    );

    res.json({
      success: true,
      commentary: (commentary && typeof commentary === 'string') 
        ? commentary.trim() 
        : 'Unable to generate commentary at this time.'
    });

  } catch (error) {
    console.error('❌ Error generating commentary:', error);
    
    // Check if it's a rate limit error
    if (error.message && error.message.includes('Rate limit')) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: 'Please try again in a few moments. Our AI service is currently busy.',
        retryAfter: 60
      });
    }
    
    res.status(500).json({
      error: 'Failed to generate commentary',
      message: error.message
    });
  }
});

module.exports = router;
