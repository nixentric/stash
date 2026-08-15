# Roadmap

Status meanings are defined in the [main README](../README.md#feature-status).

## Shipped

- Asset library across local disk, Drive links, and URLs
- Tags, collections, projects, ratings, favorites, notes
- Usage tracking with history and smart views
- Library search and combinable filters
- Source folders with custom columns and clickable facet filters
- Portable single-file database, embedded thumbnails, optional Drive integration
- Multi-brand guidelines: colors, typography, logos, Quick Brand Kit
- Logo usage rules and do/don't examples
- Graphic elements referencing the asset library
- Universal search across assets, brands, colors, typography, logos, elements,
  and logo usage rules

## Next

1. Per-asset custom fields, generalizing today's folder columns
2. Clickable facet filters across the main library grid
3. Photography guidelines — reusing the do/don't examples already in the schema

## After that

4. Video/motion, tone of voice, icon, and social guidelines
5. Brand asset collections beyond logos and elements
6. Brand cover images, and a brand picker in the Quick Brand Kit

The `brand_examples` table already carries a `section` column, so the guideline
sections above are new screens over an existing shape rather than new tables.

## Not planned

- Cloud sync, accounts, or a hosted backend
- Editing, converting, or downloading your source files
- Any write access to Google Drive
