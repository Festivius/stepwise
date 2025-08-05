#!/bin/bash
set -e

# Install system dependencies
apt-get update && apt-get install -y \
  python3 \
  python3-pip \
  chromium \
  ffmpeg

# Install latest yt-dlp (critical fix)
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp
yt-dlp -U

# Install Node.js dependencies using Yarn
yarn install

# Install Python dependencies
pip3 install poetry
poetry install