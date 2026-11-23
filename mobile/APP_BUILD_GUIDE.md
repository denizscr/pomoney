# PRO MONEY — Masaüstü, Android (APK) ve iOS (IPA) Uygulama Derleme Rehberi

Bu proje **tek bir çekirdek kod tabanı** üzerinden 4 platforma doğrudan derlenir:
1. **PWA (Kurulabilir Web Uygulaması)**: Chrome / Edge / Safari / Android / iOS'ta tek tıkla kurulur ve çevrimdışı çalışır.
2. **Android (APK / AAB)** (`capacitor.config.json`)
3. **iOS (iPhone / iPad IPA)** (`capacitor.config.json`)
4. **Masaüstü (Windows `.exe`, macOS `.dmg`, Linux `.AppImage`)** (`desktop/electron-main.cjs`)

---

## 1. Ortak Web Paketini Derleme (`dist/`)

```bash
npm install
npm run build
```

> Önemli: Mobil/Masaüstü derlemesinde uygulamanın canlı backend sunucusuna bağlanabilmesi için `capacitor.config.json` içindeki `server.url` alanını yayınladığınız HTTPS alan adınıza (`https://...`) yönlendirebilirsiniz veya doğrudan kurulu PWA olarak açabilirsiniz.

---

## 2. Android APK Derleme (Capacitor + Android Studio / Gradle)

```bash
# Capacitor paketlerini projeye ekleyin
npm install @capacitor/core @capacitor/cli @capacitor/android

# Web çıktısını derleyip Android projesini oluşturun
npm run build
npx cap add android
npx cap sync android

# Android Studio ile açıp imzalı APK oluşturmak için:
npx cap open android

# Veya doğrudan komut satırından Debug APK almak için:
cd android && ./gradlew assembleDebug
# Çıktı: android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 3. iOS (iPhone / iPad) Uygulaması Derleme (macOS + Xcode)

```bash
npm install @capacitor/ios
npm run build
npx cap add ios
npx cap sync ios
npx cap open ios
# Xcode içinde Signing & Capabilities > Team seçip Product > Archive ile IPA / App Store çıktısı alın.
```

---

## 4. Masaüstü Uygulaması (Windows / macOS / Linux - Electron)

```bash
npm install -D electron electron-builder
npm run build

# Canlı sunucuya bağlı Masaüstü penceresi başlatmak için:
PRO_MONEY_DESKTOP_URL="https://SUNUCU_ADRESINIZ" npx electron desktop/electron-main.cjs

# Yerel kurulum paketi (.exe / .dmg / .AppImage) üretmek için package.json içine "main": "desktop/electron-main.cjs" ekleyip:
npx electron-builder --win --mac --linux
```
