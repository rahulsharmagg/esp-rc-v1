# ESP-RC: Production Build Release

This branch contains the pre-compiled, optimized static assets for the ESP-RC cockpit application, ready for immediate production hosting.

---

## Running / Serving the Application

### Option 1: Node.js Server
Start the local HTTP static server:

```bash
npm start
# or
node server.js
```

Then open `http://localhost:8080` in Google Chrome or Microsoft Edge.

---

### Option 2: Static Web Hosting (cPanel / Apache / Nginx / GitHub Pages / Vercel / Netlify)
All files in this branch (`index.html`, `assets/`, `icons/`, `ESP-RC-LOGO.svg`, `sw.js`, `manifest.webmanifest`) are pre-compiled and can be served directly from your web server's public document root (`public_html/`).
