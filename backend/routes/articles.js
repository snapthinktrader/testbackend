const express = require('express');
const router = express.Router();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { saveArticle, saveArticles, getArticlesBySection, searchArticles, getAllArticles, deleteArticleByUrl, getArticleById, getArticleByUrl, findArticleByIdentifier } = require('../services/db/articleService');
const { optimizedFetch, optimizedDbOperation } = require('../middleware/optimizationManager');

// NYT API configuration
const NYT_API_KEY = process.env.NYT_API_KEY;
const NYT_BASE_URL = 'https://api.nytimes.com/svc';

// Helper function to fetch from NYT API
const fetchFromNYT = async (endpoint) => {
  if (!NYT_API_KEY) {
    throw new Error('NYT API key not configured');
  }
  
  const response = await axios.get(`${NYT_BASE_URL}${endpoint}`, {
    params: { 'api-key': NYT_API_KEY }
  });
  
  return response.data;
};

// Helper function to normalize article data format for frontend consistency
const normalizeArticleFormat = (article) => {
  const articleObj = article.toObject ? article.toObject() : { ...article };
  
  // Ensure id field exists
  if (!articleObj.id && articleObj._id) {
    articleObj.id = articleObj._id.toString();
  }
  
  // CRITICAL: Ensure imageUrl field exists (for home category compatibility)
  if (!articleObj.imageUrl && articleObj.multimedia && articleObj.multimedia.length > 0) {
    const media = articleObj.multimedia[0];
    if (media.url) {
      articleObj.imageUrl = media.url;
    }
  }
  
  // CRITICAL: Ensure multimedia array exists (for politics category compatibility)
  if (!articleObj.multimedia && articleObj.imageUrl) {
    articleObj.multimedia = [{
      url: articleObj.imageUrl,
      format: 'superJumbo',
      height: 1366,
      width: 2048,
      caption: ''
    }];
  }
  
  // Ensure basic fields have fallbacks
  articleObj.title = articleObj.title || 'Untitled';
  articleObj.abstract = articleObj.abstract || '';
  articleObj.author = articleObj.author || articleObj.byline || 'Staff Writer';
  articleObj.section = articleObj.section || 'news';
  
  // FUTURE-PROOF: Ensure commentary field exists (prepare for future commentary integration)
  if (!articleObj.commentary) {
    articleObj.commentary = null; // Will be populated by commentary service
  }
  
  return articleObj;
};

// Helper function to process NYT articles
// Helper function to process NYT articles into our format
const processNYTArticles = (articles) => {
  return articles.map(article => ({
    id: article.uri || article.url,
    title: article.title || '',
    abstract: article.abstract || '',
    url: article.url || '',
    publishedDate: article.published_date || new Date().toISOString(),
    source: 'New York Times',
    section: article.section || 'news',
    keywords: article.des_facet || [],
    des_facet: article.des_facet || [],
    org_facet: article.org_facet || [],
    per_facet: article.per_facet || [],
    geo_facet: article.geo_facet || [],
    content: article.abstract || '',
    multimedia: article.multimedia || [],
    byline: article.byline || '',
    subsection: article.subsection || ''
  }));
};

// FUTURE-PROOF: Auto-generate commentary for articles without it
const generateCommentaryForArticles = async (articles) => {
  console.log(`🤖 Starting background commentary generation for ${articles.length} articles...`);
  
  for (const article of articles) {
    try {
      // Skip if commentary already exists
      if (article.commentary) {
        continue;
      }
      
      // Generate commentary using internal API
      const response = await axios.post('http://localhost:3001/api/generate-commentary', {
        title: article.title,
        content: article.abstract || article.content,
        category: article.section
      });
      
      if (response.data.success) {
        article.commentary = response.data.commentary;
        console.log(`✅ Generated commentary for: "${article.title?.substring(0, 30)}..."`);
        
        // Save updated article to database
        await saveArticleToDatabase(article);
      }
    } catch (error) {
      console.log(`⚠️ Commentary generation failed for "${article.title?.substring(0, 30)}...":`, error.message);
    }
  }
  
  console.log(`🤖 Completed background commentary generation`);
};

// Helper function to save a single article to database
const saveArticleToDatabase = async (article) => {
  try {
    const { createOrUpdateArticle } = require('../services/db/articleService');
    await createOrUpdateArticle(article);
    console.log(`💾 Saved article with commentary: "${article.title?.substring(0, 30)}..."`);
  } catch (error) {
    console.log(`⚠️ Failed to save article: "${article.title?.substring(0, 30)}...":`, error.message);
  }
};

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

// Test route to verify ID field fix
router.get('/test-id-fix', async (req, res) => {
  try {
    console.log('🧪 Testing ID field fix...');
    const articles = await getAllArticles(1);
    
    if (articles && articles.length > 0) {
      const article = articles[0];
      const articleObj = article.toObject ? article.toObject() : { ...article };
      
      console.log('🧪 Original article keys:', Object.keys(articleObj));
      console.log('🧪 Has _id:', !!articleObj._id);
      console.log('🧪 Has id:', !!articleObj.id);
      
      // Force add ID field
      if (!articleObj.id && articleObj._id) {
        articleObj.id = articleObj._id.toString();
        console.log('🧪 Added ID field:', articleObj.id);
      }
      
      res.json({
        success: true,
        articleWithId: {
          _id: articleObj._id,
          id: articleObj.id,
          title: articleObj.title,
          hasId: !!articleObj.id
        }
      });
    } else {
      res.json({ success: false, message: 'No articles found' });
    }
  } catch (error) {
    console.error('🧪 Test error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// FUTURE-PROOF: Health check endpoint for monitoring image and commentary issues
router.get('/health-check', async (req, res) => {
  try {
    const healthStatus = {
      timestamp: new Date().toISOString(),
      services: {
        database: { status: 'unknown', message: '' },
        nytApi: { status: 'unknown', message: '' },
        commentary: { status: 'unknown', message: '' },
        imageHandling: { status: 'unknown', message: '' }
      },
      issues: []
    };
    
    // Test database connection
    try {
      const { getAllArticles } = require('../services/db/articleService');
      const testArticles = await getAllArticles(1, 0);
      healthStatus.services.database = { 
        status: 'healthy', 
        message: `Connected, ${testArticles.length} articles available` 
      };
    } catch (dbError) {
      healthStatus.services.database = { 
        status: 'error', 
        message: dbError.message 
      };
      healthStatus.issues.push('Database connection failed');
    }
    
    // Test NYT API
    try {
      const testData = await fetchFromNYT('/topstories/v2/home.json');
      healthStatus.services.nytApi = { 
        status: 'healthy', 
        message: `Connected, ${testData.results?.length || 0} articles available` 
      };
    } catch (nytError) {
      healthStatus.services.nytApi = { 
        status: 'error', 
        message: nytError.message 
      };
      healthStatus.issues.push('NYT API connection failed');
    }
    
    // Test commentary service
    try {
      const commentaryResponse = await axios.post('http://localhost:3001/api/generate-commentary', {
        title: 'Test Article',
        content: 'This is a test article for health check.',
        category: 'news'
      });
      healthStatus.services.commentary = { 
        status: commentaryResponse.data.success ? 'healthy' : 'error', 
        message: commentaryResponse.data.success ? 'Commentary generation working' : 'Commentary generation failed' 
      };
    } catch (commentaryError) {
      healthStatus.services.commentary = { 
        status: 'error', 
        message: commentaryError.message 
      };
      healthStatus.issues.push('Commentary service failed');
    }
    
    // Test image handling by checking recent articles
    try {
      const { getAllArticles } = require('../services/db/articleService');
      const recentArticles = await getAllArticles(5, 0);
      const articlesWithImages = recentArticles.filter(article => 
        (article.imageUrl && article.imageUrl.trim()) || 
        (article.multimedia && article.multimedia.length > 0)
      );
      
      const imageHealthPercentage = recentArticles.length > 0 ? 
        (articlesWithImages.length / recentArticles.length) * 100 : 0;
      
      healthStatus.services.imageHandling = { 
        status: imageHealthPercentage >= 80 ? 'healthy' : imageHealthPercentage >= 50 ? 'warning' : 'error',
        message: `${articlesWithImages.length}/${recentArticles.length} articles have images (${imageHealthPercentage.toFixed(1)}%)`
      };
      
      if (imageHealthPercentage < 80) {
        healthStatus.issues.push(`Low image availability: ${imageHealthPercentage.toFixed(1)}%`);
      }
    } catch (imageError) {
      healthStatus.services.imageHandling = { 
        status: 'error', 
        message: imageError.message 
      };
      healthStatus.issues.push('Image health check failed');
    }
    
    // Determine overall health
    const hasErrors = Object.values(healthStatus.services).some(service => service.status === 'error');
    const overallStatus = hasErrors ? 'unhealthy' : 'healthy';
    
    res.status(hasErrors ? 500 : 200).json({
      status: overallStatus,
      ...healthStatus
    });
    
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Health check failed',
      error: error.message
    });
  }
});

// Cache stats endpoint for monitoring
router.get('/cache/stats', (req, res) => {
  const CacheService = require('../services/cache');
  res.json(CacheService.stats());
});

// Helper function to fetch fresh articles in background
async function fetchFreshArticlesInBackground(category) {
  try {
    console.log(`🔄 Background fetch started for category: ${category}`);
    const endpoint = category === 'home' ? '/topstories/v2/home.json' : `/topstories/v2/${category}.json`;
    const data = await fetchFromNYT(endpoint);
    const articles = processNYTArticles(data.results || []);
    
    await saveArticlesToDatabase(articles, category);
    console.log(`✅ Background fetch completed for category: ${category}`);
  } catch (error) {
    console.error(`❌ Background fetch failed for category ${category}:`, error.message);
  }
}

// Helper function to save articles to database
async function saveArticlesToDatabase(articles, category) {
  try {
    const { saveArticle } = require('../services/db/articleService');
    
    let savedCount = 0;
    let skippedCount = 0;
    
    for (const article of articles) {
      try {
        const savedArticle = await saveArticle(article, category);
        if (savedArticle) {
          savedCount++;
        } else {
          skippedCount++;
        }
      } catch (saveError) {
        console.log(`⚠️ Failed to save article: ${article.title?.substring(0, 50)}...`);
        skippedCount++;
      }
    }
    console.log(`💾 Saved ${savedCount} articles, skipped ${skippedCount} for category: ${category}`);
  } catch (error) {
    console.error('❌ Database save error:', error.message);
  }
}

// GET /api/articles - Get all articles with optimized caching and auto-fetch
// GET /api/articles - Get all articles with optimized caching and auto-fetch
router.get('/', async (req, res) => {
  try {
    console.log('📰 Articles API called - fetching all articles');
    
    // Get query parameters
    const { category = 'home', limit = 20, offset = 0, q: searchQuery } = req.query;
    const limitNum = Math.min(parseInt(limit) || 20, 100); // Cap at 100
    const offsetNum = parseInt(offset) || 0;

    // Map frontend categories to backend sections
    const categoryToSectionMap = {
      'home': null, // Get all sections for home
      'politics': 'us',
      'business': 'business',
      'technology': 'technology',
      'health': 'health',
      'entertainment': 'entertainment',
      'wallstreet': 'wallstreet',
      'finance': 'finance',
      'science': 'science',
      'sports': 'sports',
      'world': 'world',
      'travel': 'travel',
      'us': 'us'
    };

    const mappedSection = categoryToSectionMap[category] || category;
    
    console.log(`🔍 Fetching articles - Category: ${category}, Mapped Section: ${mappedSection}, Limit: ${limitNum}, Offset: ${offsetNum}`);

    // Create cache key based on mapped section and other parameters
    const cacheKey = `articles-${mappedSection || 'all'}-${limitNum}-${offsetNum}-${searchQuery || 'none'}`;
    
    // TEMPORARY FIX: Bypass optimization to avoid cached empty results
    let articles;
    
    try {
      // Ensure database connection and fetch articles directly first
      const { waitForConnection } = require('../config/database');
      await waitForConnection(5000); // Wait up to 5 seconds for connection
      
      if (mappedSection) {
        // Get articles for specific section
        articles = await getArticlesBySection(mappedSection, limitNum, offsetNum);
        console.log(`🔍 Fetched ${articles?.length || 0} articles from database for section: ${mappedSection}`);
      } else {
        // Get all articles for home page
        articles = await getAllArticles(limitNum, offsetNum, null, searchQuery);
        console.log(`🔍 Fetched ${articles?.length || 0} articles from database (all sections)`);
      }
      
      // If we have articles from database, use them
      if (articles && articles.length > 0) {
        console.log(`✅ Using ${articles.length} articles from database`);
        const normalizedArticles = articles.map(article => normalizeArticleFormat(article));
        res.json(normalizedArticles);
        return;
      }
      
      // If no database articles, fetch fresh from API (NO CACHING for now)
      console.log('🌐 No database articles found, fetching fresh from API...');
      
      // Fetch from NYT Top Stories API
      const endpoint = category === 'home' ? '/topstories/v2/home.json' : `/topstories/v2/${category}.json`;
      const data = await fetchFromNYT(endpoint);
      let freshArticles = processNYTArticles(data.results || []);
      
      // Apply search filter if provided
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        freshArticles = freshArticles.filter(article => 
          article.title.toLowerCase().includes(query) ||
          article.content.toLowerCase().includes(query) ||
          article.author.toLowerCase().includes(query)
        );
      }
      
      // Apply pagination
      freshArticles = freshArticles.slice(offsetNum, offsetNum + limitNum);
      
      // Save articles to database in background
      saveArticlesToDatabase(freshArticles, category).catch(err => 
        console.log('⚠️ Background save failed:', err.message)
      );
      
      // Start background commentary generation for new articles
      generateCommentaryForArticles(freshArticles.slice(0, 5)).catch(err => 
        console.log('⚠️ Background commentary generation failed:', err.message)
      );
      
      console.log(`🌐 Fetched ${freshArticles.length} fresh articles from API`);
      articles = freshArticles.map(article => normalizeArticleFormat(article));
      
    } catch (error) {
      console.error('❌ Error in articles fetch:', error.message);
      throw error;
    }
    
    console.log(`✅ Returning ${articles?.length || 0} articles (bypassed optimization)`);
    res.json(Array.isArray(articles) ? articles : []);
    
  } catch (error) {
    console.error('❌ Error fetching articles:', error);
    res.status(500).json({
      error: 'Failed to fetch articles',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/articles/search - Search articles in database first, then NYT API
router.get('/search', async (req, res) => {
  try {
    const { q: keyword, limit = 10 } = req.query;
    
    if (!keyword || keyword.length < 1) {
      return res.status(400).json({ error: 'Search keyword is required' });
    }
    
    console.log(`🔍 Searching for: "${keyword}"`);
    
    let allResults = [];
    
    // 1. FIRST: Search local database
    try {
      console.log(`🔍 Searching local database for: "${keyword}"`);
      const dbResults = await searchArticles(keyword, parseInt(limit) * 2); // Get more from DB
      
      if (dbResults && dbResults.length > 0) {
        console.log(`📚 Found ${dbResults.length} results in local database`);
        
        // Ensure all articles have 'id' field for frontend compatibility
        const dbResultsWithIds = dbResults.map(article => {
          const articleObj = article.toObject ? article.toObject() : { ...article };
          if (!articleObj.id && articleObj._id) {
            articleObj.id = articleObj._id.toString();
          }
          return articleObj;
        });
        
        allResults = allResults.concat(dbResultsWithIds);
      }
    } catch (dbError) {
      console.error('Error searching local database:', dbError);
    }
    
    // 2. SECOND: If we don't have enough results, search NYT API
    if (allResults.length < parseInt(limit)) {
      try {
        console.log(`🌐 Searching NYT API for additional results...`);
        const data = await fetchFromNYT(`/search/v2/articlesearch.json?q=${encodeURIComponent(keyword)}&sort=newest`);
        let nytArticles = processNYTArticles(data.response?.docs || []);
        
        // Filter out articles we already have from database (by URL or title)
        const existingUrls = new Set(allResults.map(article => article.url));
        const existingTitles = new Set(allResults.map(article => article.title?.toLowerCase().trim()));
        
        nytArticles = nytArticles.filter(article => 
          !existingUrls.has(article.url) && 
          !existingTitles.has(article.title?.toLowerCase().trim())
        );
        
        if (nytArticles.length > 0) {
          console.log(`🌐 Found ${nytArticles.length} additional results from NYT API`);
          allResults = allResults.concat(nytArticles);
        }
      } catch (nytError) {
        console.error('Error searching NYT API:', nytError);
      }
    }
    
    // 3. Limit final results
    const finalResults = allResults.slice(0, parseInt(limit));
    
    console.log(`✅ Returning ${finalResults.length} total search results for "${keyword}"`);
    
    res.json({
      keyword,
      total: finalResults.length,
      articles: finalResults,
      sources: {
        database: allResults.filter(a => a._id).length,
        nyt: allResults.filter(a => !a._id).length
      }
    });
    
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ 
      error: 'Search failed',
      message: error.message 
    });
  }
});

// GET /api/articles/section/:section - Get articles by section
router.get('/section/:section', async (req, res) => {
  try {
    const { section } = req.params;
    const { limit = 10, ai } = req.query;
    const includeAI = ai === 'true';
    const finalSection = section === 'all' ? 'home' : section;
    
    console.log(`📰 Fetching section articles for: ${finalSection}`);
    
    try {
      const data = await fetchFromNYT(`/topstories/v2/${finalSection}.json`);
      const articles = processNYTArticles(data.results || []).slice(0, parseInt(limit));
      
      // Add AI commentary if requested
      if (includeAI && articles.length > 0) {
        const GroqCommentary = require('../services/ai/groqCommentary');
        const commentaryResults = await GroqCommentary.batchGenerateCommentary(
          articles.slice(0, 3), // Limit AI commentary to top 3 articles
          'expertise'
        );
        
        // Merge commentary with articles
        articles.forEach(article => {
          const commentary = commentaryResults.find(c => c.articleId.toString() === article._id?.toString());
          if (commentary && commentary.success) {
            article.aiCommentary = commentary.data;
          }
        });
      }
      
      console.log(`✅ Fetched ${articles.length} articles for section ${finalSection}`);
      res.json(articles);
    } catch (nytError) {
      console.error('❌ NYT API Error:', nytError.message);
      
      // Fallback to database
      const dbArticles = await getArticlesBySection(section, parseInt(limit));
      console.log(`📄 Fallback: Retrieved ${dbArticles.length} articles from database for section ${section}`);
      res.json(dbArticles);
    }
  } catch (error) {
    console.error('Error fetching articles by section:', error);
    res.status(500).json({ error: 'Failed to fetch articles by section' });
  }
});

// GET /api/articles/:id - Get single article by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { ai } = req.query;
    const includeAI = ai === 'true';
    
    console.log(`📄 Fetching article ${id} from database...`);
    
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

// POST /api/articles - Save single article
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

// POST /api/articles/batch - Save multiple articles
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

// POST /api/articles/bulk - Save multiple articles (alias for batch)
router.post('/bulk', async (req, res) => {
  try {
    const { articles } = req.body;
    const savedArticles = await saveArticles(articles);
    
    // Invalidate all caches when batch updating
    const CacheService = require('../services/cache');
    CacheService.flushAll();
    
    res.status(201).json({ 
      message: `Saved ${savedArticles.length} articles`,
      articles: savedArticles 
    });
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
