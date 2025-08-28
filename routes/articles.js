const express = require('express');
const router = express.Router();
const { saveArticle, saveArticles, getArticlesBySection, searchArticles, getAllArticles, deleteArticleByUrl, getArticleById, getArticleByUrl, findArticleByIdentifier } = require('../services/db/articleService');
const { smartCacheMiddleware, monitoringMiddleware } = require('../middleware/cacheMiddleware');

// Apply monitoring to all routes
router.use(monitoringMiddleware);

// Test route to verify the API is working
router.get('/test', (req, res) => {
  res.json({ 
    message: 'Articles API is working!', 
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    caching: 'node-cache',
    optimizations: 'enabled'
  });
});

// Cache stats endpoint for monitoring
router.get('/cache/stats', (req, res) => {
  const CacheService = require('../services/cache');
  res.json(CacheService.stats());
});

// GET /api/articles - Get all articles (cached for 5 minutes)
router.get('/', smartCacheMiddleware('default', 300), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const articles = await getAllArticles(limit);
    res.json(articles);
  } catch (error) {
    console.error('Error fetching articles:', error);
    res.status(500).json({ error: 'Failed to fetch articles' });
  }
});

// GET /api/articles/search - Search articles (cached for 10 minutes)
router.get('/search', smartCacheMiddleware('search', 600), async (req, res) => {
  try {
    const { q: keyword } = req.query;
    const limit = parseInt(req.query.limit) || 10;
    
    if (!keyword) {
      return res.status(400).json({ error: 'Search keyword is required' });
    }
    
    const articles = await searchArticles(keyword, limit);
    res.json(articles);
  } catch (error) {
    console.error('Error searching articles:', error);
    res.status(500).json({ error: 'Failed to search articles' });
  }
});

// GET /api/articles/section/:section - Get articles by section (cached for 15 minutes)
router.get('/section/:section', smartCacheMiddleware('category', 900), async (req, res) => {
  try {
    const { section } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    const includeAI = req.query.ai === 'true';
    
    const articles = await getArticlesBySection(section, limit);
    
    // Add AI commentary if requested
    if (includeAI && articles.length > 0) {
      const GroqCommentary = require('../services/ai/groqCommentary');
      const commentaryResults = await GroqCommentary.batchGenerateCommentary(
        articles.slice(0, 3), // Limit AI commentary to top 3 articles
        'expertise'
      );
      
      // Merge commentary with articles
      articles.forEach(article => {
        const commentary = commentaryResults.find(c => c.articleId.toString() === article._id.toString());
        if (commentary && commentary.success) {
          article.aiCommentary = commentary.data;
        }
      });
    }
    
    res.json(articles);
  } catch (error) {
    console.error('Error fetching articles by section:', error);
    res.status(500).json({ error: 'Failed to fetch articles by section' });
  }
});

// GET /api/articles/by-url - Get article by URL (query parameter)
router.get('/by-url', smartCacheMiddleware('article', 1800), async (req, res) => {
  try {
    const { url } = req.query;
    const includeAI = req.query.ai === 'true';
    
    if (!url) {
      return res.status(400).json({ 
        error: 'URL parameter is required',
        message: 'Please provide a URL parameter: /api/articles/by-url?url=...'
      });
    }
    
    // Use smart finder for better compatibility
    const article = await findArticleByIdentifier(url);
    
    if (!article) {
      return res.status(404).json({ 
        error: 'Article not found',
        message: 'Article not found in database. Try browsing categories first to cache articles.',
        url: url
      });
    }
    
    // Add AI commentary if requested
    if (includeAI) {
      const GroqCommentary = require('../services/ai/groqCommentary');
      const commentary = await GroqCommentary.generateCommentary(article, 'analysis');
      article.aiCommentary = commentary;
    }
    
    res.json(article);
  } catch (error) {
    console.error('Error fetching article by URL:', error);
    res.status(500).json({ 
      error: 'Failed to fetch article',
      message: error.message 
    });
  }
});

// GET /api/articles/:id - Get single article with optional AI commentary
router.get('/:id', smartCacheMiddleware('article', 1800), async (req, res) => {
  try {
    const { id } = req.params;
    const includeAI = req.query.ai === 'true';
    
    // Use smart finder that handles multiple ID formats
    const article = await findArticleByIdentifier(id);
    
    if (!article) {
      return res.status(404).json({ 
        error: 'Article not found',
        message: 'Article not found in database. Try browsing categories first to cache articles.',
        id: id
      });
    }
    
    // Add AI commentary if requested
    if (includeAI) {
      const GroqCommentary = require('../services/ai/groqCommentary');
      const commentary = await GroqCommentary.generateCommentary(article, 'analysis');
      article.aiCommentary = commentary;
    }
    
    res.json(article);
  } catch (error) {
    console.error('Error fetching article:', error);
    res.status(500).json({ 
      error: 'Failed to fetch article',
      message: error.message 
    });
  }
});

// POST /api/articles - Save single article (invalidate caches)
router.post('/', async (req, res) => {
  try {
    const article = await saveArticle(req.body);
    if (article) {
      // Invalidate relevant caches
      const CacheService = require('../services/cache');
      CacheService.invalidatePattern('homepage:*');
      CacheService.invalidatePattern(`category:*${article.section}*`);
      
      res.status(201).json(article);
    } else {
      res.status(400).json({ error: 'Failed to save article' });
    }
  } catch (error) {
    console.error('Error saving article:', error);
    res.status(500).json({ error: 'Failed to save article' });
  }
});

// POST /api/articles/batch - Save multiple articles (invalidate caches)
router.post('/batch', async (req, res) => {
  try {
    const articles = await saveArticles(req.body);
    
    // Invalidate all caches when batch updating
    const CacheService = require('../services/cache');
    CacheService.flushAll();
    
    res.status(201).json({ 
      message: `Saved ${articles.length} articles`,
      articles 
    });
  } catch (error) {
    console.error('Error saving articles:', error);
    res.status(500).json({ error: 'Failed to save articles' });
  }
});

// DELETE /api/articles - Delete article by URL (invalidate caches)
router.delete('/', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    const success = await deleteArticleByUrl(url);
    
    if (success) {
      // Invalidate caches
      const CacheService = require('../services/cache');
      CacheService.flushAll();
      
      res.json({ message: 'Article deleted successfully' });
    } else {
      res.status(404).json({ error: 'Article not found or failed to delete' });
    }
  } catch (error) {
    console.error('Error deleting article:', error);
    res.status(500).json({ error: 'Failed to delete article' });
  }
});

module.exports = router;

// GET /api/articles/:id - Get article by ID (must come last as it catches everything)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const decodedId = decodeURIComponent(id);
    
    // Try different search strategies
    let articles = [];
    
    // First try searching by the ID as a title or URL
    articles = await searchArticles(decodedId, 1);
    
    // If not found and it looks like a URL, try searching by URL pattern
    if (articles.length === 0 && decodedId.includes('http')) {
      articles = await searchArticles(decodedId.split('/').pop(), 1);
    }
    
    // If still not found, try searching just by keywords from the ID
    if (articles.length === 0) {
      // Extract meaningful words from the ID for search
      const searchTerms = decodedId
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .split(' ')
        .filter(term => term.length > 3)
        .slice(0, 3) // Take first 3 meaningful words
        .join(' ');
      
      if (searchTerms) {
        articles = await searchArticles(searchTerms, 5);
      }
    }
    
    if (articles && articles.length > 0) {
      // Return the first match with additional content
      const article = articles[0];
      article.content = article.content || article.abstract || article.lead_paragraph || 'Content not available';
      res.json(article);
    } else {
      // Return a helpful error with suggestion
      res.status(404).json({ 
        error: 'Article not found',
        suggestion: 'The article may not be cached yet. Try browsing the homepage or categories first.',
        searchId: decodedId
      });
    }
  } catch (error) {
    console.error('Error fetching article by ID:', error);
    res.status(500).json({ error: 'Failed to fetch article' });
  }
});

// POST /api/articles - Save a single article
router.post('/', async (req, res) => {
  try {
    const articleData = req.body;
    const savedArticle = await saveArticle(articleData);
    
    if (savedArticle) {
      res.status(201).json(savedArticle);
    } else {
      res.status(400).json({ error: 'Failed to save article' });
    }
  } catch (error) {
    console.error('Error saving article:', error);
    res.status(500).json({ error: 'Failed to save article' });
  }
});

// POST /api/articles/bulk - Save multiple articles
router.post('/bulk', async (req, res) => {
  try {
    const { articles } = req.body;
    
    if (!Array.isArray(articles)) {
      return res.status(400).json({ error: 'Articles must be an array' });
    }
    
    const savedArticles = await saveArticles(articles);
    res.status(201).json(savedArticles);
  } catch (error) {
    console.error('Error saving articles:', error);
    res.status(500).json({ error: 'Failed to save articles' });
  }
});

// DELETE /api/articles - Delete article by URL
router.delete('/', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'Article URL is required' });
    }
    
    const success = await deleteArticleByUrl(url);
    
    if (success) {
      res.json({ message: 'Article deleted successfully' });
    } else {
      res.status(404).json({ error: 'Article not found or failed to delete' });
    }
  } catch (error) {
    console.error('Error deleting article:', error);
    res.status(500).json({ error: 'Failed to delete article' });
  }
});

module.exports = router;
