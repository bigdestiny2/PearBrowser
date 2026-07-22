#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SDK=${IOS_SDK:-iphonesimulator}
DESTINATION=${IOS_DESTINATION:-${IOS_SIMULATOR_DESTINATION:-"generic/platform=iOS Simulator"}}
DERIVED_DATA_PATH=${DERIVED_DATA_PATH:-"/private/tmp/pearbrowser-generated-ios-release-dd"}
HERMES_CLI_PATH_VALUE=${HERMES_CLI_PATH:-"$ROOT/ios/Pods/hermes-engine/destroot/bin/hermesc"}

if [ ! -f "$ROOT/ios/PearBrowser.xcworkspace/contents.xcworkspacedata" ]; then
  echo "Generated Expo iOS workspace not found. Run: npx expo prebuild --platform ios --no-install && cd ios && pod install" >&2
  exit 1
fi

if [ ! -x "$HERMES_CLI_PATH_VALUE" ]; then
  echo "Hermes compiler not found at $HERMES_CLI_PATH_VALUE. Run pod install for the generated iOS project." >&2
  exit 1
fi

exec xcodebuild \
  -workspace "$ROOT/ios/PearBrowser.xcworkspace" \
  -scheme PearBrowser \
  -configuration Release \
  -sdk "$SDK" \
  -destination "$DESTINATION" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  CODE_SIGNING_ALLOWED="${CODE_SIGNING_ALLOWED:-NO}" \
  COMPILER_INDEX_STORE_ENABLE="${COMPILER_INDEX_STORE_ENABLE:-NO}" \
  RCT_NO_LAUNCH_PACKAGER="${RCT_NO_LAUNCH_PACKAGER:-1}" \
  HERMES_CLI_PATH="$HERMES_CLI_PATH_VALUE" \
  build
