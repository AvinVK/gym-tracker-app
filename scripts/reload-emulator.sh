#!/usr/bin/env bash
# Force-closes and relaunches Clock It on the running emulator so it
# re-requests the page from the dev server, picking up static/ changes.
# Usage: bash scripts/reload-emulator.sh
set -e

SDK="$LOCALAPPDATA/Android/Sdk"
ADB="$SDK/platform-tools/adb.exe"
APP_ID="com.avinvk.clockit"

"$ADB" shell am force-stop "$APP_ID"
"$ADB" shell am start -n "$APP_ID/.MainActivity" > /dev/null
echo "Reloaded."
