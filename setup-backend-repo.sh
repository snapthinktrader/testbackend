#!/bin/bash

# 🚀 Backend Repository Setup Script
# This script helps you set up your webstorybackend repository

echo "🚀 Setting up webstorybackend repository..."

# Check if we're in the server directory
if [ ! -f "server.js" ]; then
    echo "❌ Error: Please run this script from the server directory"
    echo "Usage: cd /Users/mahendrabahubali/Webstory/server && ./setup-backend-repo.sh"
    exit 1
fi

# Ask for the target directory
read -p "📁 Enter the path where you want to create/setup the webstorybackend directory: " TARGET_DIR

# Create target directory if it doesn't exist
if [ ! -d "$TARGET_DIR" ]; then
    mkdir -p "$TARGET_DIR"
fi

# Navigate to target directory
cd "$TARGET_DIR"

# Check if it's already a git repository
if [ ! -d ".git" ]; then
    echo "🔧 Initializing git repository..."
    git init
fi

# Copy all necessary files
echo "📦 Copying backend files..."

# Create directory structure
mkdir -p config middleware models routes services/db services/cache services/ai .github/workflows

# Copy files
cp /Users/mahendrabahubali/Webstory/server/server.js .
cp /Users/mahendrabahubali/Webstory/server/package.json .
cp /Users/mahendrabahubali/Webstory/server/vercel.json .
cp /Users/mahendrabahubali/Webstory/server/README.md .
cp /Users/mahendrabahubali/Webstory/server/.env.example .
cp /Users/mahendrabahubali/Webstory/server/.gitignore .
cp /Users/mahendrabahubali/Webstory/server/setup.sh .
cp /Users/mahendrabahubali/Webstory/server/.github/workflows/deploy.yml .github/workflows/

# Copy configuration files
cp /Users/mahendrabahubali/Webstory/server/config/* config/ 2>/dev/null || echo "No config files found"

# Copy middleware
cp /Users/mahendrabahubali/Webstory/server/middleware/* middleware/ 2>/dev/null || echo "No middleware files found"

# Copy models
cp /Users/mahendrabahubali/Webstory/server/models/* models/ 2>/dev/null || echo "No model files found"

# Copy routes
cp /Users/mahendrabahubali/Webstory/server/routes/* routes/ 2>/dev/null || echo "No route files found"

# Copy services
cp -r /Users/mahendrabahubali/Webstory/server/services/* services/ 2>/dev/null || echo "No service files found"

# Copy environment file (optional)
if [ -f "/Users/mahendrabahubali/Webstory/server/.env" ]; then
    read -p "🔐 Copy .env file? (y/n): " COPY_ENV
    if [ "$COPY_ENV" = "y" ]; then
        cp /Users/mahendrabahubali/Webstory/server/.env .
        echo "⚠️  Remember to update environment variables for production!"
    fi
fi

# Make scripts executable
chmod +x setup.sh

echo ""
echo "✅ Backend repository setup complete!"
echo ""
echo "📂 Repository location: $TARGET_DIR"
echo ""
echo "🔧 Next steps:"
echo "1. cd $TARGET_DIR"
echo "2. npm install"
echo "3. Create/edit .env file with your values"
echo "4. git add ."
echo "5. git commit -m 'Initial backend setup'"
echo "6. git remote add origin https://github.com/NukkadFoods/webstorybackend.git"
echo "7. git push -u origin main"
echo "8. vercel --prod"
echo ""
echo "📖 See README.md for detailed deployment instructions"

# Ask if user wants to continue with git setup
read -p "🤖 Would you like to continue with git setup now? (y/n): " CONTINUE_GIT

if [ "$CONTINUE_GIT" = "y" ]; then
    echo "🔧 Setting up git..."
    
    # Add all files
    git add .
    
    # Commit
    git commit -m "Initial backend setup with serverless configuration
    
    - Express.js server optimized for Vercel
    - Multi-tier caching system (83% hit rate)
    - MongoDB Atlas integration
    - Groq AI commentary generation
    - UUID article support for frontend compatibility
    - Rate limiting and security features
    - Comprehensive API documentation"
    
    echo ""
    echo "✅ Git repository ready!"
    echo ""
    echo "🌐 Now run these commands:"
    echo "git remote add origin https://github.com/NukkadFoods/webstorybackend.git"
    echo "git push -u origin main"
    echo ""
    echo "Then deploy to Vercel:"
    echo "vercel --prod"
fi
