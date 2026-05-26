# Traffic Control signpack guide

Signpack Maker helps you build signpacks for [Traffic Control](https://github.com/CSX8600/trafficcontrol). The authoritative format and field reference is the official wiki:

**[Making a Custom Sign Pack](https://github.com/CSX8600/trafficcontrol/wiki/Making-a-Custom-Sign-Pack)** — maintained by the Traffic Control project.

This document summarizes key points for contributors and users of this website. It is not a full copy of the wiki.

## Pack format

- Signpacks are distributed as **ZIP** archives.
- **`signs.json`** at the root of the ZIP is **required**.
- Textures should be **PNG** files.
- Use **square** resolutions (e.g. 16×16, 32×32, 64×64) so signs render correctly.

### Default sign type folders

Traffic Control expects signs in type folders such as:

`circle`, `diamond`, `misc`, `rectangle`, `square`, `triangle`

You may add custom folders; map display names via the `types` object in `signs.json`.

## `signs.json` — pack fields

| Field | Required | Notes |
|-------|----------|--------|
| `name` | Yes | Pack display name |
| `pack_id` | Yes | UUID identifying the pack |
| `signs` | Yes | Array of sign objects |
| `author` | No | Creator name |
| `types` | No | Maps folder name → in-game category label |

Signpack Maker generates `pack_id` and sign `id` UUIDs when you create packs here.

## `signs.json` — sign fields

| Field | Required | Notes |
|-------|----------|--------|
| `id` | Yes | UUID |
| `name` | Yes | Sign name |
| `type` | Yes | Folder name (e.g. `rectangle`) |
| `front` | Yes | PNG filename for front texture |
| `back` | No | PNG filename; defaults to `back.png` if omitted |
| `tooltip` | No | In-game help string |
| `note` | No | Metadata note |
| `halfheight` | No | Half-height sign flag |
| `textlines` | No | Interactive text fields |
| `variant` | — | **Deprecated** — do not use for new packs |

## Textlines (16×16 grid)

Each textline defines a text field on the sign texture grid.

| Field | Required | Notes |
|-------|----------|--------|
| `label` | Yes | Prompt shown to the player |
| `x`, `y` | Yes | Position on 16×16 grid |
| `width` | Yes | Field width |
| `color` | Yes | **Integer** color (not hex in JSON) |
| `maxlength` | No | Character limit |
| `xscale`, `yscale` | No | Scale factors (default 1) |
| `halign` | No | `left`, `center`, `right` |
| `valign` | No | `top`, `center`, `bottom` |

**Color example:** red `#FF0000` → integer `16711680` (`0xFF0000`). This editor converts hex picker values when saving.

## Installing and testing in-game

1. Export your pack as a ZIP from Signpack Maker.
2. Place the ZIP in Minecraft: `.minecraft/tc_signpacks/`
3. Reload signpacks in-game: **`F3` + `]`** (F3 plus right bracket).

## Credits

Format and behavior are defined by the Traffic Control mod and its wiki. Signpack Maker is an independent tool and is not affiliated with CSX8600/trafficcontrol beyond implementing the documented pack structure.
