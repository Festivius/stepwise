#!/bin/bash
# Load env variables
export $(grep -v '^#' .env | xargs)

# Run Puppeteer script
node refresh_cookies.js
