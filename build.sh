#!/bin/bash
set -e

# Create local bin directory
mkdir -p bin

# Install system dependencies (note: may fail in read-only environments — consider removing this)
# apt-get update && apt-get install -y \
#   python3 \
#   python3-pip \
#   chromium \
#   ffmpeg

# Download latest yt-dlp into local bin directory
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp
chmod +x bin/yt-dlp
./bin/yt-dlp -U

# Install Node.js dependencies using Yarn
yarn install

# Install Python dependencies
pip3 install --user poetry
~/.local/bin/poetry install
