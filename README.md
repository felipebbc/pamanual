# PA Driver's Manual Quiz — Static Web App

This version runs **entirely in the browser** (no Python / no server runtime).

## Files you care about

- `index.html` – start page
- `quiz.html` – quiz UI
- `question_bank.json` – the question bank (keep this filename unchanged)
- `static/app.js` – quiz logic (client-side)
- `static/styles.css` – UI styling
- `static/question_images/*` – question images (keep filenames unchanged)

## Local testing

Browsers block `fetch()` for JSON when you open HTML using `file://`.

Run a tiny local server instead:

```bash
cd pa-quiz-static
python -m http.server 8000
```

Then open:

- http://localhost:8000

## Hosting options (Azure)

### Option A: Azure Static Web Apps

- App location: `/`
- Build: none
- Output location: `/`

### Option B: Azure Storage Static Website

- Enable **Static website** on a Storage Account
- Upload the contents of this folder to the `$web` container

## Image path compatibility

Your `question_bank.json` may store image paths like:

- `question_images/ch2-q001.png` (original from the Flask app)
- `static/question_images/ch2-q001.png`

This static app supports both. It will automatically prefix `static/` when needed.

## Version

The version shown in the UI is defined in:

- `static/app.js` → `APP_VERSION`

Bump that when you redeploy, so you can confirm the browser is running the new build.
