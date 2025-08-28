// Story service for backend
const API_KEY = process.env.NYT_API_KEY;
const BASE_URL = 'https://api.nytimes.com/svc/';

const getTopStories = async (section = 'home') => {
  try {
    if (!API_KEY) {
      console.error('NYT_API_KEY not found in environment variables');
      return [];
    }

    console.log(`Fetching top stories for section: ${section}`);
    const url = `${BASE_URL}topstories/v2/${section}.json?api-key=${API_KEY}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error(`NYT API Error: ${response.status} ${response.statusText}`);
      if (response.status === 429) {
        console.error('NYT API rate limit exceeded');
      } else if (response.status === 401) {
        console.error('NYT API key is invalid or expired');
      }
      throw new Error(`Error: ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`Successfully fetched ${data.results?.length || 0} articles`);
    return data.results || [];
  } catch (error) {
    console.error('Error fetching top stories:', error);
    return [];
  }
};

const fetchFullStoryContent = async (storyUrl) => {
  try {
    return {
      content: `
        <p class="mb-6">This story is available from the New York Times. Unfortunately, we can only display a preview here.</p>
        <p class="mb-6">Please click the link below to read the full story:</p>
        <p class="my-6">
          <a href="${storyUrl}" target="_blank" rel="noopener noreferrer" class="bg-blue-700 hover:bg-blue-800 text-white py-2 px-6 rounded-md inline-flex items-center">
            Read Full Story on NYT Website
          </a>
        </p>
      `
    };
  } catch (error) {
    console.error('Error fetching full story content:', error);
    return {
      error: 'Failed to fetch story content',
      content: `
        <p class="mb-6">We encountered an issue retrieving the full story content.</p>
        <p class="mb-6">Please click the link below to read the full story on the New York Times website:</p>
        <p class="my-6">
          <a href="${storyUrl}" target="_blank" rel="noopener noreferrer" class="bg-blue-700 hover:bg-blue-800 text-white py-2 px-6 rounded-md inline-flex items-center">
            Read Full Story on NYT Website
          </a>
        </p>
      `
    };
  }
};

module.exports = {
  getTopStories,
  fetchFullStoryContent
};
