#!/bin/bash

echo "🔧 Starting build process..."

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
yarn install

# Create bin directory
mkdir -p bin

# Download yt-dlp binary if not cached
if [ ! -f "bin/yt-dlp" ]; then
    echo "⬇️ Downloading yt-dlp..."
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp
    echo "✅ yt-dlp downloaded"
else
    echo "✅ Using yt-dlp from build cache"
fi

# Make yt-dlp executable
echo "📁 Setting up yt-dlp binary..."
chmod +x bin/yt-dlp

# Install Python dependencies for yt-dlp
echo "🐍 Installing Python dependencies..."
pip3 install --user --upgrade pip
pip3 install --user certifi urllib3 brotli mutagen pycryptodome websockets

# Test yt-dlp with Python path
echo "🧪 Testing yt-dlp binary..."
export PYTHONPATH="${HOME}/.local/lib/python3.13/site-packages:${PYTHONPATH}"
if ./bin/yt-dlp --version; then
    echo "✅ yt-dlp binary is ready"
else
    echo "❌ yt-dlp test failed, but continuing with build..."
fi

echo "🎉 Build process completed successfully!"