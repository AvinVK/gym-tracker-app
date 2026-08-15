#!/usr/bin/env bash
# Boots the Android emulator (Pixel_6_API_34) and points the Clock It app
# at the local dev Flask server, so you can preview mobile layout changes
# without pushing to PythonAnywhere and checking on a real phone.
#
# Usage: bash scripts/run-emulator.sh
set -e

SDK="$LOCALAPPDATA/Android/Sdk"
ADB="$SDK/platform-tools/adb.exe"
EMULATOR="$SDK/emulator/emulator.exe"
AVD_NAME="Pixel_6_API_34"
DEV_PORT=6000        # matches config.py's dev-branch PORT
DEVICE_PORT=8000      # what the app requests; 6000 is blocked by Chromium as an "unsafe port"
APP_ID="com.avinvk.clockit"

# 1. Make sure the Flask dev server is up.
if ! curl -s -o /dev/null "http://localhost:$DEV_PORT/"; then
  echo "Starting Flask dev server on port $DEV_PORT..."
  (cd "$(dirname "$0")/.." && nohup python app.py > /tmp/flask-dev.log 2>&1 &)
  sleep 2
fi

# 2. Make sure the emulator is running.
if ! "$ADB" devices | grep -q "^emulator-"; then
  echo "Launching emulator ($AVD_NAME)..."
  "$EMULATOR" -avd "$AVD_NAME" -netdelay none -netspeed full > /tmp/emulator.log 2>&1 &
  echo "Waiting for boot..."
  until "$ADB" shell getprop sys.boot_completed 2>/dev/null | grep -q 1; do
    sleep 3
  done
fi

# 3. adb reverse mappings don't survive an emulator reboot, so re-apply every run.
"$ADB" reverse "tcp:$DEVICE_PORT" "tcp:$DEV_PORT"

# 4. Launch (or bring to front) the app. It loads live from the dev server
#    per capacitor.config.json's server.url — no rebuild needed for web/CSS/JS changes.
"$ADB" shell am start -n "$APP_ID/.MainActivity" > /dev/null

echo "Ready. Emulator is showing the live dev server. Edit static/ files and reload the app (or shake-menu > reload / relaunch the activity) to see changes."
