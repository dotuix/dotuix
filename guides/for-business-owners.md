# dotuix — Guide for Business Owners

> How to create a `.uix` file for your business — no coding required.

A `.uix` file is a single file that contains your entire interactive app — your menu, catalogue, or portfolio. You send it like you would a PDF, but it is fully interactive: customers can browse categories, filter items, and add to a cart. It works completely offline, with no internet connection required.

---

## The quick version

1. Open the **dotuix editor**
2. Click **Simple** in the toolbar
3. Pick a template (restaurant menu, product catalogue, or portfolio)
4. Type in your items
5. Click **Export .uix**
6. Send the file to anyone — they open it in the [free viewer](https://viewer.dotuix.com)

That's it. No code, no installation, no server.

---

## Step-by-step walkthrough

### Step 1 — Open the editor

Launch the dotuix editor from your Applications folder (or ask your IT team to set it up from [github.com/emadjumaah/dotuix](https://github.com/emadjumaah/dotuix)).

### Step 2 — Switch to Simple mode

At the top of the editor you will see two buttons: **Developer** and **Simple**. Click **Simple**.

### Step 3 — Choose your template

Three templates are available:

| Template           | Best for                                                  |
| ------------------ | --------------------------------------------------------- |
| 🍽️ Restaurant Menu | Cafés, restaurants, hotel dining — kiosk menu with cart   |
| 📦 Product Catalog | Showrooms, exhibitions, retail — browse products, no cart |
| ✦ Portfolio        | Freelancers, agencies, photographers — showcase your work |

Click the template that matches your business.

### Step 4 — Fill in your details

You will see:

- An **App Name** field at the top — type the name of your business or project (e.g. "Al Madina Restaurant" or "My Jewellery Collection")
- An **items table** below — each row is one item (a dish, a product, or a project)

The table already has a couple of example rows to show you the format. You can edit them directly, delete the ones you do not need, and click **+ Add item** to add your own.

**Tips:**

- You do not need to fill every column — description and SKU are optional
- Prices can be in any currency; the template displays whatever you type
- For the portfolio template, the **Year** column is the year you completed the project

### Step 5 — Export

Click **▦ Export .uix**. A save dialog will appear. Choose where to save the file and click Save.

The file is ready. Open it with the Finder (double-click) to verify it looks correct.

---

## How your customers open it

### Option 1 — Web browser (free, no install)

Go to [viewer.dotuix.com](https://viewer.dotuix.com) and drag the `.uix` file onto the page. It opens instantly in any modern browser. Works on a phone, tablet, or computer.

### Option 2 — Desktop viewer (better for kiosks)

Download and install the dotuix desktop viewer. Double-click any `.uix` file and it opens in full kiosk mode — no address bar, no browser tabs, professional presentation.

This is the recommended option for:

- Tablets placed at reception or on restaurant tables
- Kiosk screens in a showroom or shop
- Offline presentations at exhibitions

---

## Updating your file

When your menu changes or you add new products:

1. Open the editor in **Simple** mode
2. Pick the same template
3. Update your items
4. Export a new `.uix` file
5. Replace the old file on the device

Each export creates a fresh file. You can keep older versions as backups.

---

## Sharing your file

A `.uix` file is just a file — share it however you share other files:

- USB drive (perfect for kiosk setups with no internet)
- Email attachment
- WhatsApp, Telegram, or any messaging app
- Google Drive, Dropbox, or any shared folder
- QR code linking to a download

---

## Security options

These options are for business owners who need to control who can open a file and for how long. They are completely optional — most apps (menus, catalogues, portfolios) do not need them.

To add security, you need a developer to set up the manifest, or use the CLI. If you are not sure, ask your IT contact.

---

### PIN protection

The viewer asks for a PIN before opening the file. The content is encrypted — without the correct PIN, the file cannot be read, even by someone technical.

**Good for:** internal price lists, confidential proposals, classified briefings, documents meant for specific people.

**How it works:** You choose a PIN when creating the file. Share the PIN separately (not in the same message as the file). The viewer derives an encryption key from the PIN locally — no server is involved.

---

### Expiry date

The file stops opening after a date you set. The viewer checks the device clock before unpacking.

**Good for:** time-limited promotions, event guides, seasonal menus, tender documents that should expire on submission deadline.

**Example:** Set `"expires": "2026-06-30"` in the manifest. From July 1st, the viewer shows "This file has expired" and refuses to open it.

---

### Maximum opens

The file will only open a set number of times on each device. After that, the viewer refuses to open it.

**Good for:** confidential briefings distributed to specific recipients — each recipient can open it a maximum of 3 times, for example.

**Important:** this is tracked per device. If someone copies the file to another device, that device gets its own counter.

---

### Tamper detection (signature)

Anyone who receives the file can verify it has not been modified since you sent it. If someone changes even a single byte, the viewer shows a warning and refuses to open it.

**Good for:** official documents, audit reports, proposals, any file where authenticity matters.

The file content is **not encrypted** with this option — it can still be read. It just cannot be forged.

---

### Full lockdown (PIN + signature + expiry)

Combine all three for maximum control:

- **Encrypted** with a PIN — only people with the PIN can open it
- **Signed** — any tampering is detected
- **Expiry date** — stops working after a deadline
- **Max opens** — limits how many times it can be opened per device

This combination is used for classified briefings, confidential legal documents, and access-controlled content in air-gapped environments.

To set this up, share this guide with your developer: [for-developers.md](./for-developers.md) (Scenario F).

---

## Frequently asked questions

**Can I add images to my products?**
Not yet in the Simple mode editor. Images are on the roadmap. For now, the templates use category icons as placeholders. A developer can add product images using the Developer mode.

**Is there a limit to how many items I can add?**
No practical limit. Hundreds or thousands of items work fine — the database inside the `.uix` file is SQLite, which handles large datasets well.

**Can my customers place real orders through the file?**
The restaurant template has a cart that collects orders inside the file (stored in `state.db`). These orders can be exported to CSV or JSON using the CLI. There is no real-time order notification — this is an offline file, not a connected app. For live orders you need a regular online app.

**What happens to the cart orders in the restaurant template?**
Orders are saved inside the `.uix` file itself in a database (`state.db`). To read them, use the CLI:

```bash
dotuix export restaurant.uix --type order --format csv --output orders.csv
```

**Do I need the internet to use the file?**
No. The file works completely offline. The viewer does not phone home. No analytics, no tracking, no account required.

**Can I customise the design (colours, fonts, logo)?**
The Simple mode editor uses fixed template designs. For custom branding — your logo, colours, and typography — you need a developer to work in Developer mode or use the Vite plugin. Share the [developer guide](./for-developers.md) with them.

**What devices does the `.uix` file work on?**

- Any modern browser (Chrome, Safari, Firefox, Edge) at [viewer.dotuix.com](https://viewer.dotuix.com)
- macOS, Windows, Linux via the desktop viewer
- Tablets running iOS or Android can open it in a browser

**Is it free?**
The format, the viewer, the CLI, and the editor are all open source and free to use.
