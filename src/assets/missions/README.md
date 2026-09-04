# Mission briefing art

Drop image files in here and the briefing card picks them up. Nothing to import,
nothing to register: the card globs this folder at build time and matches on the
filename.

## Naming

```
<mission id>-hero.jpg     the tall picture down the left of the card
<mission id>-1.jpg        the first beat of the flow row
<mission id>-2.jpg        the second
<mission id>-3.jpg        the third
<mission id>-4.jpg        the fourth
```

The mission ids are the ones in `src/renderer/missions/`:

| Mission | id |
|---|---|
| Precision Delivery | `precision-delivery` |
| Forest Fire Emergency | `forest-fire` |

So Precision Delivery's five files are:

```
precision-delivery-hero.jpg
precision-delivery-1.jpg
precision-delivery-2.jpg
precision-delivery-3.jpg
precision-delivery-4.jpg
```

`.jpg`, `.jpeg`, `.png` and `.webp` all work.

## Anything missing falls back to the drawing

A beat with no file keeps the SVG scene `hud/MissionArt.tsx` draws for it, and so
does the hero. That is deliberate: a mission added later is never broken by not
having art yet, and a card is never half empty.

## Sizes

The hero is shown at roughly **232 x 300 CSS px** and the step thumbnails at
about **160 x 100**, on a display that may be 2x. So:

| | Export at |
|---|---|
| Hero | ~700 x 900 |
| Step | ~640 x 400 |

Keep each one under ~300 KB. They are bundled into the app rather than fetched —
a strict CSP blocks every external URL — so their size is the app's size, and the
hardware target is a 512 MB-VRAM integrated GPU. Prefer `.webp` or a
quality-80 `.jpg` over a `.png` photograph.

## Framing

The hero is cropped to fill a tall box, the steps to fill wide ones, both from the
centre. Keep the subject away from the edges or the crop will take it.
