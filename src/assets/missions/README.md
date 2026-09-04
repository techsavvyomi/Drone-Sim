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

## Shapes and sizes

**The four step slots are SQUARE.** They were wide once and it did not survive
contact with real captures: a shot of a drone coming down onto a mark is a tall
picture, and a wide slot either crops the subject out or leaves the shot between
two bars. A square takes a portrait and a landscape source equally well, and four
of them in a row read as a set.

Each file is cut to its slot's shape, so nothing is cropped when it is drawn and
no bar is ever shown. If you drop in a picture that is not square it will be
centre-cropped to fit — check that the subject survives, or crop it yourself.

| | Shape | Export at |
|---|---|---|
| Hero | tall, roughly 2:3 | ~700 x 900 |
| Step | square | ~420 x 420 |

Keep each one under ~300 KB. They are bundled into the app rather than fetched —
a strict CSP blocks every external URL — so their size is the app's size, and the
hardware target is a 512 MB-VRAM integrated GPU. Prefer `.webp` or a
quality-80 `.jpg` over a `.png` photograph.

## Framing

The hero fills a tall box from the centre. Keep the subject away from the edges
or the crop will take it.

The package and its ring sit low in most captures, so the step squares are cut
from the BOTTOM of a tall source rather than its middle. If you replace one, look
at it afterwards.
