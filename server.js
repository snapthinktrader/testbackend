const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const { Groq } = require('groq-sdk');
const { connectToMongoDB } = require('./config/database');
const CacheService = require('./services/cache');
const CronService = require('./services/cronService');

const app = express();
const port = process.env.PORT || 3001;

// Initialize cron jobs
CronService.initializeJobs();

// Simple in-memory cache for commentary
const commentaryCache = new Map();

// Simple rate limiter
const rateLimiter = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 20,
  tokens: new Map(),
  
  tryRequest(ip) {
    const now = Date.now();
    const userTokens = this.tokens.get(ip) || { count: 0, resetTime: now + this.windowMs };
    
    // Reset if window has passed
    if (now >= userTokens.resetTime) {
      userTokens.count = 0;
      userTokens.resetTime = now + this.windowMs;
    }
    
    if (userTokens.count >= this.maxRequests) {
      return false;
    }
    
    userTokens.count++;
    this.tokens.set(ip, userTokens);
    return true;
  }
};

// Initialize Groq client only if API key is available
let groq = null;
if (process.env.GROQ_API_KEY) {
  groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
  });
}

// CORS configuration for production and development
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:3000', // Development frontend
      'http://localhost:3001', // Development backend
      'https://webstory-frontend.vercel.app', // Production frontend (update with your actual domain)
      'https://your-custom-domain.com' // Add your custom domain here
    ];
    
    // In development, allow all origins
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());

// Cache-Control headers for CDN/Edge caching
app.use((req, res, next) => {
  if (req.method === 'GET') {
    res.set('Cache-Control', 'public, max-age=300'); // 5 minutes
  }
  next();
});

const { smartCacheMiddleware, rateLimitMiddleware, monitoringMiddleware } = require('./middleware/cacheMiddleware');
const monitoringRoutes = require('./routes/monitoring');
const articlesRoutes = require('./routes/articles');
const debugRoutes = require('./routes/debug');

// Apply rate limiting only to specific routes (not article API)
app.use('/api/generate-commentary', rateLimitMiddleware);

// Mount routes
app.use('/', monitoringRoutes);
app.use('/api/articles', articlesRoutes);
app.use('/api/debug', debugRoutes);

// Endpoint to list available models
app.get('/api/list-models', async (req, res) => {
  if (!groq) {
    return res.status(503).json({ error: 'AI service not available' });
  }
  try {
    const models = await groq.models.list();
    res.json(models);
  } catch (error) {
    console.error('Error fetching models:', error);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

// Endpoint to generate article commentary
app.post('/api/generate-commentary', async (req, res) => {
  if (!groq) {
    return res.status(503).json({ error: 'AI service not available' });
  }
  
  try {
    const { title, content, category } = req.body;
    
    // Check rate limit
    const clientIp = req.ip;
    if (!rateLimiter.tryRequest(clientIp)) {
      return res.status(429).json({ 
        error: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.ceil((rateLimiter.tokens.get(clientIp).resetTime - Date.now()) / 1000)
      });
    }

    // Check cache first
    const cacheKey = `${title}-${category}`;
    if (commentaryCache.has(cacheKey)) {
      console.log('Returning cached commentary for:', title);
      return res.json(commentaryCache.get(cacheKey));
    }

    // Function to generate reporter name and location based on category
    const getReporter = (category) => {
      const firstNames = ['Sarah', 'Michael', 'Rachel', 'David', 'Emily', 'James', 'Jessica', 'Daniel', 'Alexandra', 'Benjamin'];
      const lastNames = ['Anderson', 'Mitchell', 'Reynolds', 'Carter', 'Thompson', 'Sullivan', 'Morgan', 'Parker', 'Bennett', 'Collins'];
      const randomFirst = firstNames[Math.floor(Math.random() * firstNames.length)];
      const randomLast = lastNames[Math.floor(Math.random() * lastNames.length)];
      
      // Default location based on category
      let location = '';
      switch(category?.toLowerCase()) {
        case 'politics':
          location = 'Washington D.C.';
          break;
        case 'technology':
          location = 'San Francisco';
          break;
        case 'business':
          location = 'New York';
          break;
        case 'entertainment':
          location = 'Los Angeles';
          break;
        case 'sports':
          location = 'Chicago';
          break;
        default:
          location = 'New York';
      }
      
      return { name: `${randomFirst} ${randomLast}`, location };
    };

    const reporter = getReporter(category);

    const prompt = `As ${reporter.name}, our senior correspondent from ${reporter.location}, provide an expert analysis of this ${category} story:

    Title: ${title}
    Content: ${content}

    Structure your response in 3 paragraphs:
    1. KEY POINTS: What's the spicy angle? What makes this newsworthy? (2-3 snappy sentences)
    2. IMPACT ANALYSIS: Why should people care? What's the real story behind the headlines? (2-3 engaging sentences)
    3. FUTURE OUTLOOK: What's next? Any predictions or potential developments? (2-3 forward-looking sentences)

    Style guide:
    - Write as an experienced journalist with deep industry knowledge
    - Use professional yet engaging language
    - Show your expertise with relevant context
    - Include insider perspectives
    - Keep each section concise and impactful

    Make it feel like exclusive insights from a seasoned reporter.`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.5,
      max_tokens: 1000,
    });

    const commentary = completion.choices[0]?.message?.content || 'Unable to generate commentary';
    const response = { 
      commentary,
      reporter: {
        name: reporter.name,
        location: reporter.location,
        title: 'Senior Correspondent'
      }
    };

    // Cache the response
    commentaryCache.set(cacheKey, response);
    console.log('Cached commentary for:', title);

    res.json(response);
  } catch (error) {
    console.error('Error generating commentary:', error);
    res.status(500).json({ error: 'Failed to generate commentary' });
  }
});

// Connect to MongoDB before starting the server
connectToMongoDB()
  .then(() => {
    // Only start server if not in Vercel environment
    if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
      app.listen(port, () => {
        console.log(`Server running on port ${port}`);
      });
    }
  })
  .catch((error) => {
    console.error('Failed to connect to MongoDB:', error);
    if (process.env.NODE_ENV !== 'production') {
      process.exit(1);
    }
  });

// Export the Express API for Vercel
module.exports = app;
