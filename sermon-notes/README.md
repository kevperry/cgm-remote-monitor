# Sermon Notebook

An Evernote-style file for sermon material: ideas, illustrations, quotes, mottos, statements, clippings, and references, all searchable by **theme** and by **Scripture passage**.

It's a self-contained web app (plain HTML/CSS/JS, no build step, no server). Notes are stored in your browser's IndexedDB, and it works offline.

## Features

- **Seven note types**, each color-coded with its own prompts: Idea, Illustration, Quote, Motto, Statement, Clipping, Reference
- **Rich text** (bold, italic, headings, lists, quote blocks). Pasting from the web keeps simple formatting and strips the rest
- **Images**: paste a screenshot, drag in a photo, or use the Image button. Large images are shrunk automatically
- **Scripture index**: type `Rom 8:28`, `1 Cor 13:4-7`, `Ps 23`, or `Lk 14:28, 33`. References are normalized (`Romans 8:28`), sorted in canonical order, and listed by book in the sidebar
- **Passage-aware search**: searching `Rom 8` finds every note on any verse in Romans 8. Searching `Romans 8:20` also finds a note tagged `Romans 8:18–25`
- **Themes/tags**, plus **notebooks** for a series or season (e.g. "Romans series", "Advent 2026")
- **"Used in sermons" log**: record when and where you used an illustration. *Not yet used* and *Least used* help you avoid repeating yourself
- **Favorites**, **Surprise me** (opens a random note from the current list), and **Copy** (puts the note on your clipboard as plain text with author and references, ready for your manuscript)
- **Backup / Import** to a JSON file. Import can merge with or replace your current notes
- Light and dark mode, phone layout, and install to your home screen (PWA)
- Keyboard: `N` new note, `/` search, `Esc` close

## Running it

Any static file host works. Locally:

```sh
cd sermon-notes
python3 -m http.server 8080
# open http://localhost:8080
```

To use it on your phone, host the folder somewhere with HTTPS (for example GitHub Pages, Netlify, or Cloudflare Pages). Then open it in Safari and choose **Share → Add to Home Screen**.

## Your data

Everything stays on the device and browser you use. Nothing is uploaded. That also means:

- Notes don't sync between devices on their own. Use **Backup** on one device and **Import** on the other (Import merges, and the newest version of each note wins)
- Clearing the browser's website data deletes your notes, so **export a backup regularly** (for example, into iCloud Drive or Dropbox)

## Files

| File | Purpose |
|---|---|
| `index.html` | Layout |
| `styles.css` | Styling (light/dark, responsive) |
| `app.js` | App logic, storage, search, import/export |
| `bible.js` | Scripture reference parser (66 books, common abbreviations) |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Offline support and home-screen install |
