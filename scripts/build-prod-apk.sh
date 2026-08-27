#!/usr/bin/env bash
# Builds an installable APK that points at the live PythonAnywhere server
# instead of the local dev server used by scripts/run-emulator.sh - this is
# the "install once on a real phone" build, so it never needs a rebuild for
# ordinary web/CSS/JS changes: the WebView just re-loads the live site.
#
# Usage: bash scripts/build-prod-apk.sh
set -e

cd "$(dirname "$0")/.."

cp capacitor.config.json capacitor.config.dev.json.bak
trap 'mv capacitor.config.dev.json.bak capacitor.config.json' EXIT

cp capacitor.config.prod.json capacitor.config.json

npx cap sync android

# The bundled webDir copy is dead weight once server.url is set (the WebView
# always loads the live site, never file:///android_asset/public/*) but
# Capacitor bundles it anyway - exercise-images alone is ~14MB, so drop it
# from this generated (not source-controlled) copy to keep the APK small.
rm -rf android/app/src/main/assets/public/exercise-images

# clean, not just assembleDebug: gradle's incremental asset-merge doesn't
# reliably notice the rm above and can silently repackage a stale, much
# larger APK from its intermediates cache otherwise.
(cd android && JAVA_HOME="C:\Program Files\Android\Android Studio\jbr" ./gradlew.bat clean assembleDebug)

APK_PATH="android/app/build/outputs/apk/debug/app-debug.apk"
echo "Built: $APK_PATH ($(du -h "$APK_PATH" | cut -f1))"
