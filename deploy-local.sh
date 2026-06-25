#!/bin/bash
# Update the installed /Applications/Stepwise Studio.app with the current source.
#
#   ./deploy-local.sh          fast sync (rsync source into the installed app) — instant
#   ./deploy-local.sh --full   full rebuild (electron-builder --dir, unsigned, asar off)
#
# Use --full after changing dependencies (node_modules), the binaries/, or build config.
# The installed app is built unsigned with asar disabled so plain source changes are a
# near-instant file copy — no rebuild needed.
set -e
cd "$(dirname "$0")"
APP="/Applications/Stepwise Studio.app"
RES="$APP/Contents/Resources/app"

pkill -f "Stepwise Studio" 2>/dev/null || true
sleep 0.5

if [ "$1" = "--full" ] || [ ! -f "$RES/main.js" ]; then
  echo "▶ Full build (unsigned, --dir, asar off)…"
  CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir --mac -c.asar=false -c.mac.identity=null
  BUILT=$(ls -d dist/mac-arm64/*.app dist/mac/*.app 2>/dev/null | head -1)
  [ -z "$BUILT" ] && { echo "✗ build output not found"; exit 1; }
  rm -rf "$APP"
  cp -R "$BUILT" "$APP"
  echo "✓ Installed full build → $APP"
else
  echo "▶ Fast sync (source only)…"
  cp main.js preload.js "$RES/"
  rsync -a --delete src/ "$RES/src/"
  echo "✓ Synced source → installed app"
fi

VER=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null)
echo "✓ Done. Installed version: $VER"
