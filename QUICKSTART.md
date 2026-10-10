# Quick start

This guide gets the Visualize First panel into Photoshop and takes you through it on one of your own images, click by click.

---

## 1. Where everything is

| What | Where |
|---|---|
| The plugin's source | `plugin/` in this repository. On the author's Mac: `~/Documents/GitHub/zonesystemPSD/plugin/` |
| The installable package | `visualize-first-1.1.0.ccx`: download it from the [latest release](https://github.com/cmerritthoughton/zonesystemPSD/releases/latest), or build it into `dist/` with the command in step 2. It isn't stored in Git. |
| The installed copy (macOS) | Creative Cloud copies it into `~/Library/Application Support/Adobe/UXP/Plugins/External/`. Creative Cloud manages this folder, so don't edit or delete it by hand. |
| The panel's practice log and settings | Inside Photoshop's plugin storage. Export the log from the panel (**Practice ▸ Export CSV**). |
| What the panel adds to your image | One layer group named **Visualize First**, at the top of the Layers panel. |

The plugin isn't part of Photoshop until you install it once (step 2).

---

## 2. Install it (one time)

You need Photoshop 2024 (25.0) or later and the Creative Cloud desktop app.

1. **Get the package.** The easiest way is to download `visualize-first-1.1.0.ccx` from the [latest release](https://github.com/cmerritthoughton/zonesystemPSD/releases/latest).

   Or build it: in Terminal, from the repository folder, run:

   ```bash
   tools/package.sh
   ```

   It prints the path of the new file, `dist/visualize-first-1.1.0.ccx`. (`npm run package` does the same thing.)

2. **Install it.** In Finder, double-click `visualize-first-1.1.0.ccx`. Creative Cloud opens and asks you to confirm. Because the plugin doesn't come from the Adobe marketplace, you'll see an "unverified" or third-party notice; choose **Install**.

3. **Restart Photoshop** if it was open.

> **Developing the plugin instead?** Use Adobe's **UXP Developer Tool** (install it from Creative Cloud). Choose **Add Plugin**, select `plugin/manifest.json`, then click **Load**. Click **Reload** after each code change. Plugins loaded this way don't persist when Photoshop restarts.

---

## 3. Launch it

1. In Photoshop, open the **Plugins** menu and choose **Visualize First**. If a submenu appears, choose **Visualize First** again.
2. The panel opens as a floating panel. Drag its tab next to the **Layers** panel to dock it; it will reopen there next time.
3. Closed it by mistake? Choose **Plugins ▸ Visualize First** again. **Plugins ▸ Plugins Panel** lists every installed plugin.

The line at the top of the panel names your active image, its mode and its number of markers. The line at the bottom reports what the panel is doing, and any problem.

---

## 4. Get your image ready

- Open the image. JPEG, TIFF, PSD and RAW files opened through Camera Raw all work.
- Check **Image ▸ Mode**: it must be **RGB Color** or **Grayscale**, at **8 or 16 Bits/Channel**. Convert a CMYK or Lab image first.
- You don't need a copy. The panel never edits your layers; it only adds the **Visualize First** group.

---

## 5. Walk through it

Work the tabs left to right. Training mode, which is on by default, keeps every measurement hidden until you've committed to a guess. That's the whole point: you're training your eye, not the software.

### Visualize: decide before you measure

1. Look at the image **in colour** for a minute.
2. In the text box, write the drawing or print you want in one sentence: what the light is doing, and how it should feel.
   > *Late storm light breaking onto the tower; the street below still in rain.*
3. Choose the print you want: **Low key**, **Full scale** or **High key**.
4. Optional: tick **Monochrome preview** to see the image in black and white. Try without it first.
5. Click **Next: predict**.

### Predict: commit to a guess

1. Choose the **Color Sampler** tool. It shares a slot with the Eyedropper: press <kbd>Shift</kbd>+<kbd>I</kbd> until it's active, or click and hold the Eyedropper icon.
2. Click the image to drop numbered markers:
   - **#1**: the darkest shadow that must still show texture (your *shadow anchor*);
   - **#2**: the brightest light that must still show texture (your *light anchor*);
   - more if you're curious (up to 10).

   The markers appear in the panel within a second.
3. For each marker, pick your guess from its menu (Zone **0** to **X**). Each zone's description is beside it in the menu.
4. Drag the slider to estimate **how much of the frame is dark** (Zones 0–IV).
5. Click **Reveal**. If it's greyed out, the note under it tells you what's missing.

### Reveal: compare

You'll see, top to bottom:

- each marker's **measured zone**, and how far off you were (*"you read it 0.8 zone lighter"*);
- your **average miss** and your **tendency** (most people see shadows lighter than they are);
- a **chart** of the whole frame by zone, its **key** (low, middle or high) and **range** (whether it has a true black and a paper white);
- **Toward your visualization**: concrete moves from this scene to the print you described.

A false-colour **zone map** now covers the image. Use the **Overlay** buttons at the bottom of the panel to change it:

| Button | Shows |
|---|---|
| Zones | every zone in its own colour (legend underneath) |
| Textured darks | only Zones II–III, the shadows that keep texture |
| Textured lights | only Zones VII–VIII |
| Middle | Zones IV–VI, the range where things turn to mud |
| No texture | Zones 0–I and IX–X |
| Ink families / Four values | the image simplified into mark groups or value masses |
| Light / shadow | two values; the slider sets the split |
| Off | your image as it is |

### Interpret: perform the score

1. **Filter.** Try **Red (#25)** for a dark, dramatic sky, or **Blue (#47)** for haze and atmosphere.
2. **Development.** Click **N+1** to expand a flat scene, or **N−1** to calm a harsh one. Zone III stays put while the highlights move.
3. **Place and develop**, Adams's method:
   - *Place marker* **#1** *on Zone* **III**;
   - tick **Also develop with a second marker** and *let marker* **#2** *fall on Zone* **VIII**;
   - click **Place**. The panel tells you the exposure shift (one zone ≈ one stop) and the development you just chose (for example *N+1.5*).
4. **Print.** Drag **Burn the edges** and **Burn the sky**, and choose how far down the sky burn reaches. Changes apply when you release the slider.
5. **Neutral print** puts everything back to the scene as metered.

### Opportunities: see the alternatives

1. Click **Make opportunities sheet**. A new document opens with 20 versions of your image: five filters down the side, four developments across the top. Each one is captioned with its key, range and dark share.
2. Tick **Show each as four value masses** first if you want to judge the design rather than the detail.
3. Back in the panel, pick the version you like from **Apply a variant** and click **Apply to the image**. The panel switches back to your image and applies it.

### Practice: track your eye

Every **Reveal** is logged. The **Practice** tab shows your average miss over the last ten sessions against the ten before, your lighter-or-darker tendency, and how far off your dark-area estimates run. **Export CSV** saves the whole log.

---

## 6. For a pen-and-ink drawing

1. Scan the drawing in **Grayscale** at the resolution you draw at (300–600 ppi). Click **Convert to RGB** on the **Ink** tab if you want the colour overlays.
2. Put marker **#1** on solid ink and **#2** on bare paper, then click **Measure from markers**. The zones now run from *your* ink to *your* paper.
3. Set **Merge distance** near your hatching's line spacing (or larger for viewing from across the room), then click **Blur a copy**. The overlay now shows the zones your marks actually produce.
4. **Read markers** estimates the ink coverage at each marker. **Add ladder** puts an eleven-step reference strip on the right edge.

---

## 7. Undo, hide, remove

- **Undo:** each panel action is one step under **Edit ▸ Undo**.
- **Cancel:** press <kbd>Esc</kbd> during a long step. Nothing is changed.
- **Selections:** an active marquee is set aside while the panel works and restored afterwards, so it never limits what the panel does.
- **Hide everything:** click the eye on the **Visualize First** group in the Layers panel.
- **Remove everything:** delete the **Visualize First** group.
- **Remove the markers:** **Clear markers** on the Predict tab, or **Clear All** in the Color Sampler tool's options bar.
- **Saving:** the group saves with a PSD. Export or flatten only when you want the interpretation baked in.

---

## 8. If something's wrong

| Problem | Fix |
|---|---|
| No **Visualize First** in the Plugins menu | Restart Photoshop. Check **Plugins ▸ Plugins Panel**. Reinstall the `.ccx`. |
| "Open an image first." | Click the image's tab so it's the active document. |
| "Visualize First works on RGB or Grayscale images." | **Image ▸ Mode ▸ RGB Color** (on a copy if you need to keep the original mode). |
| The overlay looks grey, not coloured | The image is Grayscale; use **Ink ▸ Convert to RGB**. |
| **Reveal** stays greyed out | Write the sentence, place a marker and pick a guess, or untick **Training mode** on the Practice tab. |
| Nothing happens when you click | Read the status line at the bottom of the panel. |
| "Photoshop is busy." | Close any open dialog, or finish the text edit or transform you're in, then try again. |
| A long step is taking too long | Press <kbd>Esc</kbd> or click **Cancel** on Photoshop's progress bar. The image goes back exactly as it was. |
| "This image is too wide to blur at that distance." | Lower **Merge distance**, or blur a smaller copy (**Image ▸ Image Size**). |

---

## 9. Uninstall

Open the Creative Cloud desktop app, go to its plugin management area (**Manage plugins**), find **Visualize First** and choose **Uninstall**. Your images keep any **Visualize First** groups you saved; delete those groups if you no longer want them.

For the reasoning behind each step, read [docs/TRAINING.md](docs/TRAINING.md).
