# PearBrowser Android Worklet Issue - Summary

## Problem Statement

**The Bare worklet fails to execute on Android**, causing the P2P engine to never start. The app works fine on iOS, but on Android it hangs indefinitely at "Connecting..."

---

## Symptoms

- App builds and installs successfully on Android
- React Native UI renders correctly
- `worklet.start()` returns without throwing an error (no crash)
- No `READY` event ever sent from worklet to RN
- No `console.log` output from within the worklet
- Boot progress events never received

---

## Investigation Summary

### What We Know Works

1. **Bundle file is valid** - Same bundle works on iOS
2. **File loading works** - `expo-file-system` writes bundle to disk successfully
3. **Worklet instantiation works** - `new Worklet()` doesn't throw
4. **start() accepts the bundle** - No exception thrown, but code never executes

### What We Tried (All Failed)

| Approach | Result |
|----------|--------|
| Pass bundle as string directly | Silent failure |
| Convert to Uint8Array manually | Silent failure |
| Use `b4a.from()` Buffer | Silent failure |
| Write to file, use `startFile()` with `.js` | File written, never executes |
| Write to file, use `startFile()` with `.bundle` | File written, never executes |
| Minimal inline source (200 bytes) | **Needs testing** |

### Key Finding

The issue is **not** bundle size or encoding. The issue is that `worklet.start()` on Android accepts the bundle but **never executes it**. This suggests the Bare module loader on Android isn't properly handling the bundle format that `bare-pack` produces.

---

## Technical Details

### Bundle Format

The `bare-pack` output starts with:
```
117321
{"version":0,"id":"025db2312db3854b88c53bf97c4cd4446c26b851be09e0525a0617670d784518",...}
```

This is wrapped in `export default "..."` when imported via Metro.

### Android JNI Layer

The `react-native-bare-kit` Android implementation likely has a native method:
```java
void start(String filename, String source, ReadableArray args)
```

This method appears to accept the parameters but doesn't properly pass them to the Bare runtime for execution.

### iOS vs Android Difference

- **iOS**: `worklet.start()` with bundle string → Works
- **Android**: `worklet.start()` with bundle string → Silent failure
- **Android**: `worklet.startFile()` with bundle file → Silent failure

---

## Current Workaround: HTTP-Only Mode

We've implemented **HTTP-only mode** for Android as a temporary workaround:

- Skip the worklet entirely on Android
- Use HTTP relay for all content (no P2P)
- UI shows "HTTP Mode" instead of peer count
- Explore tab works via `fetch()` to relay endpoints

### Limitations of HTTP Mode

- No local P2P connections
- No site publishing capability
- No offline content access
- Relies entirely on relay availability

---

## Potential Root Causes

1. **Module Extension Handler** - Bare's `Module._extensions` may not handle `.bundle` files on Android
2. **JNI String Encoding** - Large strings may be getting truncated or corrupted
3. **Bundle Parsing** - The bare-pack format may not be recognized
4. **Native Code Path** - Different code paths for iOS (ObjC) vs Android (JNI)

---

## Recommended Next Steps

### For Pear/Bare Team

1. **Debug native Android code** in `react-native-bare-kit`:
   ```bash
   # Check how start() is implemented
   cat android/src/main/java/*Worklet*.java
   ```

2. **Test with minimal JS** - Verify the native bridge works at all:
   ```javascript
   worklet.start('/test.js', 'console.log("hello")')
   ```

3. **Check bundle format support** - Does Bare Android expect a different format than bare-pack produces?

4. **Compare iOS vs Android implementations** - Why does the same bundle work on iOS but not Android?

### For PearBrowser

1. **Keep HTTP-only mode** as primary Android path until P2P works
2. **Consider alternative architectures**:
   - HTTP relay for catalog discovery
   - WebRTC data channels for P2P (instead of Hyperswarm)
   - Native HTTP proxy in Kotlin instead of Bare worklet

---

## Files Modified

- `app/App.tsx` - Added HTTP-only mode for Android
- `app/components/StatusDot.tsx` - Added 'http-only' status
- `app/screens/ExploreScreen.tsx` - Uses HTTP relay for catalog

---

## Test Environment

- Device: Android (physical device)
- React Native: 0.76.x
- bare-kit: Latest
- Bundle size: ~2.2MB
- Gradle: 8.13
- Android SDK: 36

---

## Questions for Community

1. Has anyone successfully used `bare-pack` bundles with `react-native-bare-kit` on Android?
2. Is there a known working bundle format or size limit?
3. Should we be using a different API than `worklet.start()`?
4. Are there any working examples of Bare worklets on Android?

---

*Last updated: 2026-04-09*
*Status: Issue unresolved, HTTP-only workaround in place*
