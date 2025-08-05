#!/usr/bin/env bash
# exit on error
set -o errexit

echo "🔧 Starting build process..."

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
yarn install

# Check build cache for yt-dlp
if [[ ! -d $XDG_CACHE_HOME/yt-dlp ]]; then
  echo "⬇️ Downloading yt-dlp..."
  cd $XDG_CACHE_HOME
  mkdir -p ./yt-dlp
  cd ./yt-dlp
  
  # Download the latest yt-dlp release
  echo "🌐 Fetching latest yt-dlp release info..."
  DOWNLOAD_URL=$(curl -s https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest | jq -r '.assets[] | select(.name == "yt-dlp") | .browser_download_url')
  
  if [ -z "$DOWNLOAD_URL" ]; then
    echo "❌ Failed to get yt-dlp download URL"
    exit 1
  fi
  
  echo "⬇️ Downloading yt-dlp from: $DOWNLOAD_URL"
  wget "$DOWNLOAD_URL" -O yt-dlp
  
  # Make it executable
  chmod a+rx yt-dlp
  
  # Verify download
  if [[ -f yt-dlp ]]; then
    echo "✅ yt-dlp downloaded successfully"
    ./yt-dlp --version
  else
    echo "❌ Failed to download yt-dlp"
    exit 1
  fi
  
  cd $HOME/project/src # Return to project directory
else
  echo "✅ Using yt-dlp from build cache"
fi

# Create bin directory and copy yt-dlp binary
echo "📁 Setting up yt-dlp binary..."
mkdir -p $HOME/project/src/bin
cp $XDG_CACHE_HOME/yt-dlp/yt-dlp $HOME/project/src/bin/

# Verify the binary works
echo "🧪 Testing yt-dlp binary..."
if [[ -f $HOME/project/src/bin/yt-dlp ]]; then
  chmod +x $HOME/project/src/bin/yt-dlp
  $HOME/project/src/bin/yt-dlp --version
  echo "✅ yt-dlp binary is ready"
else
  echo "❌ Failed to copy yt-dlp binary"
  exit 1
fi

echo "🎉 Build process completed successfully!"