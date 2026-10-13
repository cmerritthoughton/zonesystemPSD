# Quick start

This guide gets the Visualize First panel into Photoshop and takes you through it on one of your own images, click by click.

---

## 1. Where everything is

| What | Where |
|---|---|
| The plugin's source | `plugin/` in this repository. On the author's Mac: `~/Documents/GitHub/zonesystemPSD/plugin/` |
| The installable package | `visualize-first-1.1.1.ccx`: download it from the [latest release](https://github.com/cmerritthoughton/zonesystemPSD/releases/latest), or build it into `dist/` with the command in step 2. It isn't stored in Git. |
| The installed copy (macOS) | Creative Cloud copies it into `~/Library/Application Support/Adobe/UXP/Plugins/External/`. Creative Cloud manages this folder, so don't edit or delete it by hand. |
| The panel's practice log and settings | Inside Photoshop's plugin storage. Export the log from the panel (**Practice ▸ Export CSV**). |
| What the panel adds to your image | One layer group named **Visualize First**, at the top of the Layers panel. |

The plugin isn't part of Photoshop until you install it once (step 2).

---

## 2. Install it (one time)

You need Photoshop 2024 (25.0) or later and the Creative Cloud desktop app.

1. **Get the package.** The easiest way is to download `visualize-first-1.1.1.ccx` from the [latest release](https://github.com/cmerritthoughton/zonesystemPSD/releases/latest).

   Or build it: in Terminal, from the repository folder, run:

   ```bash
   tools/package.sh
   ```

   It prints the path of the new file, `dist/visualize-first-1.1.1.ccx`. (`npm run package` does the same thing.)

2. **Install it.** In Finder, double-click `visualize-first-1.1.1.ccx`. Creative Cloud opens and asks you to confirm. Because the plugin doesn't come from the Adobe marketplace, you'll see an "unverified" or third-party notice; choose **Install**.

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

The panel guides you through five numbered steps. Across the top, the **stepper** shows where you are:

- **✓** marks a finished step;
- **blue** marks the step you're on;
- **dimmed** marks a step that's still locked. Tap it to see why.

Each step has the same layout:

- **Step n of 5** and a one-line purpose;
- a **checklist** that ticks itself as you work (items marked *optional* aren't required);
- a **Next** box naming the one thing to do now. When the panel can do it for you, it shows a button;
- at the bottom, a button **forward** and a button **back**. If the forward button is greyed out, the line under it says what's missing.

Training mode (on by default) keeps the steps in order and every measurement hidden until you've committed to a guess. That's the point: you're training your eye, not the software. The first time you open the panel, a short introduction lists the five steps; click **Start**.

### Step 1 · Visualize: decide what the print should feel like

1. Look at the image **in colour** for a minute.
2. In the text box, write the drawing or print you want in one sentence: what the light is doing, and how it should feel.
   > *Late storm light breaking onto the tower; the street below still in rain.*
3. Choose the key: **Low key**, **Full scale** or **High key**. The advice after Reveal depends on it.
4. Optional: tick **Monochrome preview**. Try without it first.
5. Click **Continue to Predict →**.

### Step 2 · Predict: commit to the values

1. Click **Pick the Color Sampler tool** in the Next box. (You can also press <kbd>Shift</kbd>+<kbd>I</kbd> until the Color Sampler is active.)
2. Click the image where the Next box tells you:
   - **#1**: the darkest shadow that must still show texture (your *shadow anchor*);
   - **#2**: the brightest light that must still show texture (your *light anchor*);
   - more if you're curious (up to 10).

   Each marker appears in the panel within a second, and the checklist ticks.
3. For each marker, pick your guess from its menu (Zone **0** to **X**). Each zone's description is beside it.
4. Drag the slider to estimate **how much of the frame is dark** (Zones 0–IV).
5. Click **Reveal the meter readings →**.

### Step 3 · Reveal: see what the meter says

You'll see, top to bottom:

- each marker's **measured zone**, and how far off you were (*"you read it 0.8 zone lighter"*);
- your **average miss** and your **tendency** (most people see shadows lighter than they are);
- a **chart** of the whole frame by zone, its **key** (low, middle or high) and **range** (whether it has a true black and a paper white);
- **Moves toward your print**: advice from this scene to the print you described. Each comes with one-click buttons such as **Place #1 on Zone II**, **Try N+1**, **Burn the edges** or **Red filter**. A button applies the move and takes you to Interpret.

A false-colour **zone map** now covers the image. Use **See the zones on the image**, below the step, to change it:

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

Click **Continue to Interpret →** to work on the print yourself.

### Step 4 · Interpret: perform the print

At the top, **Your print now** shows the print's zones after every change, next to the scene as metered. Work down the three numbered parts:

1. **Filter.** Try **Red (#25)** for a darker blue sky, or **Blue (#47)** for haze and atmosphere. The note under the menu says what each one does.
2. **Exposure and development.** Click **N+1** to expand a flat scene, or **N−1** to calm a harsh one; Zone III stays put while the highlights move. Or place values directly, Adams's method:
   - *Place marker* **#1** *on Zone* **III**;
   - tick **Also develop with a second marker** and *let marker* **#2** *fall on Zone* **VIII**;
   - click **Place**. The panel tells you the exposure shift (one zone ≈ one stop) and the development you chose (for example *N+1.5*).
3. **Burning.** Drag **Burn the edges** and **Burn the sky**, and choose how far down the sky burn reaches. Changes apply when you release the slider.

**Back to the neutral print** undoes all three. When the readout matches your sentence, click **Compare 20 performances →**.

### Step 5 · Compare: twenty performances

1. Click **Make the opportunities sheet**. A new document opens with 20 versions of your image: five filters down the side, four developments across the top, each captioned with its key, range and dark share. The panel stays on this step for your image while the sheet is open.
2. Tick **Show each as four value masses** first if you want to judge the design rather than the detail.
3. Pick the version you like under **Apply a version** and click **Apply to the image**. The panel switches back to your image, applies it, and opens Interpret so you can refine it.
4. Click **Start a new round** to practise again with the same image, or open another image. Each image keeps its own place in the steps.

### Tools: Ink, and Practice & settings

Under the stepper, **Tools** opens two pages that sit outside the sequence. Each has a button back to the step you were on.

- **Ink** reads scanned drawings (see below).
- **Practice & settings** shows your log: every Reveal is recorded, with your average miss over the last ten sessions against the ten before, your lighter-or-darker tendency and your dark-share error. **Export CSV** saves the log. This page is also where you turn **Training mode** off (unlocking every step) and choose the meter spot size.

---

## 6. For a pen-and-ink drawing

Open **Tools ▸ Ink**, then:

1. Scan the drawing in **Grayscale** at the resolution you draw at (300–600 ppi). Click **Convert to RGB** on the Ink page if you want the colour overlays.
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
| A step is dimmed, or a forward button is greyed out | Tap the step, or read the line under the button: it says what's missing. Or untick **Training mode** under **Tools ▸ Practice & settings**. |
| Nothing happens when you click | Read the status line at the bottom of the panel. |
| "Photoshop is busy." | Close any open dialog, or finish the text edit or transform you're in, then try again. |
| A long step is taking too long | Press <kbd>Esc</kbd> or click **Cancel** on Photoshop's progress bar. The image goes back exactly as it was. |
| "This image is too wide to blur at that distance." | Lower **Merge distance**, or blur a smaller copy (**Image ▸ Image Size**). |

---

## 9. Uninstall

Open the Creative Cloud desktop app, go to its plugin management area (**Manage plugins**), find **Visualize First** and choose **Uninstall**. Your images keep any **Visualize First** groups you saved; delete those groups if you no longer want them.

To see every step on a real photograph before you try your own, read the [walkthrough](docs/WALKTHROUGH.md). For the reasoning behind each step, read [docs/TRAINING.md](docs/TRAINING.md).
